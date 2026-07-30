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
 *   8. a failing write leaves the previous pair as it was
 *   9. a labelled arrow keeps its bound text through the gate and a revise
 *  10. a session authors N diagrams over one browser launch, without drift
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  writeFileSync } from "node:fs";
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

/** The smallest build that passes the gate: one measured line of text. */
const oneLine = (text) => async ({ measure, PROSE }) => {
  const [m] = await measure([{ text, fontSize: 18, fontFamily: PROSE }]);
  return [{ type: "text", x: 0, y: 0, text, fontSize: 18, fontFamily: PROSE,
    width: m.width, height: m.height }];
};

/**
 * A copy of the plugin whose tools/browser.js is replaced by `source` — a stub
 * that delegates to the real driver, so convert, the gate and playwright stay
 * real and only the one seam under test changes.
 */
function pluginCopyWith(label, source) {
  const dir = mkdtempSync(join(tmpdir(), `author-${label}-`));
  cpSync(join(root, "tools"), join(dir, "tools"), { recursive: true });
  cpSync(join(root, "brand"), join(dir, "brand"), { recursive: true });
  // outside the repo the copied .js files have no nearest "type": "module", and
  // only Node's ESM syntax detection saves them — carry the manifest instead
  cpSync(join(root, "package.json"), join(dir, "package.json"));
  writeFileSync(join(dir, "tools/browser.js"), source);
  return pathToFileURL(join(dir, "tools/author.js")).href;
}
const realBrowser = JSON.stringify(pathToFileURL(join(root, "tools/browser.js")).href);

// ---- 7. a failing SVG export leaves the output directory clean ----
// The stub sabotages the export step: the renderer breaks, which is the window
// where a half-written pair used to appear. It throws the PageError the real
// driver would, so the failure has the shape production produces.
{
  const brokenPlugin = pluginCopyWith(
    "export-fail",
    `import { withExcalidraw as real, PageError } from ${realBrowser};\n` +
      `export function withExcalidraw(fn, opts) {\n` +
      `  return real((ex) => fn({ ...ex, exportSvg: async () => {\n` +
      `    throw new PageError("exportSvg failed in the page: induced export failure");\n` +
      `  } }), opts);\n` +
      `}\n`,
  );
  const { authorDiagram: brokenAuthor } = await import(brokenPlugin);

  const out = join(outDir, "export-fails.excalidraw");
  const r = await rejectsWith("PageError", brokenAuthor({ out, build: oneLine("the export will fail") }));
  check("a failing SVG export propagates", r.ok && /induced export failure/.test(r.message ?? ""),
    r.detail);
  const svgOut = out.replace(/\.excalidraw$/, ".svg");
  check("a failing SVG export writes neither file", !existsSync(out) && !existsSync(svgOut),
    `${existsSync(out) ? "excalidraw written " : ""}${existsSync(svgOut) ? "svg written" : ""}`);
}

// ---- 8. a failing write leaves the previous pair as it was ----
// The export can succeed and the write still fail. A directory that refuses new
// files, with the render already gone, used to strand a rewritten .excalidraw
// with no .svg beside it; staging both bodies before either lands closes that.
// Permission bits only bind a non-root POSIX user, so elsewhere this is a skip.
if (process.platform === "win32" || process.getuid?.() === 0) {
  console.log("SKIP  a failing write leaves the previous pair as it was — needs POSIX bits, non-root");
} else {
  const dir = join(outDir, "readonly");
  const out = join(dir, "pair.excalidraw");
  const svgOut = out.replace(/\.excalidraw$/, ".svg");
  await authorDiagram({ out, build: oneLine("first pass") });
  const before = readFileSync(out, "utf8");
  rmSync(svgOut);
  chmodSync(dir, 0o555);
  const r = await rejectsWith("Error", authorDiagram({ out, build: oneLine("second pass") }));
  chmodSync(dir, 0o755);

  check("a failing write is loud", r.ok && /EACCES|EPERM/.test(r.message ?? ""), r.detail);
  check("a failing write leaves the document as it was",
    readFileSync(out, "utf8") === before, `document mentions second pass: ${/second pass/.test(readFileSync(out, "utf8"))}`);
  check("a failing write leaves no stray temp file",
    !existsSync(svgOut) && readdirSync(dir).join(",") === "pair.excalidraw", readdirSync(dir).join(","));
}

// ---- 9. a labelled arrow: bound, measured text that survives the gate ----
{
  const out = join(outDir, "labelled.excalidraw");
  const result = await authorDiagram({
    out,
    svg: false,
    build: async ({ row, box, arrowBetween, palette: p }) => {
      const card = (id, role) =>
        box({ type: "rectangle", x: 0, y: 0, width: 120, height: 60 },
          { padding: 16, id, strokeColor: p.roles[role].stroke, backgroundColor: p.roles[role].fill });
      const a = card("src", "local");
      const b = card("dst", "artifact");
      row([a, b], { gap: 120 });
      return [a, b, arrowBetween(a, b, { standoff: 10, label: "writes", strokeColor: p.grey.stroke })];
    },
  });
  const arrow = result.elements.find((e) => e.type === "arrow");
  const label = result.elements.find((e) => e.type === "text");
  check("the label converts to text bound to the arrow",
    label?.containerId === arrow.id, `container ${label?.containerId} vs arrow ${arrow.id}`);
  check("the label is measured, in the house font",
    label?.text === "writes" && label.fontFamily === PROSE && label.width > 0 && label.height > 0,
    `${label?.width?.toFixed(1)}x${label?.height?.toFixed(1)} family ${label?.fontFamily}`);
  check("the arrow lists its label in boundElements",
    arrow.boundElements?.some((be) => be.id === label.id && be.type === "text"),
    JSON.stringify(arrow.boundElements));
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), out], { encoding: "utf8" });
  check("a labelled arrow passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
  // the round-trip must not drop the binding: restore re-measures bound text
  const revised = await reviseDiagram({ file: out, svg: false });
  const revisedLabel = revised.elements.find((e) => e.type === "text");
  check("revise keeps the label bound to its arrow",
    revisedLabel?.containerId === revised.elements.find((e) => e.type === "arrow").id,
    `container ${revisedLabel?.containerId}`);
}

// ---- 10. one browser session authors many diagrams ----
// The three claims a session has to make: N diagrams cost one launch, a gate
// failure in the middle leaves the session usable, and accumulated font warming
// measures every glyph the same as a fresh browser would — the drift this whole
// pipeline exists to prevent.
{
  const RARE = "→ ∑ é ✓ warmed late";
  const ASCII = "plain ascii line";
  const widths = {};
  /** Record the measured width of `text` under `key`, and draw it. */
  const measuring = (key, text) => async ({ measure, PROSE }) => {
    const [m] = await measure([{ text, fontSize: 18, fontFamily: PROSE }]);
    widths[key] = m.width;
    return [{ type: "text", x: 0, y: 0, text, fontSize: 18, fontFamily: PROSE,
      width: m.width, height: m.height }];
  };
  const overlapping = async ({ PROSE }) => [
    { type: "text", x: 0, y: 0, text: "one", fontSize: 18, fontFamily: PROSE },
    { type: "text", x: 4, y: 4, text: "two", fontSize: 18, fontFamily: PROSE },
  ];

  // a fresh single-shot browser measures the rare glyphs with nothing warmed before them
  await authorDiagram({
    out: join(outDir, "fresh-rare.excalidraw"), svg: false, build: measuring("freshRare", RARE),
  });

  const countingPlugin = pluginCopyWith(
    "launch-count",
    `import { withExcalidraw as real } from ${realBrowser};\n` +
      `export let launches = 0;\n` +
      `export const launchCount = () => launches;\n` +
      `export function withExcalidraw(fn, opts) {\n` +
      `  launches++;\n` +
      `  return real(fn, opts);\n` +
      `}\n`,
  );
  const { authorDiagram: countedAuthor, withAuthoring } = await import(countingPlugin);
  const { launchCount } = await import(
    countingPlugin.replace(/author\.js$/, "browser.js")
  );

  const outs = ["s1", "s2", "s3"].map((n) => join(outDir, `session-${n}.excalidraw`));
  const gateOut = join(outDir, "session-gated.excalidraw");
  const session = await withAuthoring(async (author) => {
    const first = await author({ out: outs[0], svg: false, build: measuring("sessionAscii", ASCII) });
    const gated = await rejectsWith("GateError", author({ out: gateOut, build: overlapping }));
    const rare = await author({ out: outs[1], svg: false, build: measuring("sessionRare", RARE) });
    const again = await author({ out: outs[2], svg: false, build: measuring("sessionAsciiAgain", ASCII) });
    return { first, gated, rare, again };
  });

  check("a session authors every diagram", outs.every(existsSync), outs.map(existsSync).join(","));
  check("a session costs one browser launch, not one per diagram", launchCount() === 1,
    `${launchCount()} launches for a session of 3 diagrams`);
  check("a gate failure inside a session is a GateError that writes nothing",
    session.gated.ok && !existsSync(gateOut), session.gated.detail);
  check("the session survives a failed diagram",
    session.again.elements.length > 0 && existsSync(outs[2]), `then wrote ${outs[2]}`);
  check("no measurement drift across a session",
    widths.sessionAscii === widths.sessionAsciiAgain,
    `${widths.sessionAscii?.toFixed(2)} then ${widths.sessionAsciiAgain?.toFixed(2)}`);
  check("late glyphs measure as they do in a fresh browser",
    Math.abs(widths.sessionRare - widths.freshRare) < 0.01,
    `session ${widths.sessionRare?.toFixed(2)} vs fresh ${widths.freshRare?.toFixed(2)}`);

  // the single-shot API still opens and closes its own browser
  const solo = join(outDir, "still-single-shot.excalidraw");
  await countedAuthor({ out: solo, svg: false, build: measuring("solo", ASCII) });
  check("the single-shot API still launches per call", launchCount() === 2, `${launchCount()} launches`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nauthor API behaves");
process.exit(fail.length ? 1 : 0);
