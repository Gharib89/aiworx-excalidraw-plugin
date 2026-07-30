#!/usr/bin/env node
/**
 * Browser suite for the authoring API (tools/author.js). Pins the hardening
 * claims at the API a generator actually calls:
 *
 *   1. wrap never exceeds the requested width — measured, including the
 *      single-long-word case
 *   2. empty or malformed skeletons and unknown element types are rejected
 *      with a named error and nothing is written
 *   3. the geometry gate runs in-process before the file is written
 *   4. the output directory is created
 *   5. reviseDiagram round-trips a hand-edited file: the mangled file fails
 *      the gate, the revised file passes it
 *   6. the same round-trip on the committed example
 *   7. a failing SVG export leaves both files unwritten
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withExcalidraw } from "../tools/browser.js";
import { authorDiagram, reviseDiagram, makeWrap, PROSE } from "../tools/author.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "author-api-"));
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
    return {
      ok: err.name === errorName,
      message: String(err.message),
      detail: `${err.name}: ${String(err.message).split("\n")[0]}`,
    };
  }
};

// ---- 1. wrap honours the requested width, measured ----
await withExcalidraw(async (ex) => {
  const wrap = makeWrap(ex.measureText);
  const prose =
    "Parsing, layout and table structure all run on this machine. No key needed, nothing leaves the box.";
  for (const maxWidth of [140, 220, 400]) {
    const w = await wrap(prose, maxWidth, { fontSize: 16 });
    const lineWidths = (await ex.measureText(
      w.lines.map((text) => ({ text, fontSize: 16, fontFamily: PROSE })),
    )).map((m) => m.width);
    check(`wrapped prose fits ${maxWidth}px`,
      w.width <= maxWidth && lineWidths.every((lw) => lw <= maxWidth),
      `block ${w.width.toFixed(1)}, widest line ${Math.max(...lineWidths).toFixed(1)}`);
  }

  const longWord = "Antidisestablishmentarianismandthensomemore";
  const w = await wrap(longWord, 120, { fontSize: 16 });
  check("a single long word is broken to fit", w.lines.length > 1 && w.width <= 120,
    `${w.lines.length} lines, block ${w.width.toFixed(1)} vs 120`);
  check("the broken word loses no characters", w.lines.join("") === longWord, w.text);

  const mixed = await wrap(`short words then ${longWord} then more`, 120, { fontSize: 16 });
  check("long word inside prose still fits", mixed.width <= 120, `block ${mixed.width.toFixed(1)}`);

  const impossible = await rejectsWith("WrapError", wrap("word", 2, { fontSize: 16 }));
  check("an unsatisfiable width is a WrapError", impossible.ok, impossible.detail);
});

// ---- 2. malformed skeletons are rejected, named, nothing written ----
{
  const out = join(outDir, "empty.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({ out, build: async () => [] }));
  check("empty skeleton is a SkeletonError", r.ok, r.detail);
  check("empty skeleton writes nothing", !existsSync(out));
}
{
  const out = join(outDir, "nothing.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({ out, build: async () => undefined }));
  check("build returning nothing is a SkeletonError", r.ok, r.detail);
  check("build returning nothing writes nothing", !existsSync(out));
}
{
  const out = join(outDir, "notarray.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({ out, build: async () => "elements" }));
  check("non-array build is a SkeletonError", r.ok, r.detail);
}
{
  const out = join(outDir, "unknown.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => [{ type: "widget", x: 0, y: 0, width: 10, height: 10 }],
  }));
  check("unknown element type is a SkeletonError", r.ok && /widget/.test(r.detail), r.detail);
  check("unknown element type writes nothing", !existsSync(out));
}

// ---- 3. the gate runs in-process: a defective build writes nothing ----
{
  const out = join(outDir, "defective.excalidraw");
  const r = await rejectsWith("GateError", authorDiagram({
    out,
    build: async ({ PROSE }) => [
      { type: "text", x: 0, y: 0, text: "one", fontSize: 18, fontFamily: PROSE },
      { type: "text", x: 4, y: 4, text: "two", fontSize: 18, fontFamily: PROSE },
    ],
  }));
  check("a gate defect is a GateError before writing", r.ok && /free texts overlap/.test(r.message),
    r.detail);
  check("a gated build writes nothing", !existsSync(out) && !existsSync(out.replace(/\.excalidraw$/, ".svg")));
}

// ---- 4 + 5. happy path through the layout helpers, then the revise round-trip ----
const bandOut = join(outDir, "nested/dir/band.excalidraw");
{
  const result = await authorDiagram({
    out: bandOut,
    build: async ({ measure, wrap, row, column, box, arrowBetween, palette: p, PROSE }) => {
      const [title] = await measure([{ text: "revise me later", fontSize: 24, fontFamily: PROSE }]);
      const titleEl = {
        type: "text", id: "title", text: "revise me later", fontSize: 24, fontFamily: PROSE,
        strokeColor: p.grey.ink, width: title.width, height: title.height,
      };
      const card = async (id, role, text) => {
        const body = await wrap(text, 240, { fontSize: 16, fontFamily: PROSE });
        return box(
          { type: "text", text: body.text, fontSize: 16, fontFamily: PROSE,
            strokeColor: p.grey.ink, width: body.width, height: body.height },
          { padding: 20, id, strokeColor: p.roles[role].stroke,
            backgroundColor: p.roles[role].fill, roundness: { type: 3 } },
        );
      };
      const a = await card("cpu", "local", "Everything on this machine, no key needed.");
      const b = await card("api", "remote", "Calls a model over the network, costs money.");
      const cards = row([a, b], { gap: 60, align: "start" });
      const band = column([titleEl, cards], { gap: 28 });
      return [band, arrowBetween(a, b, { standoff: 10, strokeColor: p.grey.stroke, strokeWidth: 2 }),
        { type: "frame", children: ["title", "cpu", "api"], name: "1 · revise fixture" }];
    },
  });
  check("helpers author a band into a created directory", existsSync(bandOut),
    `${result.elements.length} elements`);
  check("the happy path writes both files", existsSync(result.svgOut), result.svgOut);
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), bandOut], { encoding: "utf8" });
  check("the helper-built band passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
}

// hand-edit: shorten the title but keep its stale (too-wide) metrics, and point
// an arrow binding at an element that does not exist
{
  const doc = JSON.parse(readFileSync(bandOut, "utf8"));
  // the converter regenerates ids, so find the title by its text
  const title = doc.elements.find((e) => e.type === "text" && /revise/.test(e.text));
  const staleWidth = title.width;
  title.text = "revised";
  const arrow = doc.elements.find((e) => e.type === "arrow");
  arrow.endBinding = { ...arrow.endBinding, elementId: "ghost" };
  writeFileSync(bandOut, JSON.stringify(doc, null, 2) + "\n");

  const before = spawnSync(process.execPath, [join(root, "tools/check.js"), bandOut], { encoding: "utf8" });
  check("the hand-mangled file fails the gate", before.status === 1,
    (before.stdout + before.stderr).trim().split("\n").filter((l) => l.includes("ghost")).join(" | "));

  const revised = await reviseDiagram({ file: bandOut });
  const after = spawnSync(process.execPath, [join(root, "tools/check.js"), bandOut], { encoding: "utf8" });
  check("revise makes the gate pass again", after.status === 0,
    (after.stdout + after.stderr).trim().split("\n").pop());
  const newTitle = revised.elements.find((e) => e.type === "text" && /revise/.test(e.text));
  check("revise refreshes stale text metrics", newTitle.width < staleWidth - 5,
    `${staleWidth.toFixed(1)} -> ${newTitle.width.toFixed(1)}`);
}

// ---- 6. the spec demo, on the committed example: hand-edit, revise, gate passes ----
{
  const copy = join(outDir, "example.excalidraw");
  const doc = JSON.parse(readFileSync(join(root, "examples/example.excalidraw"), "utf8"));
  doc.appState.theme = "dark"; // a human appState edit that must survive the round-trip
  // drag the title out of its frame: geometry moves, the stale frameId stays —
  // exactly what the app produces when a human rearranges a band
  const title = doc.elements.find((e) => e.type === "text" && e.text === "two lanes");
  title.y += 700;
  writeFileSync(copy, JSON.stringify(doc, null, 2) + "\n");

  const before = spawnSync(process.execPath, [join(root, "tools/check.js"), copy], { encoding: "utf8" });
  check("the hand-edited example fails the gate", before.status === 1,
    (before.stdout + before.stderr).trim().split("\n").filter((l) => l.includes("escapes")).join(" | "));

  await reviseDiagram({ file: copy });
  const after = spawnSync(process.execPath, [join(root, "tools/check.js"), copy], { encoding: "utf8" });
  check("revising the example makes the gate pass", after.status === 0,
    (after.stdout + after.stderr).trim().split("\n").pop());
  const revised = JSON.parse(readFileSync(copy, "utf8"));
  const movedTitle = revised.elements.find((e) => e.type === "text" && e.text === "two lanes");
  check("stale frame membership is cleared", movedTitle.frameId == null, `frameId ${movedTitle.frameId}`);
  check("the human's appState survives", revised.appState.theme === "dark" && revised.appState.gridSize === 20,
    JSON.stringify(revised.appState));
}

// revise rejects what it cannot parse, named
{
  const bad = join(outDir, "bad.excalidraw");
  writeFileSync(bad, "{ not json");
  const r = await rejectsWith("DocumentError", reviseDiagram({ file: bad }));
  check("revise names unparseable input", r.ok, r.detail);
  const foreign = join(outDir, "foreign.excalidraw");
  writeFileSync(foreign, JSON.stringify({ type: "not-excalidraw" }));
  const r2 = await rejectsWith("DocumentError", reviseDiagram({ file: foreign }));
  check("revise names a foreign document", r2.ok, r2.detail);
}

// ---- 7. a failing SVG export leaves the output directory clean ----
// A copy of the plugin whose browser layer delegates to the real one but
// sabotages the export step: convert and the gate stay real, only the renderer
// breaks — which is the window where a half-written pair used to appear. The
// stub throws the PageError the real driver would, so the failure has the shape
// production produces; it resolves playwright through the real plugin root.
{
  const pluginCopy = mkdtempSync(join(tmpdir(), "author-export-fail-"));
  cpSync(join(root, "tools"), join(pluginCopy, "tools"), { recursive: true });
  cpSync(join(root, "brand"), join(pluginCopy, "brand"), { recursive: true });
  const realBrowser = JSON.stringify(pathToFileURL(join(root, "tools/browser.js")).href);
  writeFileSync(
    join(pluginCopy, "tools/browser.js"),
    `import { withExcalidraw as real, PageError } from ${realBrowser};\n` +
      `export function withExcalidraw(fn, opts) {\n` +
      `  return real((ex) => fn({ ...ex, exportSvg: async () => {\n` +
      `    throw new PageError("exportSvg failed in the page: induced export failure");\n` +
      `  } }), opts);\n` +
      `}\n`,
  );
  const { authorDiagram: brokenAuthor } = await import(
    pathToFileURL(join(pluginCopy, "tools/author.js")).href
  );

  const out = join(outDir, "export-fails.excalidraw");
  const r = await rejectsWith("PageError", brokenAuthor({
    out,
    build: async ({ measure, PROSE }) => {
      const text = "the export will fail";
      const [m] = await measure([{ text, fontSize: 18, fontFamily: PROSE }]);
      return [{ type: "text", x: 0, y: 0, text, fontSize: 18, fontFamily: PROSE,
        width: m.width, height: m.height }];
    },
  }));
  check("a failing SVG export propagates", r.ok && /induced export failure/.test(r.message ?? ""),
    r.detail);
  const svgOut = out.replace(/\.excalidraw$/, ".svg");
  check("a failing SVG export writes neither file", !existsSync(out) && !existsSync(svgOut),
    `${existsSync(out) ? "excalidraw written " : ""}${existsSync(svgOut) ? "svg written" : ""}`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nauthor API behaves");
process.exit(fail.length ? 1 : 0);
