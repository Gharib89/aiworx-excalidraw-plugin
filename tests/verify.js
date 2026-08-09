#!/usr/bin/env node
/**
 * Unit suite for the gate's rule engine at its export (`verifyDocument` in
 * tools/verify.js). tests/gate.js proves the same engine through the check CLI
 * — exit codes and printed prose from fixture files on disk; this suite proves
 * the boundary tools/author.js actually calls: a parsed document in, and the
 * flat `{ code, message, elements, ...fields }` problems plus `stats` out.
 *
 * Every rule the engine can fire is planted once, and each case asserts the
 * *whole* code list its document yields — so a rule that starts firing where it
 * shouldn't fails here rather than passing unnoticed alongside the defect it
 * was meant to catch.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDocument } from "../tools/verify.js";
// the router under test, so the gate scores the path the authoring API really
// emits instead of one transcribed into this file by hand
import { arrowBetween } from "../tools/layout.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// A document the rules have no quarrel with, so anything a case adds is the
// only thing under test: white canvas, house font, black ink on a white fill.
// The house pair is read the way the rule reads it, so a palette change moves
// both together instead of turning every clean fixture here foreign-font.
const { prose: PROSE_FONT } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../brand/palette.json"), "utf8"),
).fontFamily;
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

// ---- 6b. content inside the frame but flush with its border reads clipped ----
{
  const crowded = verifyDocument(doc([frame("f1", 0, 0, 200, 100), shape("r1", 2, 20, 100, 60, { frameId: "f1" })]));
  const p = find(crowded, "frame-edge-crowding");
  check("an element inside the minimum inset is one crowding problem", only(crowded, "frame-edge-crowding"), detail(crowded));
  check("it names the element then its frame, with the clearance it has and the one it needs",
    JSON.stringify(p?.elements) === '["r1","f1"]' && p?.clearance === 2 && p?.needs === 4,
    JSON.stringify(p));

  // an element that leaves the frame is an escape, not crowding: one defect, one
  // problem — the author moves it either way
  const escaped = verifyDocument(doc([frame("f1", 0, 0, 200, 100), shape("r1", -20, 20, 100, 60, { frameId: "f1" })]));
  check("an escaping element is not also reported as crowding", only(escaped, "frame-escape"), detail(escaped));

  // a fractional clearance must never round up to the inset it failed: a
  // consumer comparing clearance against needs would read 4 of 4 as passing
  const fractional = verifyDocument(doc([frame("f1", 0, 0, 200, 100), shape("r1", 3.6, 20, 100, 60, { frameId: "f1" })]));
  check("a fractional clearance keeps its decimal instead of rounding to needs",
    find(fractional, "frame-edge-crowding")?.clearance === 3.6,
    JSON.stringify(find(fractional, "frame-edge-crowding")));

  // containment tolerates a 0.3px graze, so that element is not an escape — and
  // it is not crowding either: a fraction of a pixel *out* is neither "inside
  // the inset" nor a negative clearance to report
  const grazing = verifyDocument(doc([frame("f1", 0, 0, 200, 100), shape("r1", -0.3, 20, 100, 60, { frameId: "f1" })]));
  check("a sub-pixel graze is neither an escape nor crowding", grazing.problems.length === 0, detail(grazing));

  // the toolchain's own frames fit their children with 10px of padding, so
  // anything it authors clears the inset by construction
  const roomy = verifyDocument(doc([frame("f1", 0, 0, 200, 100), shape("r1", 10, 10, 180, 80, { frameId: "f1" })]));
  check("an element at the converter's own 10px frame padding is no defect", roomy.problems.length === 0, detail(roomy));
}

// ---- 7. an unbound element over a frame renders in the wrong panel ----
{
  const r = verifyDocument(doc([frame("f1", 0, 0, 200, 200), shape("r1", 50, 50, 50, 50), shape("r2", 300, 0, 50, 50)]));
  const p = find(r, "unbound-over-frame");
  check("an unbound element over a frame is one problem naming the frame", only(r, "unbound-over-frame"), detail(r));
  check("it names the element then its host frame", JSON.stringify(p?.elements) === '["r1","f1"]', JSON.stringify(p?.elements));
  check("an element clear of every frame is counted, not flagged", r.stats.outsideAll === 1, JSON.stringify(r.stats));

  // The band defect this rule exists to refuse, from the evaluation run: two
  // panels with an unbound connector between them whose ends reach 17px into
  // each neighbouring frame. Every frame export cropped at its border and
  // rendered an amputated arrowhead stub, while the file passed the gate — a
  // flat connector is the orientation a band uses, and a flat outline was the
  // one shape the overlap test could not see.
  const connector = (id, x, y, width, height) => ({
    ...shape(id, x, y, width, height),
    type: "arrow",
    points: [[0, 0], [width, height]],
  });
  const band = verifyDocument(doc([frame("f1", 0, 0, 200, 200), frame("f2", 260, 0, 200, 200), connector("a1", 183, 100, 94, 0)]));
  const bandProblem = find(band, "unbound-over-frame");
  check("a flat connector reaching into the panels it joins is refused", only(band, "unbound-over-frame"), detail(band));
  check("it names the connector and the frame it reaches into", JSON.stringify(bandProblem?.elements) === '["a1","f1"]', JSON.stringify(bandProblem?.elements));

  // the same defect in a stacked band, where the connector is vertical
  const stacked = verifyDocument(doc([frame("f1", 0, 0, 200, 200), frame("f2", 0, 260, 200, 200), connector("a1", 100, 183, 0, 94)]));
  check("a flat vertical connector reaching into stacked panels is refused", only(stacked, "unbound-over-frame"), detail(stacked));

  // and the property the fix had to keep: a band's frames sit edge to edge
  const abutting = verifyDocument(doc([frame("f1", 0, 0, 200, 200), frame("f2", 200, 0, 200, 200)]));
  check("frames that merely touch edges are no defect", abutting.problems.length === 0, detail(abutting));
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
  const light = r.problems.find((p) => p.code === "low-contrast" && p.theme === "light");
  const dark = r.problems.find((p) => p.code === "low-contrast" && p.theme === "dark");
  check(
    "the light problem carries the ratio it scored, the bar, and the pair",
    light?.ratio === 2.85 && light.needs === 4.5 && light.ink === "#999999" && light.bg === "#FFFFFF" && JSON.stringify(light.elements) === '["t1"]',
    JSON.stringify(light),
  );
  check("the dark problem scores the same pair after the filter", dark?.ratio === 3.46 && dark.ink !== light?.ink, JSON.stringify(dark));

  // the bar moves with the size: #909090 on white is 3.19:1 light and 3.84:1
  // dark — under 4.5 for body text, over 3 for large text
  const pair = { containerId: "c1", strokeColor: "#909090" };
  const body = verifyDocument(doc([shape("c1", 0, 0, 200, 100), text("t1", 10, 10, 60, 25, pair)]));
  const large = verifyDocument(doc([shape("c1", 0, 0, 200, 100), text("t1", 10, 10, 60, 25, { ...pair, fontSize: 24 })]));
  check(
    "body text at that pair fails both themes, 3.19 light and 3.84 dark",
    body.problems.length === 2 && body.problems.every((p) => p.needs === 4.5) &&
      JSON.stringify(body.problems.map((p) => p.ratio)) === "[3.19,3.84]",
    detail(body),
  );
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

// ---- 12. an element the toolchain cannot render: unknown type, or no size ----
{
  const unknown = verifyDocument(doc([{ ...shape("s1", 0, 0, 50, 50), type: "sticky" }]));
  check("an unknown type is one problem naming the element", only(unknown, "unknown-type") && JSON.stringify(find(unknown, "unknown-type").elements) === '["s1"]', detail(unknown));

  const flat = verifyDocument(doc([shape("r1", 0, 0, 0, 100)]));
  check("a zero-width shape is degenerate", only(flat, "degenerate"), detail(flat));

  const stub = verifyDocument(doc([{ ...shape("a1", 0, 0, 0, 0), type: "arrow", points: [[0, 0], [0, 0]] }]));
  check("a zero-length arrow is degenerate", only(stub, "degenerate"), detail(stub));
}

// ---- 13. a duplicate id silently drops an element on import ----
{
  const r = verifyDocument(doc([shape("dup", 0, 0, 50, 50), shape("dup", 60, 0, 50, 50)]));
  check("a repeated id is one problem naming it", only(r, "duplicate-id") && JSON.stringify(find(r, "duplicate-id").elements) === '["dup"]', detail(r));
}

// ---- 14. a frame binding that resolves to nothing ----
{
  const r = verifyDocument(doc([shape("r1", 0, 0, 50, 50, { frameId: "ghost" })]));
  check("an element bound to no frame is missing-frame", only(r, "missing-frame"), detail(r));
  check("it names the element then the frame it wanted", JSON.stringify(find(r, "missing-frame").elements) === '["r1","ghost"]');
}

// ---- 15. an arrow bound to nothing ----
{
  const r = verifyDocument(doc([{ ...shape("a1", 0, 0, 100, 0), type: "arrow", points: [[0, 0], [100, 0]], endBinding: { elementId: "ghost" } }]));
  check("an arrow pointing at no element is a dangling binding", only(r, "dangling-binding"), detail(r));
  check("it names the arrow then the element it wanted", JSON.stringify(find(r, "dangling-binding").elements) === '["a1","ghost"]');
}

// ---- 16. free texts on top of each other render as one smear ----
{
  const r = verifyDocument(doc([text("t1", 0, 0, 100, 25), text("t2", 50, 0, 100, 25, { text: "Other" })]));
  check("overlapping free texts are one problem naming both", only(r, "free-text-overlap") && JSON.stringify(find(r, "free-text-overlap").elements) === '["t1","t2"]', detail(r));
}

// ---- 17. an arrow straight through a shape it isn't bound to ----
{
  const s = shape("s1", 100, 0, 100, 100);
  const through = verifyDocument(doc([s, { ...shape("a1", 0, 50, 300, 0), type: "arrow", points: [[0, 0], [300, 0]] }]));
  check("an arrow crossing an unbound shape is a problem naming both", only(through, "arrow-crossing") && JSON.stringify(find(through, "arrow-crossing").elements) === '["a1","s1"]', detail(through));

  // bound to the shape it stops in, the same approach is binding hygiene
  const bound = verifyDocument(
    doc([s, { ...shape("a1", 0, 50, 105, 0), type: "arrow", points: [[0, 0], [105, 0]], endBinding: { elementId: "s1" } }]),
  );
  check("an arrow bound to the shape it enters does not cross it", bound.problems.length === 0, detail(bound));
}

// ---- 18. an element parked far from everything else is a coordinate typo ----
{
  const r = verifyDocument(doc([shape("r1", 0, 0, 50, 50), shape("r2", 2000, 0, 50, 50)]));
  check("a distant element is one stray, named once", only(r, "stray") && JSON.stringify(find(r, "stray").elements) === '["r1"]', detail(r));
}

// ---- 19. text over an image: a ground whose pixels no ratio can measure ----
{
  const files = { img1: { dataURL: "data:image/png;base64,iVBORw0KGgo=" } };
  const r = verifyDocument(
    doc([{ ...shape("i1", 0, 0, 200, 100), type: "image", fileId: "img1" }, text("t1", 50, 40, 60, 25)], { files }),
  );
  check("text over an image is flagged, not scored", only(r, "text-over-image") && JSON.stringify(find(r, "text-over-image").elements) === '["t1","i1"]', detail(r));
}

// ---- 20. an image whose bytes never made it into the file ----
{
  const r = verifyDocument(doc([{ ...shape("i1", 0, 0, 200, 100), type: "image" }]));
  check("an image with no bytes is one problem naming it", only(r, "missing-image-bytes") && JSON.stringify(find(r, "missing-image-bytes").elements) === '["i1"]', detail(r));
}

// ---- 21. a computed orthogonal route is not a defect ----
// arrow-crossing and arrow-buried are the two rules a multi-point routed path
// could trip, so score a real `route: "orthogonal"` arrow at the rule itself
// rather than trusting the router's own geometric argument. Both axes: the
// elbow's orientation follows the wider separation, so each is its own path.
{
  const routed = (src, dst) => {
    const a = arrowBetween(src, dst, { standoff: 10, route: "orthogonal" });
    return {
      ...shape("a1", a.x, a.y, a.width, a.height),
      type: "arrow",
      points: a.points,
      startBinding: { elementId: src.id, focus: 0, gap: 10 },
      endBinding: { elementId: dst.id, focus: 0, gap: 10 },
    };
  };
  const wide = shape("src", 0, 0, 200, 100);
  const wideDst = shape("dst", 520, 220, 200, 100);
  const h = verifyDocument(doc([wide, wideDst, routed(wide, wideDst)]));
  check("a horizontal-dominant route draws no problem", h.problems.length === 0, detail(h));

  const tall = shape("src", 0, 0, 200, 100);
  const tallDst = shape("dst", 320, 460, 200, 100);
  const v = verifyDocument(doc([tall, tallDst, routed(tall, tallDst)]));
  check("a vertical-dominant route draws no problem", v.problems.length === 0, detail(v));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nverifyDocument holds at its export");
process.exit(fail.length ? 1 : 0);
