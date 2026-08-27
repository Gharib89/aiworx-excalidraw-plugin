#!/usr/bin/env node
/**
 * Unit suite for the advisory measurements at their export (`adviseDocument` in
 * tools/advise.js). tests/gate.js proves the same module through the check CLI
 * — the stdout block and the exit code that stays 0; this suite proves the
 * boundary check.js calls: a parsed document in, the flat
 * `{ code, message, elements, ...fields }` advisories out.
 *
 * Every code the module can emit is planted once, and each case asserts the
 * *whole* code list its document yields — so a measurement that starts firing
 * where it shouldn't fails here rather than passing unnoticed alongside the one
 * it was meant to catch.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adviseDocument } from "../tools/advise.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// A document the measurements have no quarrel with: grey ink on a white canvas,
// one stroke width for shapes and a thinner one for arrows, house font.
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
  strokeWidth: 2,
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
// `points` are relative to (x, y), as Excalidraw stores them
const arrow = (id, x, y, points, extra = {}) => ({
  ...shape(id, x, y, 0, 0),
  type: "arrow",
  strokeWidth: 1,
  backgroundColor: "transparent",
  points,
  startBinding: null,
  endBinding: null,
  ...extra,
});
const bind = (elementId) => ({ elementId, focus: 0, gap: 1 });

const codes = (list) => list.map((a) => a.code).sort();
const only = (list, ...want) => JSON.stringify(codes(list)) === JSON.stringify([...want].sort());
const find = (list, code) => list.find((a) => a.code === code);
const detail = (list) => JSON.stringify(list.map((a) => a.code));

// ---- 1. a clean document yields no advisories, with or without a preset ----
{
  // 600×340 — a 16:9-ish picture, so it also fits a landscape surface
  const clean = doc([
    shape("a", 0, 0, 200, 100),
    shape("b", 400, 240, 200, 100),
    text("ta", 50, 40, 100, 25, { containerId: "a" }),
    arrow("ab", 200, 50, [[0, 0], [200, 190]], { startBinding: bind("a"), endBinding: bind("b") }),
  ]);
  check("a clean document yields no advisories", adviseDocument(clean).length === 0, detail(adviseDocument(clean)));
  const r = adviseDocument(clean, { preset: "doc-wide" });
  check("…and none under a preset it fits", r.length === 0, detail(r));
}

// ---- 2. arrows-cross: two arrows properly crossing, sharing no bound endpoint ----
{
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 400, 0, 100, 100),
      shape("c", 200, 300, 100, 100),
      shape("d", 200, -300, 100, 100),
      // a→b runs east along y=50; d→c runs south along x=250
      arrow("ab", 100, 50, [[0, 0], [300, 0]], { startBinding: bind("a"), endBinding: bind("b") }),
      arrow("dc", 250, -200, [[0, 0], [0, 500]], { startBinding: bind("d"), endBinding: bind("c") }),
    ]),
  );
  const a = find(r, "arrows-cross");
  check("two arrows crossing is one arrows-cross", only(r, "arrows-cross"), detail(r));
  check("it names both arrows and the crossing angle", a?.elements.join() === "ab,dc" && a.angle === 90, JSON.stringify(a));
}
{
  // two arrows fanning out of one shape cross at a shallow angle right after
  // leaving it — a shared bound endpoint, not a crossing
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 400, -50, 100, 100),
      shape("c", 400, 50, 100, 100),
      arrow("ab", 100, 60, [[0, 0], [300, -60]], { startBinding: bind("a"), endBinding: bind("b") }),
      arrow("ac", 100, 40, [[0, 0], [300, 60]], { startBinding: bind("a"), endBinding: bind("c") }),
    ]),
  );
  check("arrows sharing a bound endpoint never cross", r.length === 0, detail(r));
}

// ---- 3. aspect-off-preset: the picture's aspect against the named surface ----
{
  const square = doc([shape("a", 0, 0, 400, 400)]);
  const r = adviseDocument(square, { preset: "doc-wide" });
  const a = find(r, "aspect-off-preset");
  check("a square picture on a 16:9 surface is aspect-off-preset", only(r, "aspect-off-preset"), detail(r));
  check(
    "it carries the measured aspect, the surface's, and the preset; a whole-picture finding names no elements",
    a?.aspect === 1 && a.needs === 1.78 && a.preset === "doc-wide" && a.elements.length === 0,
    JSON.stringify(a),
  );
  check("without a preset the aspect is not judged", adviseDocument(square).length === 0);
  check("`fit` names no surface, so it is not judged either", adviseDocument(square, { preset: "fit" }).length === 0);
}

// ---- 4. font-below-floor: text under the surface's floor ----
{
  const r = adviseDocument(doc([shape("a", 0, 0, 1600, 900), text("t", 40, 40, 200, 20, { fontSize: 14 })]), { preset: "slide-16x9" });
  const a = find(r, "font-below-floor");
  check("14px text on a slide is font-below-floor", only(r, "font-below-floor"), detail(r));
  check("it carries the size, the floor and the preset", a?.size === 14 && a.needs === 30 && a.preset === "slide-16x9" && a.elements.join() === "t", JSON.stringify(a));
  const ok = adviseDocument(doc([shape("a", 0, 0, 1600, 900), text("t", 40, 40, 200, 20, { fontSize: 14 })]), { preset: "doc-inline" });
  check("14px clears the doc-inline floor", ok.length === 0, detail(ok));
}

// ---- 5. arrow-crowding: an arrow segment within 10px of something unrelated ----
{
  // a→b runs east along y=50; c sits 6px below the arrow's path, unrelated to it
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 500, 0, 100, 100),
      shape("c", 250, 56, 100, 100),
      arrow("ab", 100, 50, [[0, 0], [400, 0]], { startBinding: bind("a"), endBinding: bind("b") }),
    ]),
  );
  const a = find(r, "arrow-crowding");
  check("an arrow 6px from an unrelated shape is arrow-crowding", only(r, "arrow-crowding"), detail(r));
  check("it names the arrow then the shape, with the clearance and the bound", a?.elements.join() === "ab,c" && a.clearance === 6 && a.needs === 10, JSON.stringify(a));
}
{
  // the same near-miss against a free text, and against another arrow's label
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 500, 0, 100, 100),
      shape("c", 0, 300, 100, 100),
      shape("d", 500, 300, 100, 100),
      arrow("ab", 100, 50, [[0, 0], [400, 0]], { startBinding: bind("a"), endBinding: bind("b") }),
      text("free", 200, 58, 80, 20),
      arrow("cd", 100, 350, [[0, 0], [400, 0]], { startBinding: bind("c"), endBinding: bind("d") }),
      text("cd-label", 250, 42, 60, 20, { containerId: "cd" }),
    ]),
  );
  check("a free text and another arrow's label both count", only(r, "arrow-crowding", "arrow-crowding"), detail(r));
  check("…named as the arrow and the text", r.map((x) => x.elements.join()).sort().join(" ") === "ab,cd-label ab,free", detail(r));
}
{
  // what does not count: the arrow's own label, its targets' labels, a
  // container it passes through, a plate under a text, and an unbound arrow
  const r = adviseDocument(
    doc([
      shape("zone", -50, -50, 700, 200, { backgroundColor: "transparent" }),
      text("zone-title", 150, 56, 120, 20, { containerId: "zone" }),
      shape("a", 0, 0, 100, 100),
      shape("b", 500, 0, 100, 100),
      text("a-label", 10, 40, 80, 20, { containerId: "a" }),
      arrow("ab", 100, 50, [[0, 0], [400, 0]], { startBinding: bind("a"), endBinding: bind("b") }),
      text("ab-label", 250, 40, 60, 20, { containerId: "ab" }),
      shape("plate", 200, 56, 200, 40, { strokeColor: "transparent", backgroundColor: "#ffffff" }),
      text("plated", 210, 62, 180, 20),
      shape("c", 0, 300, 100, 100),
      arrow("loose", 100, 350, [[0, 0], [0, -250]]),
    ]),
  );
  check("labels, containers and their titles, plates and unbound arrows are read past", r.length === 0, detail(r));
}
{
  // a plate is backing, not content: the text it backs is still measured
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 500, 0, 100, 100),
      arrow("ab", 100, 50, [[0, 0], [400, 0]], { startBinding: bind("a"), endBinding: bind("b") }),
      shape("plate", 200, 52, 200, 40, { strokeColor: "transparent", backgroundColor: "#ffffff" }),
      text("plated", 210, 56, 180, 20),
    ]),
  );
  check("the text a plate backs is still crowded, the plate itself is not", only(r, "arrow-crowding") && r[0].elements.join() === "ab,plated" && r[0].clearance === 6, detail(r));
}

// ---- 6. too-many-bends: more than two direction changes on one arrow ----
{
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 600, 0, 100, 100),
      // east, south, east, north, east: four bends
      arrow("ab", 100, 50, [[0, 0], [100, 0], [100, 200], [400, 200], [400, 0], [500, 0]], { startBinding: bind("a"), endBinding: bind("b") }),
    ]),
  );
  const a = find(r, "too-many-bends");
  check("an arrow with four bends is too-many-bends", only(r, "too-many-bends"), detail(r));
  check("it carries the count and the bound", a?.elements.join() === "ab" && a.bends === 4 && a.needs === 2, JSON.stringify(a));
  const ok = adviseDocument(
    doc([
      shape("a", 0, 0, 100, 100),
      shape("b", 400, 300, 100, 100),
      // an elbow route: two bends, with a router's sub-degree jog that is not a bend
      arrow("ab", 100, 50, [[0, 0], [150, 0], [150.2, 200], [150, 300], [300, 300]], { startBinding: bind("a"), endBinding: bind("b") }),
    ]),
  );
  check("two bends and a sub-degree jog pass", ok.length === 0, detail(ok));
}

// ---- 7. flat-stroke-weight: an arrow not thinner than a shape it binds ----
{
  const r = adviseDocument(
    doc([
      shape("a", 0, 0, 200, 100),
      shape("b", 400, 240, 200, 100),
      arrow("ab", 200, 50, [[0, 0], [200, 190]], { strokeWidth: 2, startBinding: bind("a"), endBinding: bind("b") }),
    ]),
  );
  const a = find(r, "flat-stroke-weight");
  check("an arrow as thick as its shapes is flat-stroke-weight, once per arrow", only(r, "flat-stroke-weight"), detail(r));
  check("it names the arrow and the shape with both widths", a?.elements.join() === "ab,a" && a.arrowWidth === 2 && a.shapeWidth === 2, JSON.stringify(a));
}

// house roles, read the way the rule reads them
const ROLES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../brand/palette.json"), "utf8")).roles;
const role = (name, extra = {}) => ({ strokeColor: ROLES[name].stroke, backgroundColor: ROLES[name].fill, ...extra });

// ---- 8. hue-only-pass-fail: the pass and fail roles on one picture ----
{
  const r = adviseDocument(
    doc([
      shape("ok", 0, 0, 200, 100, role("pass")),
      shape("bad", 400, 240, 200, 100, role("fail")),
      shape("plain", 800, 0, 200, 100),
    ]),
  );
  const a = find(r, "hue-only-pass-fail");
  check("pass and fail together is hue-only-pass-fail", only(r, "hue-only-pass-fail"), detail(r));
  check("a presence finding: it names the carriers and no number", a?.elements.join() === "ok,bad" && !("needs" in a), JSON.stringify(a));
  const both = adviseDocument(doc([shape("x", 0, 0, 200, 100, { strokeColor: ROLES.pass.stroke, backgroundColor: ROLES.fail.fill }), shape("plain", 400, 240, 200, 100)]));
  check("an element carrying both roles is named once", only(both, "hue-only-pass-fail") && both[0].elements.join() === "x", detail(both));
  const one = adviseDocument(doc([shape("ok", 0, 0, 200, 100, role("pass")), shape("plain", 400, 240, 200, 100)]));
  check("one of the two roles alone is fine", one.length === 0, detail(one));
}

// ---- 9. too-many-hues: more than four non-grey hue families ----
{
  // the six house roles are six families; a role's fill folds into its stroke's
  // family and greys count for nothing
  const r = adviseDocument(
    doc([
      shape("s1", 0, 0, 100, 100, role("local")),
      shape("s2", 200, 0, 100, 100, role("artifact")),
      shape("s3", 400, 0, 100, 100, role("remote")),
      shape("s4", 600, 0, 100, 100, role("decision")),
      shape("s5", 800, 0, 100, 100, role("pass")),
      shape("s6", 0, 300, 100, 100, { strokeColor: "#5B5B58", backgroundColor: "#F1F1EF" }),
      text("t", 200, 340, 100, 20, { strokeColor: "#1A1A19" }),
    ]),
  );
  const a = find(r, "too-many-hues");
  check("five roles is too-many-hues", only(r, "too-many-hues"), detail(r));
  check("it carries the count and the bound; a whole-picture finding names no elements", a?.hues === 5 && a.needs === 4 && a.elements.length === 0, JSON.stringify(a));
  const four = adviseDocument(
    doc([
      shape("s1", 0, 0, 100, 100, role("local")),
      shape("s2", 200, 0, 100, 100, role("artifact")),
      shape("s3", 400, 0, 100, 100, role("remote")),
      shape("s4", 600, 0, 100, 100, role("decision")),
      // a plate's tint is backing, not a hue
      shape("plate", 0, 300, 300, 40, { strokeColor: "transparent", backgroundColor: ROLES.fail.fill }),
      text("plated", 10, 310, 280, 20),
    ]),
  );
  check("four roles plus a plate's tint pass", four.length === 0, detail(four));
}

// ---- 10. the frame is the picture: aspect and hues per frame, never for the file ----
{
  // two panels of a band: a square one under doc-wide, and a landscape one that
  // holds five roles; a caption clear of both frames is scored with no picture
  const r = adviseDocument(
    doc([
      frame("p1", 0, 0, 400, 400),
      shape("a", 20, 20, 360, 360, { frameId: "p1" }),
      frame("p2", 500, 0, 800, 450),
      shape("s1", 520, 20, 100, 100, { frameId: "p2", ...role("local") }),
      shape("s2", 640, 20, 100, 100, { frameId: "p2", ...role("artifact") }),
      shape("s3", 760, 20, 100, 100, { frameId: "p2", ...role("remote") }),
      shape("s4", 880, 20, 100, 100, { frameId: "p2", ...role("decision") }),
      shape("s5", 1000, 20, 100, 100, { frameId: "p2", ...role("pass") }),
      text("caption", 0, 500, 1300, 20, role("fail")),
    ]),
    { preset: "doc-wide" },
  );
  check("each frame is scored as its own picture and the row is not", only(r, "aspect-off-preset", "too-many-hues", "panel-width-drift"), detail(r));
  check("a per-panel finding names its frame first", find(r, "aspect-off-preset")?.elements.join() === "p1" && find(r, "too-many-hues")?.elements[0] === "p2", detail(r));
}

// ---- 11. panel-width-drift: the widest and narrowest frame of a band ----
{
  const r = adviseDocument(doc([frame("p1", 0, 0, 529, 300), frame("p2", 700, 0, 1224, 300), frame("p3", 2100, 0, 600, 300)]));
  const a = find(r, "panel-width-drift");
  check("a 2.31× width spread is panel-width-drift", only(r, "panel-width-drift"), detail(r));
  check("it names the widest then the narrowest frame, with the drift and the bound", a?.elements.join() === "p2,p1" && a.drift === 2.31 && a.needs === 1.25, JSON.stringify(a));
  const even = adviseDocument(doc([frame("p1", 0, 0, 500, 300), frame("p2", 700, 0, 600, 200)]));
  check("widths within 1.25× pass, heights free", even.length === 0, detail(even));
  const hair = adviseDocument(doc([frame("p1", 0, 0, 1252, 300), frame("p2", 1400, 0, 1000, 300)]));
  check("a 1.252× spread is judged raw, not after rounding to 1.25", find(hair, "panel-width-drift")?.drift === 1.25, detail(hair));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall advisory cases pass");
process.exit(fail.length ? 1 : 0);
