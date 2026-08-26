#!/usr/bin/env node
/**
 * Browser suite for the authoring API (tools/author.js). Pins the hardening
 * claims at the API a generator actually calls:
 *
 *   1. wrap never exceeds the requested width — measured, including the
 *      single-long-word case
 *   2. empty or malformed skeletons, unknown element types and a frame with no
 *      children list are rejected with a named error and nothing is written
 *   3. the geometry gate runs in-process before the file is written
 *   4. the output directory is created, and every path the success line reports
 *      is absolute — a relative `out:` run from another cwd names where it
 *      really landed
 *   5. reviseDiagram round-trips a hand-edited file: the mangled file fails
 *      the gate, the revised file passes it
 *   6. the same round-trip on the committed example
 *   7. a failing SVG export leaves both files unwritten
 *   8. a failing write leaves the previous pair as it was
 *   9. a labelled arrow keeps its bound text through the gate and a revise, and
 *      a revise that re-centered the label reports it where a quiet one is quiet
 *  10. a session authors N diagrams over one browser launch, without drift
 *  11. a computed orthogonal route reaches the converter as an elbow, stays
 *      bound at both ends, and passes the gate
 *  12. graph() called through the build context lays a diamond into distinct
 *      layers, resolves every arrow, and passes the gate
 *  13. fanOut() called through the build context lands three arrows at
 *      distinct points and passes the gate
 *  14. a community library item spliced with `text: "drop"` authors and gates
 *      clean, where the same item spliced by default still trips foreign-font
 *  15. the driver seam: a session's per-diagram author() cannot override the
 *      driver, and a misspelled driver key is a SkeletonError rather than a
 *      silent fallback to the real browser, on both authorDiagram and withAuthoring
 *  16. an output preset scales the type ramp and the proportions the build
 *      comes out at, `fit` is the unchanged default, and an unknown name is
 *      refused before anything is written
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { withExcalidraw, PageError } from "../tools/browser.js";
import { authorDiagram, reviseDiagram, makeWrap, withAuthoring, PROSE } from "../tools/author.js";

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
      error: err,
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
// a frame without children crashed the converter with a bare TypeError, after a
// browser launch: the skeleton door names the frame instead
{
  const out = join(outDir, "childless-frame.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => [{ type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 },
      { type: "frame", id: "fr", name: "panel" }],
  }));
  check("a frame without children is a SkeletonError naming the frame",
    r.ok && /fr/.test(r.detail), r.detail);
  // error-messages.js walks the sources for this bar; here it is on the error
  // the author actually catches, from the public call
  check("the refusal states what, where and next",
    Boolean(r.error?.what && r.error?.where && r.error?.next), r.message);
  check("a frame without children writes nothing", !existsSync(out));
}
{
  const out = join(outDir, "frame-children-string.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => [{ type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 },
      { type: "frame", id: "fr", name: "panel", children: "a" }],
  }));
  check("a frame whose children is not an array is a SkeletonError", r.ok, r.detail);
  check("a frame whose children is not an array writes nothing", !existsSync(out));
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
  check("the GateError carries the structured problems",
    Array.isArray(r.error?.problems) &&
      r.error.problems.some((p) => p.code === "free-text-overlap" && p.elements.length === 2),
    JSON.stringify(r.error?.problems));
  check("a gated build writes nothing", !existsSync(out) && !existsSync(out.replace(/\.excalidraw$/, ".svg")));
}

// ---- 4 + 5. happy path through the layout helpers, then the revise round-trip ----
const bandOut = join(outDir, "nested/dir/band.excalidraw");
{
  const result = await authorDiagram({
    out: bandOut,
    build: async ({ measure, wrap, row, column, box, arrowBetween, flatten, palette: p, PROSE }) => {
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
      // flatten comes through the build context: collect the frame's children
      // from the composed group instead of listing ids by hand
      const children = flatten(band).map((el) => el.id).filter(Boolean);
      return [band, arrowBetween(a, b, { standoff: 10, strokeColor: p.grey.stroke, strokeWidth: 2 }),
        { type: "frame", children, name: "1 · revise fixture" }];
    },
  });
  check("helpers author a band into a created directory", existsSync(bandOut),
    `${result.elements.length} elements`);
  check("the happy path writes both files", existsSync(result.svgOut), result.svgOut);
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), bandOut], { encoding: "utf8" });
  check("the helper-built band passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
}

// a relative `out:` resolves against the process cwd, so a generator run from
// somewhere else writes somewhere else. Echoing the path as given made the two
// reports identical; the resolved path puts the trap in the output itself.
{
  const before = process.cwd();
  const lines = [];
  const log = console.log;
  // mkdtemp hands back a path that may be a symlink (/var on macOS); cwd inside
  // is the resolved one, and that is what the report must match
  let cwd;
  let result;
  try {
    process.chdir(outDir);
    cwd = process.cwd();
    console.log = (...args) => lines.push(...args.join(" ").split("\n"));
    result = await authorDiagram({
      out: "elsewhere/band.excalidraw",
      build: () => [{ type: "rectangle", id: "only", x: 0, y: 0, width: 100, height: 60 }],
    });
  } finally {
    console.log = log;
    process.chdir(before);
  }
  const written = join(cwd, "elsewhere/band.excalidraw");
  const writtenSvg = join(cwd, "elsewhere/band.svg");
  check("a relative out: reports the absolute path it wrote",
    lines[0]?.startsWith(`${written}  `), lines.join(" | "));
  check("the .svg line is absolute too", lines[1] === writtenSvg, lines.join(" | "));
  // absolute and the file that was actually written — an absolute path alone
  // could still name somewhere else
  check("the returned paths name the files it wrote",
    isAbsolute(result.out) && result.out === written &&
      isAbsolute(result.svgOut) && result.svgOut === writtenSvg,
    `${result.out}, ${result.svgOut}`);
  check("both written files exist where they were reported",
    existsSync(written) && existsSync(writtenSvg), `${written}, ${writtenSvg}`);
}

// a computed orthogonal route survives the real converter and the real gate:
// axis-aligned all the way, still bound at both ends, crossing neither shape.
// Fixed rectangle sizes keep the expected path independent of text measurement,
// so this asserts the same geometry on every OS in the matrix.
{
  const out = join(outDir, "elbow.excalidraw");
  const result = await authorDiagram({
    out,
    build: ({ arrowBetween, palette: p, PROSE }) => {
      const stage = (id, x, y, text) => ({
        type: "rectangle", id, x, y, width: 200, height: 80,
        label: { text, fontSize: 16, fontFamily: PROSE, strokeColor: p.grey.ink },
        strokeColor: p.roles.local.stroke, backgroundColor: p.roles.local.fill,
        roundness: { type: 3 },
      });
      const a = stage("src", 0, 0, "source");
      const b = stage("dst", 320, 220, "target");
      return [a, b, arrowBetween(a, b, { standoff: 10, route: "orthogonal",
        strokeColor: p.grey.stroke, strokeWidth: 2 })];
    },
  });
  const arrow = result.elements.find((el) => el.type === "arrow");
  const abs = arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py]);
  const axisAligned = abs.every(([px, py], i) =>
    i === 0 || px === abs[i - 1][0] || py === abs[i - 1][1]);
  // the converter nudges a bound endpoint a half pixel *along* its own run, so
  // pin the elbow's shape — the two vertical runs and the mid-line jog between
  // them — rather than the endpoint coordinates it is free to adjust
  check("the routed arrow reaches the converter as an elbow",
    abs.length === 4 && abs[0][0] === 100 && abs[3][0] === 420 &&
      abs[1][1] === 150 && abs[2][1] === 150, JSON.stringify(abs));
  check("every routed segment is axis-aligned", axisAligned, JSON.stringify(abs));
  // acceptance criterion, measured on real output: the route owns the gap, so
  // every vertex sits between the source's bottom edge and the target's top
  check("the routed arrow clears both shapes it connects",
    abs.every(([, py]) => py > 80 && py < 220), JSON.stringify(abs));
  check("the routed arrow keeps its corners through the converter", arrow.roundness === null);
  check("the routed arrow stays bound at both ends",
    arrow.startBinding?.elementId === "src" && arrow.endBinding?.elementId === "dst",
    `${arrow.startBinding?.elementId} -> ${arrow.endBinding?.elementId}`);
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), out], { encoding: "utf8" });
  check("the routed diagram passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
}

// the failure shape from #108, end to end: compose each panel at its own local
// origin, bind it there, and only then place the whole band with one row. The
// arrows are written before the mover that shifts them, which used to leave them
// on local coordinates and surface as frame-escape / frames-overlap defects whose
// element boxes read local while the frame boxes read global.
{
  const out = join(outDir, "deferred.excalidraw");
  const PITCH = 520; // panel body 320 wide + the band row's 200 gap
  const result = await authorDiagram({
    out,
    build: ({ row, arrowBetween, flatten, palette: p, PROSE }) => {
      const stage = (id, role, text) => ({
        type: "rectangle", id, width: 120, height: 60,
        label: { text, fontSize: 16, fontFamily: PROSE, strokeColor: p.grey.ink },
        strokeColor: p.roles[role].stroke, backgroundColor: p.roles[role].fill,
      });
      const panels = [0, 1].map((i) => {
        const from = stage(`p${i}-from`, "local", "read");
        const to = stage(`p${i}-to`, "artifact", "write");
        const body = row([from, to], { gap: 80, align: "center" });
        // bound here, at the local origin, before the band-level row runs
        const arrow = arrowBetween(from, to,
          { standoff: 10, id: `p${i}-arr`, strokeColor: p.grey.stroke, endArrowhead: "triangle" });
        return { body, arrow, frame: {
          type: "frame", id: `p${i}-frame`, name: `${i + 1} · panel`,
          children: [...flatten(body).map((el) => el.id), `p${i}-arr`],
        } };
      });
      // the last mover: it shifts every element inside every panel
      row(panels.map((pl) => pl.body), { gap: 200, align: "start" });
      return [...panels.flatMap((pl) => [pl.body, pl.arrow]), ...panels.map((pl) => pl.frame)];
    },
  });
  const arrows = result.elements.filter((el) => el.type === "arrow")
    .sort((l, r) => l.x - r.x);
  check("an arrow bound before the last mover lands on the moved coordinates",
    arrows.length === 2 && arrows[1].x > arrows[0].x + PITCH - 1 &&
      arrows[1].x < arrows[0].x + PITCH + 1,
    arrows.map((a) => a.x).join(" / "));
  check("a frame claims the deferred arrow its children named",
    arrows[0].frameId === "p0-frame" && arrows[1].frameId === "p1-frame",
    arrows.map((a) => `${a.id}:${a.frameId}`).join(" "));
  check("the deferred arrows stay bound at both ends",
    arrows.every((a, i) => a.startBinding?.elementId === `p${i}-from` &&
      a.endBinding?.elementId === `p${i}-to`),
    arrows.map((a) => `${a.startBinding?.elementId}->${a.endBinding?.elementId}`).join(" "));
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), out], { encoding: "utf8" });
  check("the band bound before its last mover passes the CLI gate", gate.status === 0,
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

// revise clears the membership geometry no longer supports — but it reads the
// same ink the gate does, so a rotated ellipse that fits keeps its frame
{
  const turned = join(outDir, "rotated-in-frame.excalidraw");
  cpSync(join(root, "tests/fixtures/rotated-ellipse-in-frame.excalidraw"), turned);
  await reviseDiagram({ file: turned, svg: false });
  const ellipse = JSON.parse(readFileSync(turned, "utf8")).elements.find((e) => e.type === "ellipse");
  check("a rotated ellipse inside its frame keeps its membership",
    ellipse.frameId === "f1", `frameId ${ellipse.frameId}`);
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

// ---- 7. a failing SVG export leaves the output directory clean ----
// The driver sabotages the export step: the renderer breaks, which is the window
// where a half-written pair used to appear. It throws the PageError the real
// driver would, so the failure has the shape production produces.
{
  const exportFailDriver = (fn) => withExcalidraw((ex) => fn({
    ...ex,
    exportSvg: async () => {
      throw new PageError("exportSvg failed in the page: induced export failure");
    },
  }));

  const out = join(outDir, "export-fails.excalidraw");
  const r = await rejectsWith("PageError",
    authorDiagram({ out, build: oneLine("the export will fail"), driver: exportFailDriver }));
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
  // A revise that moved nothing says nothing: the report is a signal, not a
  // running commentary on every bound label in the file.
  check("a revise that re-centered nothing reports nothing",
    Array.isArray(revised.recentered) && revised.recentered.length === 0,
    JSON.stringify(revised.recentered));

  // The snap-back this reports: restore re-centers a hand-moved bound label onto
  // its arrow's path, by design (CONTEXT.md, Bound label). Silently, it read as
  // a no-op revise — the move was undone with nothing written or printed.
  const moved = JSON.parse(readFileSync(out, "utf8"));
  const movedLabel = moved.elements.find((e) => e.type === "text");
  const centred = { x: movedLabel.x, y: movedLabel.y };
  movedLabel.y -= 60;
  writeFileSync(out, JSON.stringify(moved, null, 2) + "\n");
  const rerevised = await reviseDiagram({ file: out, svg: false });
  check("revise names the bound label it re-centered",
    rerevised.recentered?.length === 1 && rerevised.recentered[0].id === movedLabel.id
      && rerevised.recentered[0].containerId === arrow.id,
    JSON.stringify(rerevised.recentered));
  const snapped = rerevised.elements.find((e) => e.type === "text");
  check("the re-centered label is back on its arrow",
    snapped.x === centred.x && snapped.y === centred.y,
    `${snapped.x},${snapped.y} vs ${centred.x},${centred.y}`);
}

// ---- 10. one browser session authors many diagrams ----
// The claims a session has to make: N diagrams cost one launch, a gate failure
// in the middle leaves the session usable, and accumulated font warming measures
// every glyph the same as a fresh browser would — including after an SVG export
// and across a concurrent batch, which is the drift this whole pipeline exists
// to prevent. The single-shot API keeps launching per call.
{
  const RARE = "→ ∑ é ✓ warmed late";
  const RARER = ["ł ø ð œ first", "ħ ŋ ĸ þ second", "ə ʒ ʧ ʤ third"];
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

  // fresh single-shot browsers measure each string with nothing warmed before it —
  // the reference every in-session measurement has to match
  for (const [i, text] of [RARE, ...RARER].entries()) {
    await authorDiagram({
      out: join(outDir, `fresh-${i}.excalidraw`), svg: false, build: measuring(`fresh${i}`, text),
    });
  }

  let launches = 0;
  const countingDriver = (fn) => { launches++; return withExcalidraw(fn); };

  const outs = ["s1", "s2", "s3", "s4"].map((n) => join(outDir, `session-${n}.excalidraw`));
  const gateOut = join(outDir, "session-gated.excalidraw");
  const session = await withAuthoring(async (author) => {
    const first = await author({ out: outs[0], svg: false, build: measuring("sessionAscii", ASCII) });
    const gated = await rejectsWith("GateError", author({ out: gateOut, build: overlapping }));
    const rare = await author({ out: outs[1], svg: false, build: measuring("sessionRare", RARE) });
    // the default path: an SVG export between one diagram's measurements and the
    // next's. Export is what warms the fonts, and the rules it emits are subset
    // to the glyphs it just rendered — so this is where a session could drift.
    const exported = await author({ out: outs[2], build: measuring("sessionExported", RARE) });
    const again = await author({ out: outs[3], svg: false, build: measuring("sessionAsciiAgain", ASCII) });
    return { first, gated, rare, exported, again };
  }, { driver: countingDriver });

  check("a session authors every diagram", outs.every(existsSync), outs.map(existsSync).join(","));
  check("a session costs one browser launch, not one per diagram", launches === 1,
    `${launches} launches for a session of ${outs.length} diagrams`);
  check("a session still writes the SVG beside the document",
    existsSync(session.exported.svgOut), session.exported.svgOut);
  check("a gate failure inside a session is a GateError that writes nothing",
    session.gated.ok && !existsSync(gateOut), session.gated.detail);
  check("the session survives a failed diagram",
    session.again.elements.length > 0 && existsSync(outs[3]), `then wrote ${outs[3]}`);
  check("no measurement drift across a session, export included",
    widths.sessionAscii === widths.sessionAsciiAgain,
    `${widths.sessionAscii?.toFixed(2)} then ${widths.sessionAsciiAgain?.toFixed(2)}`);
  check("late glyphs measure as they do in a fresh browser",
    Math.abs(widths.sessionRare - widths.fresh0) < 0.01,
    `session ${widths.sessionRare?.toFixed(2)} vs fresh ${widths.fresh0?.toFixed(2)}`);

  // A batch generator's natural shape is Promise.all over its panels, and the
  // page's font warming assumes one call in flight at a time (tools/page.js):
  // overlap the warms and a measurement lands on the fallback face, silently.
  // Each of these three carries glyphs the others do not, so all three re-warm.
  await withAuthoring(async (author) =>
    Promise.all(RARER.map((text, i) =>
      author({ out: join(outDir, `batch-${i}.excalidraw`), svg: false,
        build: measuring(`batch${i}`, text) }))),
  { driver: countingDriver });
  const drifted = RARER
    .map((_, i) => ({ i, batch: widths[`batch${i}`], fresh: widths[`fresh${i + 1}`] }))
    .filter(({ batch, fresh }) => Math.abs(batch - fresh) >= 0.01);
  check("a concurrent batch measures like a fresh browser", drifted.length === 0,
    drifted.map(({ i, batch, fresh }) =>
      `#${i} batch ${batch?.toFixed(2)} vs fresh ${fresh?.toFixed(2)}`).join("; ") ||
      `${RARER.length} concurrent diagrams, no drift`);

  // A diagram handed out but never awaited — a forEach over the panels, a
  // forgotten await on the Promise.all — is still work the session promised to
  // do. Closing the browser when the callback resolves would abandon it
  // mid-flight, and which files landed would depend on timing. (The .catch keeps
  // the loose promise from crashing the run on the way to the check.)
  const loose = join(outDir, "unawaited.excalidraw");
  await withAuthoring(async (author) => {
    author({ out: loose, svg: false, build: measuring("loose", ASCII) }).catch(() => {});
  }, { driver: countingDriver });
  check("a session finishes diagrams the caller never awaited", existsSync(loose),
    `${loose} ${widths.loose === undefined ? "never built" : "written"}`);

  // ...and the same holds when the callback itself throws: the caller's error is
  // the one that comes back, over the files the session had already promised
  const looseThrown = join(outDir, "unawaited-then-throw.excalidraw");
  const thrown = await rejectsWith("RangeError", withAuthoring(async (author) => {
    author({ out: looseThrown, svg: false, build: measuring("looseThrown", ASCII) }).catch(() => {});
    throw new RangeError("the generator gave up mid-batch");
  }, { driver: countingDriver }));
  check("a callback that throws still leaves its diagrams written",
    thrown.ok && existsSync(looseThrown), `${thrown.detail}; written ${existsSync(looseThrown)}`);

  // the single-shot API still opens and closes its own browser
  const solo = join(outDir, "still-single-shot.excalidraw");
  await authorDiagram({ out: solo, svg: false, build: measuring("solo", ASCII), driver: countingDriver });
  check("the single-shot API still launches per call", launches === 5, `${launches} launches`);

  // ---- 15. the driver seam's guard rails ----
  // A session already committed to a browser; a per-diagram driver override is
  // something it cannot honor, so it is a loud SkeletonError rather than a
  // silently ignored option — the same silent-failure class issue #161 closed.
  const sessionDriverOut = join(outDir, "session-driver-override.excalidraw");
  await withAuthoring(async (author) => {
    const r = await rejectsWith("SkeletonError", author({
      out: sessionDriverOut, svg: false, build: oneLine("x"), driver: countingDriver,
    }));
    check("a session's per-diagram author() rejects a driver override",
      r.ok && /driver/.test(r.message), r.detail);
  });

  // A misspelled driver key must not fall back to the real browser unnoticed.
  const misspelled = await rejectsWith("SkeletonError", withAuthoring(async () => {}, { drivr: countingDriver }));
  check("withAuthoring rejects a misspelled options key", misspelled.ok, misspelled.detail);

  // A driver the seam cannot call fails named, not as a raw TypeError from the
  // call site — null slips past a destructuring default, which only covers
  // undefined.
  const nullDriver = await rejectsWith("SkeletonError", authorDiagram({
    out: join(outDir, "null-driver.excalidraw"), build: oneLine("x"), driver: null,
  }));
  check("authorDiagram rejects a non-function driver",
    nullDriver.ok && /options\.driver/.test(nullDriver.message), nullDriver.detail);
  const stringDriver = await rejectsWith("SkeletonError", withAuthoring(async () => {}, { driver: "nope" }));
  check("withAuthoring rejects a non-function driver",
    stringDriver.ok && /options\.driver/.test(stringDriver.message), stringDriver.detail);

  // ...and the next action a diagram author reads never offers the seam: the
  // accepted set includes driver, the message names only the authoring options.
  const driverTypo = await rejectsWith("SkeletonError", authorDiagram({
    out: join(outDir, "driver-typo.excalidraw"), build: oneLine("x"), drver: countingDriver,
  }));
  check("authorDiagram rejects a misspelled driver key too",
    driverTypo.ok && !/driver/.test(driverTypo.message), driverTypo.detail);
}

// ---- 11. the finish register: one setting, applied to every element it governs ----
{
  const out = join(outDir, "register.excalidraw");
  const result = await authorDiagram({
    out,
    svg: false,
    register: {
      roughness: 0,
      strokeStyle: "dashed",
      strokeWidth: 4,
      fillStyle: "hachure",
      endArrowhead: "triangle",
      startArrowhead: "bar",
    },
    build: async ({ row, box, arrowBetween, palette: p, PROSE }) => {
      const card = (id, role) =>
        box({ type: "rectangle", x: 0, y: 0, width: 120, height: 60 },
          { padding: 16, id, strokeColor: p.roles[role].stroke, backgroundColor: p.roles[role].fill });
      const a = card("src", "local");
      const b = card("dst", "artifact");
      row([a, b], { gap: 120 });
      return [a, b, arrowBetween(a, b, { standoff: 10, strokeColor: p.grey.stroke }),
        { type: "text", x: 0, y: 200, text: "caption", fontSize: 18, fontFamily: PROSE }];
    },
  });
  const shapes = result.elements.filter((e) => e.type === "rectangle");
  const arrow = result.elements.find((e) => e.type === "arrow");
  check("the register reaches every shape it governs",
    shapes.length === 4 && shapes.every((e) =>
      e.roughness === 0 && e.strokeStyle === "dashed" && e.strokeWidth === 4 && e.fillStyle === "hachure"),
    JSON.stringify(shapes.map((e) => [e.roughness, e.strokeStyle, e.strokeWidth, e.fillStyle])));
  check("the register reaches the arrow, arrowheads included",
    arrow?.roughness === 0 && arrow.strokeStyle === "dashed" && arrow.strokeWidth === 4 &&
      arrow.startArrowhead === "bar" && arrow.endArrowhead === "triangle",
    `${arrow?.roughness}/${arrow?.strokeStyle}/${arrow?.strokeWidth}/${arrow?.startArrowhead}/${arrow?.endArrowhead}`);
  const caption = result.elements.find((e) => e.type === "text");
  check("the register leaves text alone", caption?.roughness !== 0 && caption?.strokeWidth !== 4,
    `roughness ${caption?.roughness}, strokeWidth ${caption?.strokeWidth}`);
}

// a register is a default, not a law: the deliberate break still wins
{
  const out = join(outDir, "register-override.excalidraw");
  const result = await authorDiagram({
    out,
    svg: false,
    register: { roughness: 1, strokeWidth: 2, endArrowhead: "triangle" },
    build: async ({ row, box, arrowBetween, palette: p }) => {
      const card = (id, role, props = {}) =>
        box({ type: "rectangle", x: 0, y: 0, width: 120, height: 60 },
          { padding: 16, id, strokeColor: p.roles[role].stroke,
            backgroundColor: p.roles[role].fill, ...props });
      const a = card("src", "local", { roughness: 0 });
      const b = card("dst", "artifact");
      row([a, b], { gap: 120 });
      return [a, b, arrowBetween(a, b,
        { standoff: 10, strokeColor: p.grey.stroke, endArrowhead: null })];
    },
  });
  const precise = result.elements.find((e) => e.id === "src");
  const housed = result.elements.find((e) => e.id === "dst");
  const arrow = result.elements.find((e) => e.type === "arrow");
  check("a per-element value wins over the register",
    precise?.roughness === 0 && housed?.roughness === 1,
    `src ${precise?.roughness}, dst ${housed?.roughness}`);
  check("an explicit null wins over the register too", arrow?.endArrowhead === null,
    `endArrowhead ${JSON.stringify(arrow?.endArrowhead)}`);
  check("the register still fills what the element left unset", precise?.strokeWidth === 2,
    `strokeWidth ${precise?.strokeWidth}`);
}

// a typo in the register is a SkeletonError, not a silently ignored setting
{
  const out = join(outDir, "register-typo.excalidraw");
  const r = await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    register: { stroke_width: 2 },
  }));
  check("an unknown register property is a SkeletonError",
    r.ok && /stroke_width/.test(r.message) && /strokeWidth/.test(r.message), r.detail);
  check("an unknown register property writes nothing", !existsSync(out));

  const bad = await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    register: { fillStyle: "hatched" },
  }));
  check("an out-of-vocabulary register value is a SkeletonError",
    bad.ok && /hatched/.test(bad.message) && /hachure/.test(bad.message), bad.detail);

  // the typo is caught before the build spends a browser on measuring
  let built = false;
  await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => { built = true; return [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]; },
    register: { roughness: 3 },
  }));
  check("a bad register is rejected before the build runs", !built);
}

// a typo in the top-level options is a SkeletonError, not a silently dropped
// one — caught before withExcalidraw ever launches a browser
{
  const out = join(outDir, "options-typo.excalidraw");
  let built = false;
  const r = await rejectsWith("SkeletonError", authorDiagram({
    out,
    build: async () => { built = true; return [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]; },
    regster: {},
  }));
  check("an unknown option is a SkeletonError naming it",
    r.ok && /regster/.test(r.message), r.detail);
  check("an unknown option's refusal lists the accepted set",
    /out/.test(r.message) && /build/.test(r.message) && /svg/.test(r.message) && /register/.test(r.message),
    r.detail);
  check("an unknown option is rejected before the build runs", !built);
  check("an unknown option writes nothing", !existsSync(out));

  const validOut = join(outDir, "options-valid.excalidraw");
  const result = await authorDiagram({
    out: validOut,
    svg: false,
    build: async () => [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    register: { roughness: 0 },
  });
  check("a call using only accepted options still authors", result.elements.length > 0, result.elements.length);
}

// withAuthoring's author() funnels through the same guard: the typo fails its
// one diagram and leaves the session usable for the next
{
  const sessionOut = join(outDir, "options-typo-session.excalidraw");
  let sessionBuilt = false;
  let typoRefused = false;
  await withAuthoring(async (author) => {
    try {
      await author({ out: join(outDir, "never.excalidraw"), svg: false, regster: {}, build: async () => [] });
    } catch (e) {
      typoRefused = e.name === "SkeletonError" && /regster/.test(e.message);
    }
    await author({
      out: sessionOut,
      svg: false,
      build: async () => { sessionBuilt = true; return [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]; },
    });
  });
  check("withAuthoring's author() refuses the same typo", typoRefused);
  check("the session survives the refusal and authors the next diagram", sessionBuilt && existsSync(sessionOut));
}

// a closed line fills like an area shape, so the register's fill has to reach it
{
  const out = join(outDir, "register-line.excalidraw");
  const result = await authorDiagram({
    out,
    svg: false,
    register: { fillStyle: "cross-hatch", strokeWidth: 3 },
    build: async ({ palette: p }) => [{
      type: "line", x: 0, y: 0, width: 120, height: 100,
      points: [[0, 0], [120, 0], [60, 100], [0, 0]],
      strokeColor: p.roles.local.stroke, backgroundColor: p.roles.local.fill,
    }],
  });
  const line = result.elements.find((e) => e.type === "line");
  check("the register's fill reaches a closed line",
    line?.fillStyle === "cross-hatch" && line.strokeWidth === 3,
    `${line?.fillStyle} / ${line?.strokeWidth}`);
}

/** One measured line in a padded box — the node shape both layout cases build. */
const nodeBox = ({ measure, box, palette: p, PROSE }) => async (id, text) => {
  const [m] = await measure([{ text, fontSize: 18, fontFamily: PROSE }]);
  return box(
    { type: "text", text, fontSize: 18, fontFamily: PROSE, strokeColor: p.grey.ink,
      width: m.width, height: m.height },
    { id, padding: 20, strokeColor: p.roles.local.stroke, backgroundColor: p.roles.local.fill },
  );
};

// ---- 12. graph() through the build context: a diamond graph reaches the gate ----
{
  const out = join(outDir, "graph-diamond.excalidraw");
  const result = await authorDiagram({
    out,
    build: async (ctx) => {
      const { graph, palette: p } = ctx;
      const label = nodeBox(ctx);
      const a = await label("gd-a", "Start");
      const b = await label("gd-b", "Left");
      const c = await label("gd-c", "Right");
      const d = await label("gd-d", "End");
      const { g, arrows } = await graph(
        [a, b, c, d],
        [[a, b, { label: "yes" }], [a, c], [b, d], [c, d]],
        { direction: "down", strokeColor: p.grey.stroke },
      );
      return [g, ...arrows];
    },
  });
  check("graph() authors a diamond graph through authorDiagram", existsSync(out),
    `${result.elements.length} elements`);
  const byId = new Map(result.elements.map((e) => [e.id, e]));
  const [a, b, c, d] = ["gd-a", "gd-b", "gd-c", "gd-d"].map((id) => byId.get(id));
  check("graph() lays the diamond into three distinct layers",
    a && b && c && d && a.y < b.y && b.y === c.y && c.y < d.y,
    `a=${a?.y} b=${b?.y} c=${c?.y} d=${d?.y}`);
  const graphArrows = result.elements.filter((e) => e.type === "arrow");
  check("every graph() arrow resolves to real points",
    graphArrows.length === 4 && graphArrows.every((ar) => Array.isArray(ar.points) && ar.points.length >= 2),
    `${graphArrows.length} arrows`);
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), out], { encoding: "utf8" });
  check("the graph()-built diamond passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
}

// ---- 13. fanOut() through the build context: one source, three landings, gated ----
{
  const out = join(outDir, "fanout-band.excalidraw");
  const result = await authorDiagram({
    out,
    build: async (ctx) => {
      const { row, column, fanOut, palette: p } = ctx;
      const label = nodeBox(ctx);
      const src = await label("fo-src", "Source");
      const t1 = await label("fo-t1", "One");
      const t2 = await label("fo-t2", "Two");
      const t3 = await label("fo-t3", "Three");
      const targets = column([t1, t2, t3], { gap: 30 });
      const band = row([src, targets], { gap: 120, align: "center" });
      return [band, ...fanOut(src, [t1, t2, t3], { standoff: 10, strokeColor: p.grey.stroke })];
    },
  });
  check("fanOut() authors a fan through authorDiagram", existsSync(out), `${result.elements.length} elements`);
  const fanArrows = result.elements.filter((e) => e.type === "arrow");
  const landings = fanArrows.map((ar) => {
    const last = ar.points[ar.points.length - 1];
    return [ar.x + last[0], ar.y + last[1]];
  });
  const distinct = new Set(landings.map((pt) => pt.join(","))).size;
  check("fanOut()'s three arrows land at pairwise distinct points",
    fanArrows.length === 3 && distinct === 3,
    `${fanArrows.length} arrows, landings ${JSON.stringify(landings)}`);
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), out], { encoding: "utf8" });
  check("the fanOut()-built fan passes the CLI gate", gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());
}

// ---- 14. a spliced community item: text: "drop" reaches the gate clean ----
//
// Every item of a real community library labels itself in Excalidraw's own
// faces, so the default splice hands the gate foreign-font on text the author
// never wrote. This is the whole-pipeline half of the claim: the unit contract
// lives in tests/splice.js, what matters here is that a dropped item authors
// and gates, and that the default still refuses.
{
  const libEl = (id, extra) => ({
    id, type: "rectangle", x: 0, y: 0, width: 60, height: 60, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
    groupIds: ["icon-group"], frameId: null, roundness: null, seed: 1, version: 1,
    versionNonce: 1, isDeleted: false, boundElements: null, link: null, locked: false,
    ...extra,
  });
  const libPath = join(outDir, "community.excalidrawlib");
  writeFileSync(libPath, JSON.stringify({
    type: "excalidrawlib", version: 2,
    libraryItems: [{
      name: "Kinesis",
      elements: [
        libEl("pictogram"),
        libEl("own-label", {
          type: "text", x: 0, y: 80, width: 66, height: 25, text: "Kinesis",
          fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top",
          containerId: null, originalText: "Kinesis", lineHeight: 1.25,
        }),
      ],
    }],
  }));

  const out = join(outDir, "spliced-dropped.excalidraw");
  const result = await authorDiagram({
    out,
    build: async ({ spliceLibraryItem }) => [spliceLibraryItem(libPath, { item: "Kinesis", text: "drop" })],
  });
  check('a text: "drop" splice authors without the item\'s own label',
    existsSync(out) && result.elements.length === 1,
    `${result.elements.length} elements`);
  const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), out], { encoding: "utf8" });
  check('the text: "drop" splice passes the CLI gate', gate.status === 0,
    (gate.stdout + gate.stderr).trim().split("\n").pop());

  const kept = await rejectsWith("GateError", authorDiagram({
    out: join(outDir, "spliced-kept.excalidraw"),
    build: async ({ spliceLibraryItem }) => [spliceLibraryItem(libPath, { item: "Kinesis" })],
  }));
  check("the default splice of the same item still trips foreign-font",
    kept.ok && kept.error?.problems?.some((p) => p.code === "foreign-font"),
    kept.detail);
  check("the refused default splice wrote nothing",
    !existsSync(join(outDir, "spliced-kept.excalidraw")));
}

// ---- 16. output presets: one build, two surfaces, two type ramps ----
{
  // The same build twice, differing only in `preset`. It reads `ramp` for its
  // own text and `surface` for the width it wraps to, which is the whole
  // mechanism: the ramp is chosen before anything is measured, so the cards
  // grow with the words instead of the picture being scaled afterwards.
  const build = async ({ measure, wrap, palette, PROSE: prose, ramp, surface, box, column, arrowBetween }) => {
    const width = surface ? surface.width / 3 : 320;
    const heading = { type: "text", id: "heading", text: "Gate", fontSize: ramp.title, fontFamily: prose,
      strokeColor: palette.ink };
    const [m] = await measure([{ text: heading.text, fontSize: ramp.title, fontFamily: prose }]);
    Object.assign(heading, m);
    const wrapped = await wrap("Measured text, then the gate refuses per problem.", width,
      { fontSize: ramp.label, fontFamily: prose });
    const body = { type: "text", id: "body", fontSize: ramp.label, fontFamily: prose,
      strokeColor: palette.ink, ...wrapped };
    const card = box(column([heading, body], { gap: 12 }), {
      id: "card", padding: 20, strokeColor: palette.grey.stroke, backgroundColor: palette.grey.fill,
    });
    const sink = box({ type: "text", id: "sink-text", text: "ship", fontSize: ramp.label,
      fontFamily: prose, strokeColor: palette.ink,
      ...(await measure([{ text: "ship", fontSize: ramp.label, fontFamily: prose }]))[0] },
      { id: "sink", padding: 20, strokeColor: palette.grey.stroke, backgroundColor: palette.grey.fill });
    column([card, sink], { gap: 120 });
    return [card, sink, arrowBetween(card, sink, { label: "writes", strokeColor: palette.grey.stroke })];
  };

  const shot = async (preset) => {
    const out = join(outDir, `preset-${preset}.excalidraw`);
    const r = await authorDiagram({ out, build, preset });
    const doc = JSON.parse(readFileSync(out, "utf8"));
    const size = (els) => {
      const xs = els.flatMap((e) => [e.x, e.x + e.width]);
      const ys = els.flatMap((e) => [e.y, e.y + e.height]);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    return { out, doc, r, ...size(doc.elements), heading: doc.elements.find((e) => e.id === "heading") };
  };

  const slide = await shot("slide-16x9");
  const inline = await shot("doc-inline");
  check("a preset scales the type ramp the build asked for",
    slide.heading.fontSize === 60 && inline.heading.fontSize === 22,
    `${slide.heading.fontSize} vs ${inline.heading.fontSize}`);
  check("the ramp reaches an arrow label with no size of its own",
    slide.doc.elements.find((e) => e.text === "writes")?.fontSize === 30 &&
      inline.doc.elements.find((e) => e.text === "writes")?.fontSize === 13,
    `${slide.doc.elements.find((e) => e.text === "writes")?.fontSize} vs ${inline.doc.elements.find((e) => e.text === "writes")?.fontSize}`);
  // bigger type through measured layout means a differently-proportioned
  // picture, not the same picture at another zoom
  check("the two presets come out at different canvas proportions",
    Math.abs(slide.w / slide.h - inline.w / inline.h) > 0.05,
    `${(slide.w / slide.h).toFixed(3)} vs ${(inline.w / inline.h).toFixed(3)}`);
  for (const [name, shotResult] of [["slide-16x9", slide], ["doc-inline", inline]]) {
    const gate = spawnSync(process.execPath, [join(root, "tools/check.js"), shotResult.out], { encoding: "utf8" });
    check(`the ${name} diagram passes the CLI gate`, gate.status === 0,
      (gate.stdout + gate.stderr).trim().split("\n").pop());
  }

  // fit is the default, and naming it changes nothing. Compared on placement
  // and type rather than on bytes, because every run mints fresh element ids
  // and seeds; the byte-for-byte claim is the committed examples' own, proved
  // by regenerating them (examples/*.excalidraw stay clean in the tree).
  const omitted = join(outDir, "preset-omitted.excalidraw");
  const named = join(outDir, "preset-fit.excalidraw");
  await authorDiagram({ out: omitted, build, svg: false });
  await authorDiagram({ out: named, build, preset: "fit", svg: false });
  const placement = (file) => JSON.stringify(JSON.parse(readFileSync(file, "utf8")).elements
    .map(({ type, x, y, width, height, fontSize, text }) => ({ type, x, y, width, height, fontSize, text })));
  check("omitting the preset and naming fit lay out identically",
    placement(omitted) === placement(named));

  const unknown = join(outDir, "preset-unknown.excalidraw");
  const bad = await rejectsWith("SkeletonError",
    authorDiagram({ out: unknown, build, preset: "slide-4x3" }));
  check("an unknown preset is a SkeletonError naming the valid set",
    bad.ok && /slide-16x9/.test(bad.message) && /social-og/.test(bad.message), bad.detail);
  check("an unknown preset writes nothing", !existsSync(unknown));
  const notAName = await rejectsWith("SkeletonError",
    authorDiagram({ out: join(outDir, "preset-nonstring.excalidraw"), build, preset: 16 }));
  check("a preset that is not a name is a SkeletonError too", notAName.ok, notAName.detail);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nauthor API behaves");
process.exit(fail.length ? 1 : 0);
