#!/usr/bin/env node
/**
 * Asset suite: real images through the files dictionary (tools/author.js).
 * Pins the ticket's claims at the API a generator calls:
 *
 *   1. image() places an element backed by the files dictionary — the bytes
 *      travel in the file, the SVG embeds them, and the gate passes
 *   2. unreadable or unsupported image input is a named AssetError and
 *      nothing is written
 *   3. intrinsic size comes from the bytes for every supported format, not just
 *      PNG, so one dimension is enough to place any of them
 *   4. revise prunes the bytes no live image references any more, and leaves
 *      the ones that are still referenced untouched
 *
 * spliceLibraryItem's own contract lives in tests/splice.js; the spliced figure
 * appears here only as part of the whole-pipeline build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authorDiagram, reviseDiagram } from "../tools/author.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "assets-"));
const LIB = join(root, "examples/stick-figure.excalidrawlib");
const LOGO = join(root, "brand/AIWorx_logo.png");
/**
 * 40x20 swatches, one per non-PNG format. The SVG carries a viewBox and no
 * width/height — the shape an `<img>` reports as Chrome's default 300x150,
 * so it is the case that proves the size comes from the markup.
 */
const SWATCH = (ext) => join(root, `tests/fixtures/swatch.${ext}`);
console.log(`artifacts: ${outDir}`);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};
const rejectsWith = async (errorName, promise) => {
  try {
    await promise;
    return { ok: false, detail: "resolved instead of throwing" };
  } catch (err) {
    return { ok: err.name === errorName, message: String(err.message), detail: `${err.name}: ${String(err.message).split("\n")[0]}` };
  }
};

// ---- image() and the whole pipeline: files dictionary, SVG embed, gate ----
const demoOut = join(outDir, "assets.excalidraw");
{
  const result = await authorDiagram({
    out: demoOut,
    build: async ({ image, spliceLibraryItem, row }) => {
      const logo = await image(LOGO, { id: "logo", width: 180 });
      const badge = await image(LOGO, { id: "badge", width: 60, height: 60 });
      const fig = spliceLibraryItem(LIB);
      const band = row([logo, badge, fig], { gap: 48, align: "end" });
      return [band, { type: "frame", children: ["logo", "badge", ...fig.ids], name: "assets" }];
    },
  });
  check("an asset build writes the diagram", existsSync(demoOut), `${result.elements.length} elements`);
  const doc = JSON.parse(readFileSync(demoOut, "utf8"));
  const images = doc.elements.filter((e) => e.type === "image");
  const fileIds = Object.keys(doc.files ?? {});
  check("one file entry backs both placements of the same bytes",
    images.length === 2 && fileIds.length === 1 && images.every((i) => i.fileId === fileIds[0]),
    `${images.length} images, ${fileIds.length} file(s)`);
  check("the bytes travel as a data URL",
    doc.files[fileIds[0]]?.dataURL?.startsWith("data:image/png;base64,") &&
      doc.files[fileIds[0]]?.mimeType === "image/png");
  const logo = images.find((i) => Math.abs(i.width - 180) < 0.5);
  check("a single-dimension image keeps its aspect ratio",
    logo && Math.abs(logo.height - (180 * 1047) / 1501) < 1, `height ${logo?.height}`);
  const explicit = images.find((i) => Math.abs(i.width - 60) < 0.5);
  check("explicit width and height win", explicit && Math.abs(explicit.height - 60) < 0.5);
  check("spliced and image elements are bound to the frame",
    doc.elements.filter((e) => e.type !== "frame").every((e) => e.frameId || e.containerId));
  const svg = readFileSync(demoOut.replace(/\.excalidraw$/, ".svg"), "utf8");
  check("the SVG embeds the image bytes", svg.includes("data:image/png;base64,"));
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), demoOut], { encoding: "utf8" });
  check("the asset diagram passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
}

// ---- asset failure paths are named, and nothing is written ----
{
  const out = join(outDir, "missing-image.excalidraw");
  const r = await rejectsWith("AssetError", authorDiagram({
    out,
    build: async ({ image }) => [await image(join(outDir, "nope.png"), { width: 100 })],
  }));
  check("a missing image file is an AssetError", r.ok, r.detail);
  check("a missing image writes nothing", !existsSync(out));

  const bmp = join(outDir, "logo.bmp");
  writeFileSync(bmp, "not really a bitmap");
  const r2 = await rejectsWith("AssetError", authorDiagram({
    out,
    build: async ({ image }) => [await image(bmp, { width: 100, height: 100 })],
  }));
  check("an unsupported image format is an AssetError", r2.ok, r2.detail);

  const noSize = await rejectsWith("AssetError", authorDiagram({
    out,
    build: async ({ image }) => {
      const svgFile = join(outDir, "icon.svg");
      writeFileSync(svgFile, "<svg xmlns='http://www.w3.org/2000/svg'/>");
      return [await image(svgFile)];
    },
  }));
  check("a non-PNG without explicit size is an AssetError", noSize.ok, noSize.detail);
}

// ---- intrinsic size for every supported format, not just PNG ----
{
  // one authoring pass places every format twice: scaled from a single
  // dimension, and unscaled, so both readings of the intrinsic size are proven
  const FORMATS = ["jpg", "webp", "gif", "svg"];
  const out = join(outDir, "intrinsic.excalidraw");
  await authorDiagram({
    out,
    svg: false,
    build: async ({ image, row }) =>
      [row(
        await Promise.all(
          FORMATS.flatMap((ext) => [
            image(SWATCH(ext), { id: `scaled-${ext}`, width: 80 }),
            image(SWATCH(ext), { id: `intrinsic-${ext}` }),
          ]),
        ),
        { gap: 20, align: "start" },
      )],
  });
  const doc = JSON.parse(readFileSync(out, "utf8"));
  const images = doc.elements.filter((e) => e.type === "image");
  check("every format placed", images.length === FORMATS.length * 2, `${images.length} images`);
  // the swatches are 40x20, so a width of 80 must come back 40 high
  const scaled = images.filter((e) => Math.abs(e.width - 80) < 0.5);
  check("one dimension keeps the aspect ratio for jpeg, webp, gif and svg",
    scaled.length === FORMATS.length && scaled.every((e) => Math.abs(e.height - 40) < 0.5),
    scaled.map((e) => `${Math.round(e.width)}x${Math.round(e.height)}`).join(" "));
  const natural = images.filter((e) => Math.abs(e.width - 40) < 0.5);
  check("no dimensions places at the intrinsic size",
    natural.length === FORMATS.length && natural.every((e) => Math.abs(e.height - 20) < 0.5),
    natural.map((e) => `${Math.round(e.width)}x${Math.round(e.height)}`).join(" "));
  check("one entry per format in the files dictionary",
    Object.keys(doc.files ?? {}).length === FORMATS.length,
    `${Object.keys(doc.files ?? {}).length} file(s)`);

  // an SVG sized in absolute units other than px: 2in x 1in is 192x96
  const inches = join(outDir, "inches.svg");
  writeFileSync(inches, `<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in"><rect width="100%" height="100%" fill="#d62c2c"/></svg>`);
  const inchOut = join(outDir, "inches.excalidraw");
  await authorDiagram({
    out: inchOut,
    svg: false,
    build: async ({ image }) => [await image(inches, { width: 96 })],
  });
  const inchImage = JSON.parse(readFileSync(inchOut, "utf8")).elements[0];
  check("absolute units other than px resolve (2in x 1in)",
    Math.abs(inchImage.width - 96) < 0.5 && Math.abs(inchImage.height - 48) < 0.5,
    `${inchImage.width}x${inchImage.height}`);

  // bytes Chrome cannot decode are still a named AssetError with nothing written
  const lying = join(outDir, "lying.jpg");
  writeFileSync(lying, "JFIF is not enough to make this a JPEG");
  const badOut = join(outDir, "undecodable.excalidraw");
  const bad = await rejectsWith("AssetError", authorDiagram({
    out: badOut,
    build: async ({ image }) => [await image(lying, { width: 100 })],
  }));
  check("undecodable bytes are a named AssetError", bad.ok, bad.detail);
  check("undecodable bytes write nothing", !existsSync(badOut));
}

// ---- revise prunes the bytes nothing references any more ----
{
  /**
   * Two placements of one image plus a plain shape. Both images share a single
   * files entry (keyed by content hash), so the entry outlives the first
   * deletion and dies with the second.
   */
  const authored = join(outDir, "prune.excalidraw");
  await authorDiagram({
    out: authored,
    svg: false,
    build: async ({ image, row }) => [
      row(
        [
          { type: "rectangle", x: 0, y: 0, width: 80, height: 80 },
          await image(LOGO, { id: "img-a", width: 120 }),
          await image(LOGO, { id: "img-b", width: 120 }),
        ],
        { gap: 40, align: "start" },
      ),
    ],
  });
  const base = JSON.parse(readFileSync(authored, "utf8"));
  const fileId = Object.keys(base.files ?? {})[0];
  check("the fixture shares one files entry between two images",
    Object.keys(base.files ?? {}).length === 1 &&
      base.elements.filter((e) => e.type === "image").every((e) => e.fileId === fileId),
    `${Object.keys(base.files ?? {}).length} file(s)`);
  const entryBefore = JSON.stringify(base.files[fileId]);

  /**
   * Write a copy of the authored doc with `drop` of its image elements
   * hand-deleted — the converter assigns image ids itself, so they are picked by
   * position rather than by the ids the build asked for.
   */
  const copyWithoutImages = (name, drop) => {
    const path = join(outDir, `${name}.excalidraw`);
    let left = drop;
    const doc = {
      ...base,
      elements: base.elements.filter((e) => !(e.type === "image" && left-- > 0)),
    };
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
    return path;
  };

  const oneLeft = copyWithoutImages("prune-one", 1);
  const sizeBeforeOne = statSync(oneLeft).size;
  await reviseDiagram({ file: oneLeft, svg: false });
  const afterOne = JSON.parse(readFileSync(oneLeft, "utf8"));
  check("deleting one of two images sharing an entry keeps the entry",
    Object.keys(afterOne.files ?? {}).length === 1 && afterOne.files[fileId] !== undefined,
    `${Object.keys(afterOne.files ?? {}).length} file(s)`);
  check("a still-referenced entry survives revise byte-identical",
    JSON.stringify(afterOne.files[fileId]) === entryBefore);
  check("revise does not shrink a file whose bytes are still referenced",
    statSync(oneLeft).size >= sizeBeforeOne - 200,
    `${sizeBeforeOne} -> ${statSync(oneLeft).size} bytes`);

  const noneLeft = copyWithoutImages("prune-none", 2);
  const sizeBeforeNone = statSync(noneLeft).size;
  const pruned = await reviseDiagram({ file: noneLeft, svg: false });
  // Pruning is the lossiest thing a revise does — the bytes are gone — so the
  // fidelity ledger has to name the payload and what the file lost with it.
  const payload = pruned.ledger.entries.find((e) => e.code === "image-payload-dropped");
  check("the ledger reports the payload it pruned",
    payload?.payloads.length === 1 && payload.payloads[0].fileId === fileId,
    JSON.stringify(pruned.ledger.entries.map((e) => e.code)));
  check("the ledger sizes the payload against what the file lost",
    payload?.bytes > 0 && Math.abs(payload.bytes - (sizeBeforeNone - statSync(noneLeft).size)) < 200,
    `ledger ${payload?.bytes} B, file lost ${sizeBeforeNone - statSync(noneLeft).size} B`);
  const afterNone = JSON.parse(readFileSync(noneLeft, "utf8"));
  const sizeAfterNone = statSync(noneLeft).size;
  check("deleting every image prunes the orphaned entry",
    Object.keys(afterNone.files ?? {}).length === 0,
    `${Object.keys(afterNone.files ?? {}).length} file(s) left`);
  check("pruning shrinks the file by the data URL it dropped",
    sizeAfterNone < sizeBeforeNone / 2,
    `${sizeBeforeNone} -> ${sizeAfterNone} bytes`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nassets behave");
process.exit(fail.length ? 1 : 0);
