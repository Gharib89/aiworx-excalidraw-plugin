#!/usr/bin/env node
/**
 * Asset suite: real images through the files dictionary and library splicing
 * (tools/author.js). Pins the ticket's claims at the API a generator calls:
 *
 *   1. spliceLibraryItem regenerates ids and group ids per splice, remaps
 *      internal references, drops references that point outside the item,
 *      and lands the item at the requested offset
 *   2. malformed library input is rejected with a named LibraryError
 *   3. image() places an element backed by the files dictionary — the bytes
 *      travel in the file, the SVG embeds them, and the gate passes
 *   4. unreadable or unsupported image input is a named AssetError and
 *      nothing is written
 *   5. revise prunes the bytes no live image references any more, and leaves
 *      the ones that are still referenced untouched
 *   6. intrinsic size comes from the bytes for every supported format, not just
 *      PNG, so one dimension is enough to place any of them
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authorDiagram, reviseDiagram, spliceLibraryItem } from "../tools/author.js";

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
const throwsWith = (errorName, fn) => {
  try {
    fn();
    return { ok: false, detail: "returned instead of throwing" };
  } catch (err) {
    return { ok: err.name === errorName, message: String(err.message), detail: `${err.name}: ${String(err.message).split("\n")[0]}` };
  }
};
const rejectsWith = async (errorName, promise) => {
  try {
    await promise;
    return { ok: false, detail: "resolved instead of throwing" };
  } catch (err) {
    return { ok: err.name === errorName, message: String(err.message), detail: `${err.name}: ${String(err.message).split("\n")[0]}` };
  }
};

// ---- 1. splicing regenerates ids and remaps internal references ----
{
  const sourceIds = new Set(
    JSON.parse(readFileSync(LIB, "utf8")).libraryItems[0].elements.map((e) => e.id),
  );
  const a = spliceLibraryItem(LIB);
  const b = spliceLibraryItem(LIB);
  check("a splice carries every element of the item", a.children.length === 5 && a.ids.length === 5);
  check("spliced ids are regenerated", a.ids.every((id) => !sourceIds.has(id)), a.ids.join(", "));
  check("two splices of one item share no ids", a.ids.every((id) => !b.ids.includes(id)));
  const groupsA = new Set(a.children.flatMap((e) => e.groupIds));
  const groupsB = new Set(b.children.flatMap((e) => e.groupIds));
  check("the item's group survives under a fresh id",
    groupsA.size === 1 && !groupsA.has("fig-group"),
    [...groupsA].join(", "));
  check("two splices get distinct group ids", [...groupsA].every((g) => !groupsB.has(g)));
}

// ---- offset and extent ----
{
  const fig = spliceLibraryItem(LIB, { at: [100, 200] });
  const minX = Math.min(...fig.children.map((e) => e.x));
  const minY = Math.min(...fig.children.map((e) => e.y));
  check("at: places the item's top-left corner", Math.abs(minX - 100) < 0.5 && Math.abs(minY - 200) < 0.5,
    `min ${minX},${minY}`);
  check("the group reports the item's extent",
    Math.abs(fig.width - 36) < 0.5 && Math.abs(fig.height - 84) < 0.5,
    `${fig.width}x${fig.height}`);
  check("the group places like a layout item", fig.kind === "layout-group" && fig.x === 100 && fig.y === 200);
}

// ---- selection by name, and every malformed input is a named error ----
{
  const byName = spliceLibraryItem(LIB, { item: "stick figure" });
  check("an item selects by name", byName.children.length === 5);
  const noName = throwsWith("LibraryError", () => spliceLibraryItem(LIB, { item: "no such item" }));
  check("an unknown item name is a LibraryError", noName.ok, noName.detail);
  const noIndex = throwsWith("LibraryError", () => spliceLibraryItem(LIB, { item: 3 }));
  check("an out-of-range index is a LibraryError", noIndex.ok, noIndex.detail);
  const missing = throwsWith("LibraryError", () => spliceLibraryItem(join(outDir, "nope.excalidrawlib")));
  check("a missing library file is a LibraryError", missing.ok, missing.detail);
  const badJson = join(outDir, "bad.excalidrawlib");
  writeFileSync(badJson, "{ not json");
  const bad = throwsWith("LibraryError", () => spliceLibraryItem(badJson));
  check("unparseable library JSON is a LibraryError", bad.ok, bad.detail);
  const noItems = join(outDir, "empty.excalidrawlib");
  writeFileSync(noItems, JSON.stringify({ type: "excalidrawlib", version: 2, libraryItems: [] }));
  const empty = throwsWith("LibraryError", () => spliceLibraryItem(noItems));
  check("a library with no items is a LibraryError", empty.ok, empty.detail);
}

// ---- v1 library format, and binding sanitisation ----
{
  const rect = {
    id: "a", type: "rectangle", x: 0, y: 0, width: 40, height: 40, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 1, version: 1,
    versionNonce: 1, isDeleted: false, link: null, locked: false,
    boundElements: [{ id: "conn", type: "arrow" }, { id: "ghost", type: "arrow" }],
  };
  const arrow = {
    id: "conn", type: "arrow", x: 50, y: 20, width: 30, height: 0, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 2, version: 1,
    versionNonce: 2, isDeleted: false, link: null, locked: false,
    points: [[0, 0], [30, 0]],
    startBinding: { elementId: "a", focus: 0, gap: 10 },
    endBinding: { elementId: "ghost", focus: 0, gap: 10 },
  };
  const v1 = join(outDir, "v1.excalidrawlib");
  writeFileSync(v1, JSON.stringify({ type: "excalidrawlib", version: 1, library: [[rect, arrow]] }));
  const spliced = spliceLibraryItem(v1);
  check("a v1 library splices", spliced.children.length === 2);
  const [r, arr] = spliced.children;
  check("an in-item binding is remapped", arr.startBinding?.elementId === r.id,
    `${arr.startBinding?.elementId} vs ${r.id}`);
  check("a binding pointing outside the item is dropped", arr.endBinding == null);
  check("boundElements keeps only in-item references",
    r.boundElements?.length === 1 && r.boundElements[0].id === arr.id,
    JSON.stringify(r.boundElements));
}

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
  await reviseDiagram({ file: noneLeft, svg: false });
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
