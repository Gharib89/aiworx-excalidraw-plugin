#!/usr/bin/env node
/**
 * Unit suite for the gate's rule engine at its export (`verifyDocument` in
 * tools/verify.js). tests/gate.js proves the same engine through the check CLI
 * — exit codes and printed prose from fixture files on disk; this suite proves
 * the boundary tools/author.js actually calls: a parsed document in, and the
 * flat `{ code, message, elements, ...fields }` problems plus `stats` out.
 *
 * Each case asserts the *whole* code list its document yields, so a rule that
 * starts firing where it shouldn't fails here rather than passing unnoticed
 * alongside the defect it was meant to catch.
 *
 * Exits non-zero on any mismatch.
 */
import { verifyDocument } from "../tools/verify.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// A document the rules have no quarrel with, so anything a case adds is the
// only thing under test: white canvas, house font, black ink on a white fill.
const PROSE_FONT = 6;
const doc = (elements, extra = {}) => ({
  type: "excalidraw",
  elements,
  appState: { viewBackgroundColor: "#ffffff" },
  ...extra,
});
const shape = (id, x, y, width, height, extra = {}) => ({
  id,
  type: "rectangle",
  x,
  y,
  width,
  height,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "#ffffff",
  fillStyle: "solid",
  opacity: 100,
  ...extra,
});
const frame = (id, x, y, width, height, extra = {}) => shape(id, x, y, width, height, { type: "frame", name: id, ...extra });
const text = (id, x, y, width, height, extra = {}) => ({
  ...shape(id, x, y, width, height),
  type: "text",
  text: "Label",
  fontSize: 20,
  fontFamily: PROSE_FONT,
  strokeColor: "#000000",
  backgroundColor: "transparent",
  ...extra,
});

const codes = (report) => report.problems.map((p) => p.code).sort();
const only = (report, ...want) => JSON.stringify(codes(report)) === JSON.stringify([...want].sort());
const find = (report, code) => report.problems.find((p) => p.code === code);
const detail = (report) => JSON.stringify(report.problems.map((p) => p.code));

// ---- 1. a clean document: no problems, and the stats the CLI prints ----
{
  const r = verifyDocument(
    doc([
      frame("f1", 0, 0, 400, 300),
      shape("r1", 40, 40, 300, 200, { frameId: "f1" }),
      text("t1", 60, 100, 200, 25, { containerId: "r1", frameId: "f1" }),
      text("t2", 600, 40, 120, 25),
    ]),
  );
  check("a clean document yields no problems", r.problems.length === 0, detail(r));
  check(
    "stats count the live elements, frames, texts and elements clear of every frame",
    r.stats.elements === 4 && r.stats.frames === 1 && r.stats.texts === 2 && r.stats.outsideAll === 1,
    JSON.stringify(r.stats),
  );
}

// ---- 2. a malformed entry is named and dropped, not fatal ----
{
  const r = verifyDocument(doc([null, shape("r1", 0, 0, 100, 100), shape("r2", 120, 0, 100, 100)]));
  const p = find(r, "malformed-element");
  check("a null element is one malformed-element problem", only(r, "malformed-element"), detail(r));
  check("the malformed problem carries its index and no element ids", p?.index === 0 && p.elements.length === 0, JSON.stringify(p));
  check("the surviving elements are still counted", r.stats.elements === 2, JSON.stringify(r.stats));
}

// ---- 3. non-finite geometry stops the rules that would take it down ----
{
  const r = verifyDocument(doc([shape("r1", Number.NaN, 0, 100, 100), shape("r2", 120, 0, 100, 100)]));
  check("non-finite geometry is reported once, without a degenerate follow-on", only(r, "non-finite-geometry"), detail(r));
  check("the non-finite problem names its element", find(r, "non-finite-geometry")?.elements[0] === "r1");
}

// ---- 4. a missing referent and a tombstoned one are different defects ----
{
  const missing = verifyDocument(doc([text("t1", 0, 0, 60, 25, { containerId: "ghost" })]));
  const p = find(missing, "missing-container");
  check("a text pointing at nothing is missing-container", only(missing, "missing-container"), detail(missing));
  check("the problem names the text then the container it wanted", JSON.stringify(p?.elements) === '["t1","ghost"]', JSON.stringify(p?.elements));
  check("the message says missing", /missing container ghost/.test(p?.message ?? ""), p?.message);

  // the file still holds the container — undelete, don't re-point
  const deleted = verifyDocument(
    doc([shape("c1", 0, 0, 200, 100, { isDeleted: true }), text("t1", 0, 0, 60, 25, { containerId: "c1" })]),
  );
  check("a text pointing at a tombstone says deleted", /deleted container c1/.test(find(deleted, "missing-container")?.message ?? ""), find(deleted, "missing-container")?.message);
  check("the tombstone is not counted as a live element", deleted.stats.elements === 1, JSON.stringify(deleted.stats));
}

// ---- 5. bound text must fit the container's usable box (padding 5 all round) ----
{
  const container = shape("c1", 0, 0, 200, 100);
  const fits = verifyDocument(doc([container, text("t1", 10, 10, 190, 90, { containerId: "c1" })]));
  check("text filling the usable box is no defect", fits.problems.length === 0, detail(fits));

  const r = verifyDocument(doc([container, text("t1", 10, 10, 195, 90, { containerId: "c1" })]));
  const p = find(r, "text-overflow");
  check("text wider than the usable box overflows", only(r, "text-overflow"), detail(r));
  check("the overflow problem names the text then its container", JSON.stringify(p?.elements) === '["t1","c1"]', JSON.stringify(p?.elements));
}

// ---- 6. frames must not overlap, and containment is judged on ink ----
{
  const r = verifyDocument(doc([frame("f1", 0, 0, 200, 200), frame("f2", 150, 150, 200, 200)]));
  const p = find(r, "frame-overlap");
  check("overlapping frames are one problem naming both", only(r, "frame-overlap") && JSON.stringify(p?.elements) === '["f1","f2"]', detail(r));

  const escaped = verifyDocument(doc([frame("f1", 0, 0, 200, 200), shape("r1", 150, 150, 100, 100, { frameId: "f1" })]));
  const e = find(escaped, "frame-escape");
  check("an element crossing its frame's edge escapes", only(escaped, "frame-escape"), detail(escaped));
  check(
    "the escape problem carries both rounded boxes",
    JSON.stringify(e?.element) === '{"x1":150,"y1":150,"x2":250,"y2":250}' && JSON.stringify(e?.frame) === '{"x1":0,"y1":0,"x2":200,"y2":200}',
    JSON.stringify({ element: e?.element, frame: e?.frame }),
  );

  // the rotation case the box test gets wrong: a 120x40 ellipse turned 45° in
  // the middle of a 100x100 frame has box corners 56.6px from the centre — past
  // the frame — while its ink reaches only 44.7px. It renders inside; the gate
  // must agree.
  const rotated = verifyDocument(
    doc([
      frame("f1", 0, 0, 100, 100),
      { ...shape("e1", -10, 30, 120, 40), type: "ellipse", angle: Math.PI / 4, frameId: "f1" },
    ]),
  );
  check("a rotated ellipse whose ink fits its frame is no defect", rotated.problems.length === 0, detail(rotated));
}

// ---- 7. an unbound element over a frame renders in the wrong panel ----
{
  const r = verifyDocument(doc([frame("f1", 0, 0, 200, 200), shape("r1", 50, 50, 50, 50), shape("r2", 300, 0, 50, 50)]));
  const p = find(r, "unbound-over-frame");
  check("an unbound element over a frame is one problem naming the frame", only(r, "unbound-over-frame"), detail(r));
  check("it names the element then its host frame", JSON.stringify(p?.elements) === '["r1","f1"]', JSON.stringify(p?.elements));
  check("an element clear of every frame is counted, not flagged", r.stats.outsideAll === 1, JSON.stringify(r.stats));
}

// ---- 8. a bound arrow head should stop at its target's edge ----
{
  const target = shape("s1", 200, 0, 100, 100);
  // head 50px into a 100x100 target: slack is min(8, 100/4) = 8px
  const buried = verifyDocument(
    doc([target, { ...shape("a1", 0, 50, 250, 0), type: "arrow", points: [[0, 0], [250, 0]], endBinding: { elementId: "s1" } }]),
  );
  const p = find(buried, "arrow-buried");
  check("an arrow head deep inside its target is buried", only(buried, "arrow-buried"), detail(buried));
  check("the buried problem names the arrow then its target, with the depth", JSON.stringify(p?.elements) === '["a1","s1"]' && p?.depth === 50, JSON.stringify(p));

  // stopping 5px in is inside the 8px slack
  const grazing = verifyDocument(
    doc([target, { ...shape("a1", 0, 50, 205, 0), type: "arrow", points: [[0, 0], [205, 0]], endBinding: { elementId: "s1" } }]),
  );
  check("an arrow stopping just inside the edge is no defect", grazing.problems.length === 0, detail(grazing));
}

// ---- 9. contrast is scored per theme, and each problem records its own ----
{
  // light grey on white clears neither theme (2.85:1 light, 3.46:1 after the
  // dark filter), and the pair is scored once per theme — so it is two problems
  const r = verifyDocument(doc([shape("c1", 0, 0, 200, 100), text("t1", 10, 10, 60, 25, { containerId: "c1", strokeColor: "#999999" })]));
  const themes = r.problems.filter((p) => p.code === "low-contrast").map((p) => p.theme);
  check("a pair failing both themes yields one problem per theme", JSON.stringify([...themes].sort()) === '["dark","light"]', JSON.stringify(themes));
  check("nothing but contrast is flagged", only(r, "low-contrast", "low-contrast"), detail(r));
  const p = find(r, "low-contrast");
  check(
    "each contrast problem carries the ratio, the bar, and the pair it scored",
    typeof p?.ratio === "number" && p.needs === 4.5 && /^#/.test(p.ink) && /^#/.test(p.bg) && JSON.stringify(p.elements) === '["t1"]',
    JSON.stringify(p),
  );

  // the bar moves with the size: #909090 on white is 3.19:1 light and 3.84:1
  // dark — under 4.5 for body text, over 3 for large text
  const pair = { containerId: "c1", strokeColor: "#909090" };
  const body = verifyDocument(doc([shape("c1", 0, 0, 200, 100), text("t1", 10, 10, 60, 25, pair)]));
  const large = verifyDocument(doc([shape("c1", 0, 0, 200, 100), text("t1", 10, 10, 60, 25, { ...pair, fontSize: 24 })]));
  check("body text at that pair fails both themes", body.problems.length === 2 && body.problems.every((p) => p.needs === 4.5), detail(body));
  check("the same pair at 24px is scored against 3:1 and clears", large.problems.length === 0, detail(large));
}

// ---- 10. a colour the rule cannot parse is a problem, never a silent fallback ----
{
  const r = verifyDocument(
    doc([shape("c1", 0, 0, 200, 100), text("t1", 10, 10, 60, 25, { containerId: "c1" })], {
      appState: { viewBackgroundColor: "rebeccapurple" },
    }),
  );
  const p = find(r, "unparseable-color");
  check("a named canvas colour is unparseable, not resolved", p !== undefined, detail(r));
  check("the problem names the field and the value it refused", p?.field === "viewBackgroundColor" && p.value === "rebeccapurple", JSON.stringify(p));
}

// ---- 11. a font outside the house pair reflows the layout per machine ----
{
  const r = verifyDocument(doc([text("t1", 0, 0, 60, 25, { fontFamily: 1 })]));
  check("a foreign font is one problem naming the text", only(r, "foreign-font") && JSON.stringify(find(r, "foreign-font").elements) === '["t1"]', detail(r));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nverifyDocument holds at its export");
process.exit(fail.length ? 1 : 0);
