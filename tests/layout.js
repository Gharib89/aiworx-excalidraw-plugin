#!/usr/bin/env node
/**
 * Unit suite for the layout helpers (tools/layout.js). Pure geometry — no
 * browser. Pins the placement arithmetic a generator would otherwise hand-roll:
 * stacking with explicit gaps, cross-axis alignment, nesting, padded boxes, and
 * arrows that own the gap between two shapes — labelled, routed, or not.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  column, row, stack, box, arrowBetween as deferArrow, fanOut, graph, resolveArrows, flatten, LayoutError,
  rampedLayout,
} from "../tools/layout.js";
import { PRESETS, PRESET_NAMES, DEFAULT_PRESET } from "../tools/presets.js";

// a measured shape, the only kind graph() lays out — sized as a build would
// have sized it, so the engine sees the widths the gate will later check
const node = (id) => ({ type: "rectangle", id, width: 120, height: 50 });

// arrowBetween returns a deferred arrow — the pipeline resolves its geometry once
// every mover has run. The geometry claims below are claims about the resolved
// arrow, so resolve on the spot; the deferral itself is pinned further down.
const resolveOne = (arrow) => resolveArrows([arrow])[0];
const arrowBetween = (a, b, opts) => resolveOne(deferArrow(a, b, opts));
// the gate's own scoring, so the routing claim is checked against the rule that
// would refuse it rather than against a second opinion written here
import { shapeDepth, segmentLengthInsideShape } from "../tools/geometry.js";

// the house pair, read the way the helpers read it — importing author.js here
// would pull the browser driver into a suite that runs without one
const { prose: PROSE, code: CODE } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../brand/palette.json"), "utf8"),
).fontFamily;

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};
// rotated bounds run through Math.sin/cos, so compare rotation-derived pixels
// with a tolerance — tight enough that a real anchoring regression is tens of
// pixels wide and still fails
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const throwsLayoutError = (fn) => {
  try {
    fn();
    return false;
  } catch (err) {
    return err.name === "LayoutError";
  }
};
// graph() is async, so its refusals arrive as rejections — the same LayoutError,
// reaching an author's `await` rather than their call
const rejectsLayoutError = async (fn) => {
  try {
    await fn();
    return false;
  } catch (err) {
    return err.name === "LayoutError";
  }
};

// ---- column: main-axis placement with a uniform gap ----
{
  const a = { type: "text", width: 100, height: 20 };
  const b = { type: "rectangle", width: 50, height: 30 };
  const g = column([a, b], { x: 10, y: 5, gap: 8 });
  check("column places the first item at the origin", a.x === 10 && a.y === 5, `${a.x},${a.y}`);
  check("column stacks with the gap", b.y === 5 + 20 + 8, `${b.y}`);
  check("column group extent", g.width === 100 && g.height === 58, `${g.width}x${g.height}`);
}

// ---- row: cross-axis alignment ----
{
  const a = { type: "rectangle", width: 40, height: 20 };
  const b = { type: "rectangle", width: 40, height: 40 };
  row([a, b], { gap: 10, align: "center" });
  check("row align center offsets the shorter item", a.y === 10 && b.y === 0, `a.y=${a.y} b.y=${b.y}`);
  const c = { type: "rectangle", width: 40, height: 20 };
  const d = { type: "rectangle", width: 40, height: 40 };
  row([c, d], { gap: 10, align: "end" });
  check("row align end bottoms out", c.y === 20 && d.y === 0, `c.y=${c.y} d.y=${d.y}`);
  check("row main axis is x", b.x === 50, `${b.x}`);
}

// ---- explicit per-pair gaps ----
{
  const items = [
    { type: "text", width: 10, height: 10 },
    { type: "text", width: 10, height: 10 },
    { type: "text", width: 10, height: 10 },
  ];
  column(items, { gap: [12, 14] });
  check("gap array applies per pair", items[1].y === 22 && items[2].y === 46,
    `${items[1].y},${items[2].y}`);
  check("gap array of the wrong length is rejected",
    throwsLayoutError(() => column([{ width: 1, height: 1 }, { width: 1, height: 1 }], { gap: [1, 2] })));
}

// ---- malformed input is rejected with a named error ----
{
  check("empty items are rejected", throwsLayoutError(() => column([])));
  check("missing width is rejected",
    throwsLayoutError(() => column([{ type: "text", height: 10 }])));
  check("unknown align is rejected",
    throwsLayoutError(() => column([{ width: 1, height: 1 }], { align: "middle" })));
  check("stack rejects an unknown direction",
    throwsLayoutError(() => stack([{ width: 1, height: 1 }], { direction: "diagonal" })));
}

// ---- stack/row/column reject a repeated item ----
{
  // the same item twice would collapse under place()'s mutation — the last
  // call wins the slot and leaves the other slot's extent phantom-empty
  check("stack refuses the same item listed twice", throwsLayoutError(() => {
    const a = { type: "text", width: 10, height: 10 };
    const b = { type: "text", width: 10, height: 10 };
    return stack([a, b, a]);
  }));
  check("column refuses the same item listed twice", throwsLayoutError(() => {
    const a = { type: "text", width: 10, height: 10 };
    const b = { type: "text", width: 10, height: 10 };
    return column([a, b, a]);
  }));
  check("row refuses the same item listed twice", throwsLayoutError(() => {
    const a = { type: "text", width: 10, height: 10 };
    const b = { type: "text", width: 10, height: 10 };
    return row([a, b, a]);
  }));
  check("distinct items still stack", !throwsLayoutError(() => stack([
    { type: "text", width: 10, height: 10 },
    { type: "text", width: 10, height: 10 },
  ])));
}

// ---- nesting: groups place like elements ----
{
  const a = { type: "text", width: 30, height: 10 };
  const b = { type: "text", width: 30, height: 10 };
  const inner = column([a, b], { gap: 5 });
  const c = { type: "rectangle", width: 20, height: 50 };
  const outer = row([inner, c], { x: 100, y: 200, gap: 10 });
  check("nested group children move with the group", a.x === 100 && a.y === 200 && b.y === 215,
    `a ${a.x},${a.y} b ${b.x},${b.y}`);
  check("sibling after a group starts past its extent", c.x === 140, `${c.x}`);
  check("outer extent covers both", outer.width === 60 && outer.height === 50,
    `${outer.width}x${outer.height}`);
}

// ---- box: a rectangle padded around its content ----
{
  const body = { type: "text", width: 100, height: 50 };
  const g = box(body, { padding: 20, id: "card", strokeColor: "#123456" });
  check("box sizes the shape from content plus padding",
    g.shape.width === 140 && g.shape.height === 90, `${g.shape.width}x${g.shape.height}`);
  check("box offsets the content by the padding", body.x === 20 && body.y === 20,
    `${body.x},${body.y}`);
  check("box passes shape props through", g.shape.id === "card" && g.shape.strokeColor === "#123456");
  const els = flatten([g]);
  check("box renders shape under content", els[0] === g.shape && els[1] === body);
  check("box group extent matches the shape", g.width === 140 && g.height === 90);
}
{
  // box positions its content by translation alone, so an angle on the
  // rectangle would leave the content upright and clear of the shape — the
  // rotation has to be refused at author time
  const content = () => ({ type: "text", width: 100, height: 50 });
  check("box rejects a rotating angle",
    throwsLayoutError(() => box(content(), { angle: Math.PI / 4 })));
  check("box rejects a negative rotating angle",
    throwsLayoutError(() => box(content(), { angle: -Math.PI / 2 })));
  check("box rejects a non-finite angle",
    throwsLayoutError(() => box(content(), { angle: NaN })));
  check("box rejects a non-numeric angle",
    throwsLayoutError(() => box(content(), { angle: "0" })));
  // a bigint is neither finite nor stringifiable as JSON — the refusal must
  // still be a LayoutError, not a TypeError from rendering the message
  check("box rejects a bigint angle",
    throwsLayoutError(() => box(content(), { angle: 1n })));
  let message = "";
  try {
    box(content(), { angle: Math.PI / 4 });
  } catch (err) {
    message = String(err.message);
  }
  check("the rotation refusal names the bound-label alternative",
    /\blabel\b/.test(message) && /rotat/.test(message), message);
  // zero is the renderer's default and means "no rotation": a caller computing
  // angles must not be broken for its upright cases
  const upright = box(content(), { padding: 20, id: "flat" });
  const zeroed = box(content(), { padding: 20, id: "flat", angle: 0 });
  check("box accepts angle 0 as the no-op it is",
    JSON.stringify(zeroed.shape) === JSON.stringify(upright.shape),
    JSON.stringify(zeroed.shape));
}

// ---- arrowBetween: the arrow owns the gap ----
{
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 10, strokeWidth: 2 });
  check("horizontal arrow starts past the source edge", arrow.x === 110 && arrow.y === 25,
    `${arrow.x},${arrow.y}`);
  check("horizontal arrow spans the gap minus standoffs",
    JSON.stringify(arrow.points) === "[[0,0],[40,0]]", JSON.stringify(arrow.points));
  check("arrow binds both ends", arrow.start.id === "a" && arrow.end.id === "b");
  check("arrow style passes through", arrow.strokeWidth === 2);
}
{
  const a = { type: "rectangle", id: "top", x: 0, y: 0, width: 100, height: 40 };
  const b = { type: "rectangle", id: "bot", x: 0, y: 100, width: 100, height: 40 };
  const arrow = arrowBetween(a, b, { standoff: 8 });
  check("vertical arrow runs down the gap", arrow.x === 50 && arrow.y === 48 &&
    JSON.stringify(arrow.points) === "[[0,0],[0,44]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // boxes bind through their shape, and offset centres still find the overlap
  const a = box({ type: "text", width: 60, height: 30 }, { padding: 10, id: "left" });
  const b = box({ type: "text", width: 60, height: 30 }, { padding: 10, id: "right" });
  row([a, b], { gap: 40 });
  const arrow = arrowBetween(a, b, { standoff: 10 });
  check("arrow between boxes binds the shapes", arrow.start.id === "left" && arrow.end.id === "right");
  check("arrow between boxes spans the remaining gap",
    JSON.stringify(arrow.points) === "[[0,0],[20,0]]", JSON.stringify(arrow.points));
}
{
  // unequal heights with overlapping ranges: the arrow stays level
  const a = { type: "rectangle", id: "tall", x: 0, y: 0, width: 100, height: 200 };
  const b = { type: "rectangle", id: "short", x: 160, y: 0, width: 100, height: 80 };
  const arrow = arrowBetween(a, b, { standoff: 10 });
  check("overlapping cross ranges keep the arrow level",
    arrow.y === 40 && JSON.stringify(arrow.points) === "[[0,0],[40,0]]",
    `y=${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // an explicit route keeps its corners: waypoints in, roundness off
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 50, height: 50 };
  const b = { type: "rectangle", id: "b", x: 200, y: 200, width: 50, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 0, via: [[125, 25], [125, 225]] });
  check("via waypoints become explicit points",
    arrow.points.length === 4 && JSON.stringify(arrow.points[1]) === JSON.stringify([75, 0]),
    JSON.stringify(arrow.points));
  check("routed arrow keeps its corners", arrow.roundness === null);
}
{
  // a requested orthogonal route jogs at the gap's mid-line instead of running
  // diagonally: out level from the source, across, then level into the target
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 300, y: 120, width: 100, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 10, route: "orthogonal" });
  check("an orthogonal route elbows through the gap",
    arrow.x === 110 && arrow.y === 25 &&
      JSON.stringify(arrow.points) === "[[0,0],[90,0],[90,120],[180,120]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
  check("an orthogonal route sizes itself over its waypoints",
    arrow.width === 180 && arrow.height === 120, `${arrow.width}x${arrow.height}`);
  check("an orthogonal route keeps its corners", arrow.roundness === null);
  check("an orthogonal route still binds both ends",
    arrow.start.id === "a" && arrow.end.id === "b");
  check("route is not passed through to the element", !("route" in arrow));
}
{
  // the dominant separation picks the axis: a mostly-vertical pair leaves and
  // arrives vertically, and jogs sideways at the gap's mid-line
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 120, y: 300, width: 100, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 10, route: "orthogonal" });
  check("a vertical-dominant orthogonal route jogs sideways",
    arrow.x === 50 && arrow.y === 60 &&
      JSON.stringify(arrow.points) === "[[0,0],[0,115],[120,115],[120,230]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // already level: an orthogonal route has no slope to remove, so it adds no
  // waypoint and leaves roundness alone — the same arrow the direct route draws
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 10, route: "orthogonal" });
  check("a level run needs no elbow",
    JSON.stringify(arrow.points) === "[[0,0],[40,0]]", JSON.stringify(arrow.points));
  check("a level orthogonal route leaves roundness alone", !("roundness" in arrow));
}
{
  // a computed route and hand-written waypoints are two answers to one question
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 50, height: 50 };
  const b = { type: "rectangle", id: "b", x: 200, y: 200, width: 50, height: 50 };
  check("route together with via is a LayoutError",
    throwsLayoutError(() => arrowBetween(a, b, { route: "orthogonal", via: [[125, 25]] })));
  check("an unknown route is a LayoutError",
    throwsLayoutError(() => arrowBetween(a, b, { route: "elbowed" })));
}
{
  // the route's promise is geometric, so check it the way the gate would rather
  // than trusting the argument: sweep relative placements, sizes, standoffs and
  // source rotations, and score every routed arrow with the gate's own helpers.
  // A vertex exactly on an edge (standoff 0) reads as depth 0 through the float,
  // hence the half-pixel tolerance — the gate's own slack is 8px.
  let routed = 0;
  const offences = [];
  for (const bx of [-300, -160, 0, 160, 300])
    for (const by of [-300, -160, 0, 160, 300])
      for (const bw of [40, 200])
        for (const bh of [40, 200])
          for (const standoff of [0, 10, 40])
            for (const angle of [0, Math.PI / 4, 1.1]) {
              const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 200, height: 100, angle };
              const b = { type: "rectangle", id: "b", x: bx, y: by, width: bw, height: bh };
              let arrow;
              try {
                arrow = arrowBetween(a, b, { standoff, route: "orthogonal" });
              } catch {
                continue; // refused for want of a gap to own — not this claim
              }
              routed++;
              const where = `b@${bx},${by} ${bw}x${bh} standoff ${standoff} angle ${angle.toFixed(2)}`;
              const pts = arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py]);
              for (let i = 0; i + 1 < pts.length; i++) {
                const [p, q] = [pts[i], pts[i + 1]];
                if (p[0] !== q[0] && p[1] !== q[1]) offences.push(`${where}: seg${i} slopes`);
                for (const s of [a, b]) {
                  if (shapeDepth(s, p) > 0.5 || shapeDepth(s, q) > 0.5) {
                    offences.push(`${where}: seg${i} has a vertex inside ${s.id ?? "b"}`);
                  }
                  // 2px is the gate's own arrow-crossing threshold
                  if (segmentLengthInsideShape(s, p, q) > 2) {
                    offences.push(`${where}: seg${i} crosses ${s.id ?? "b"}`);
                  }
                }
              }
            }
  check("every computed route is axis-aligned and clears both its shapes",
    routed > 500 && offences.length === 0, `${routed} routes, ${offences[0] ?? "no offences"}`);
}
{
  const a = { type: "rectangle", x: 0, y: 0, width: 100, height: 100 };
  const b = { type: "rectangle", x: 50, y: 50, width: 100, height: 100 };
  check("overlapping shapes leave no gap to own",
    throwsLayoutError(() => arrowBetween(a, b)));
}
{
  // a labelled edge: the shorthand becomes the skeleton's bound-text form, in
  // the house font, and the label changes nothing about the path
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 50 };
  const plain = arrowBetween(a, b, { standoff: 10 });
  const labelled = arrowBetween(a, b, { standoff: 10, label: "writes" });
  check("a string label becomes measured bound text in the house font",
    labelled.label?.text === "writes" && labelled.label.fontFamily === PROSE &&
      labelled.label.fontSize === 16,
    JSON.stringify(labelled.label));
  check("a label leaves the path alone",
    labelled.x === plain.x && labelled.y === plain.y &&
      JSON.stringify(labelled.points) === JSON.stringify(plain.points),
    `${labelled.x},${labelled.y} ${JSON.stringify(labelled.points)}`);
  const styled = arrowBetween(a, b, { standoff: 10, label: { text: "12 ms", fontSize: 20, fontFamily: CODE } });
  check("an object label overrides size and family",
    styled.label.fontSize === 20 && styled.label.fontFamily === CODE, JSON.stringify(styled.label));
  check("an unlabelled arrow carries no label key", !("label" in plain));
  check("a label with no text is a LayoutError",
    throwsLayoutError(() => arrowBetween(a, b, { label: "" })) &&
      throwsLayoutError(() => arrowBetween(a, b, { label: { fontSize: 16 } })));
}

{
  // a rotated source anchors on its rotated extent, not its unrotated box: a
  // 100x50 rectangle at the origin turned a quarter turn occupies x 25..75
  // (worked by hand from the corners about the centre 50,25), so the arrow
  // leaves at 85 — the unrotated 110 would start 35px clear of the shape
  const a = { type: "rectangle", id: "spun", x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 2 };
  const b = { type: "rectangle", id: "plain", x: 160, y: 0, width: 100, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 10 });
  check("a rotated source anchors on its rotated extent",
    near(arrow.x, 85) && near(arrow.y, 25), `${arrow.x},${arrow.y}`);
  check("a rotated source spans the real gap minus standoffs",
    arrow.points.length === 2 && near(arrow.points[0][0], 0) && near(arrow.points[0][1], 0) &&
      near(arrow.points[1][0], 65) && near(arrow.points[1][1], 0),
    JSON.stringify(arrow.points));
}
{
  // the rotated *bounding box* is the anchor — the definition the gate scores
  // against — so an oblique angle stops the arrow on the box, not on the slanted
  // edge. The same 100x50 rectangle at 45 degrees has corners (worked by hand
  // about the centre 50,25) spanning x -3.03..103.03, so the arrow leaves at
  // 113.03. Pinned to keep that a decision rather than an accident.
  const a = { type: "rectangle", id: "oblique", x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 4 };
  const b = { type: "rectangle", id: "plain", x: 250, y: 0, width: 100, height: 50 };
  const arrow = arrowBetween(a, b, { standoff: 10 });
  check("an oblique rotation anchors on the rotated bounding box",
    near(arrow.x, 113.03, 0.01) && near(arrow.y, 25), `${arrow.x},${arrow.y}`);
}
{
  // geometry reads x/y raw, so an item that was sized but never placed used to
  // produce an all-NaN arrow — silently unbound, the very thing this rejects
  const unplaced = { type: "rectangle", id: "unplaced", width: 100, height: 50 };
  const b = { type: "rectangle", id: "far", x: 200, y: 0, width: 100, height: 50 };
  const arrow = arrowBetween(unplaced, b, { standoff: 10 });
  check("an unplaced item is read at the origin, never as NaN",
    arrow.x === 110 && arrow.y === 25 && arrow.points.every(([px, py]) => Number.isFinite(px) && Number.isFinite(py)),
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}

{
  // a group is only bindable through the shape it exposes: a plain column/row
  // has no element to bind, and an unbound arrow passes the gate then detaches
  // on edit, so the call is rejected instead of silently producing one
  const a = { type: "rectangle", id: "src", x: 0, y: 0, width: 100, height: 50 };
  const plainGroup = column(
    [{ type: "rectangle", id: "c1", width: 100, height: 40 },
      { type: "rectangle", id: "c2", width: 100, height: 40 }],
    { x: 200, y: 0, gap: 10 },
  );
  check("an arrow to a plain group is a LayoutError",
    throwsLayoutError(() => arrowBetween(a, plainGroup, { standoff: 10 })));
  check("an arrow from a plain group is a LayoutError",
    throwsLayoutError(() => arrowBetween(plainGroup, a, { standoff: 10 })));
  const anonBox = box({ type: "text", width: 60, height: 30 }, { padding: 10 });
  column([anonBox], { x: 200, y: 0 }); // place it clear of `a`, so only the missing id can fail
  check("an arrow to a box whose shape has no id is a LayoutError",
    throwsLayoutError(() => arrowBetween(a, anonBox, { standoff: 10 })));
  check("an arrow to an unmeasured shape is still a LayoutError",
    throwsLayoutError(() => arrowBetween(a, { type: "rectangle", id: "unsized", x: 200, y: 0 })));
  // an id on the group itself binds nothing — flatten drops groups, so that id
  // names no element in the finished skeleton
  plainGroup.id = "hand-set";
  check("an id on the group itself does not make it bindable",
    throwsLayoutError(() => arrowBetween(a, plainGroup, { standoff: 10 })));
}

// ---- deferred resolution: call order stops mattering ----
{
  // the #108 shape: compose a panel at its local origin, bind it there, then move
  // the whole thing with a band-level row. The arrow must land on the final
  // coordinates, not the local ones it was written at.
  const panel = (id) => {
    const from = box({ type: "text", width: 60, height: 30 }, { padding: 10, id: `${id}-from` });
    const to = box({ type: "text", width: 60, height: 30 }, { padding: 10, id: `${id}-to` });
    const body = row([from, to], { gap: 80, align: "center" });
    return { body, from, to };
  };

  const early = panel("e");
  const earlyArrow = deferArrow(early.from, early.to, { standoff: 10, strokeColor: "#123456" });
  row([early.body], { x: 900, y: 400 });

  const late = panel("l");
  row([late.body], { x: 900, y: 400 });
  const lateArrow = deferArrow(late.from, late.to, { standoff: 10, strokeColor: "#123456" });

  resolveArrows([earlyArrow, lateArrow]);
  const geometry = (arw) => JSON.stringify([arw.x, arw.y, arw.width, arw.height, arw.points]);
  check("an arrow written before the last mover resolves to the same geometry as one written after",
    geometry(earlyArrow) === geometry(lateArrow), `${geometry(earlyArrow)} vs ${geometry(lateArrow)}`);
  check("a deferred arrow anchors on the moved shape, not its local origin",
    earlyArrow.x === 900 + 80 + 10 && earlyArrow.y === 400 + 25,
    `${earlyArrow.x},${earlyArrow.y}`);
}
{
  // the same equivalence for every geometry-bearing option: a computed route and
  // a label both come out of the resolve pass, so both have to be order-blind
  const panel = (id) => {
    const from = box({ type: "text", width: 60, height: 30 }, { padding: 10, id: `${id}-from` });
    const to = box({ type: "text", width: 60, height: 30 }, { padding: 10, id: `${id}-to` });
    // drop `to` clear of `from`'s cross range, so the run really does need an elbow
    const dropped = column([{ type: "rectangle", width: 10, height: 140 }, to], { gap: 0 });
    return { from, to, group: row([from, dropped], { gap: 200, align: "start" }) };
  };
  const opts = { standoff: 10, route: "orthogonal", label: "writes", endArrowhead: "triangle" };
  const early = panel("e");
  const earlyArrow = deferArrow(early.from, early.to, opts);
  row([early.group], { x: 300, y: 70 });
  const late = panel("l");
  row([late.group], { x: 300, y: 70 });
  const lateArrow = deferArrow(late.from, late.to, opts);
  resolveArrows([earlyArrow, lateArrow]);
  const shape = (arw) => JSON.stringify({ ...arw, start: null, end: null });
  check("a routed, labelled arrow is order-blind too", shape(earlyArrow) === shape(lateArrow),
    `${shape(earlyArrow)} vs ${shape(lateArrow)}`);
  check("a resolved arrow keeps its computed corners", earlyArrow.roundness === null);
}
{
  // what a frame needs to claim an arrow — an id — and what binding needs are
  // known at call time, so both survive the wait for geometry
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 50 };
  const deferred = deferArrow(a, b, { standoff: 10, id: "link", strokeColor: "#123456" });
  check("a deferred arrow carries its id, type, bindings and style before resolution",
    deferred.id === "link" && deferred.type === "arrow" && deferred.start.id === "a" &&
      deferred.end.id === "b" && deferred.strokeColor === "#123456",
    JSON.stringify(deferred));
  check("a deferred arrow carries no geometry yet", !("points" in deferred));
  check("a deferred arrow flattens like a placed element",
    flatten([box({ type: "text", width: 10, height: 10 }, { padding: 5 }), deferred])[2] === deferred);
  const copied = resolveOne({ ...deferArrow(a, b, { standoff: 10 }), id: "copied" });
  check("a deferred arrow copied with extra props stays resolvable",
    copied.id === "copied" && JSON.stringify(copied.points) === "[[0,0],[40,0]]",
    JSON.stringify(copied));
  const resolved = resolveArrows([a, deferred, b]);
  check("resolveArrows returns the same elements, arrows resolved in place",
    resolved[1] === deferred && JSON.stringify(deferred.points) === "[[0,0],[40,0]]",
    JSON.stringify(deferred.points));
  check("resolveArrows leaves already-resolved elements alone",
    JSON.stringify(resolveArrows([a, deferred, b])) === JSON.stringify(resolved),
    JSON.stringify(deferred));
  check("a resolved arrow serialises without the deferral",
    !/deferred/i.test(JSON.stringify(deferred)), JSON.stringify(deferred));
}
{
  // a typo is caught where it was written; a geometry defect can only be caught
  // once everything has moved, and names the arrow so it traces back to code
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 100 };
  const b = { type: "rectangle", id: "b", x: 50, y: 50, width: 100, height: 100 };
  check("an unknown route still throws at call time",
    throwsLayoutError(() => deferArrow(a, b, { route: "elbowed" })));
  check("route together with via still throws at call time",
    throwsLayoutError(() => deferArrow(a, b, { route: "orthogonal", via: [[1, 2]] })));
  check("an empty label still throws at call time",
    throwsLayoutError(() => deferArrow(a, b, { label: "" })));
  check("an unbindable group still throws at call time",
    throwsLayoutError(() => deferArrow(a, column([{ type: "rectangle", width: 1, height: 1 }]))));
  // a bigint is neither finite nor stringifiable as JSON — the refusal must still
  // be a LayoutError, not a TypeError from rendering the message
  check("a non-finite standoff throws at call time",
    throwsLayoutError(() => deferArrow(a, b, { standoff: "10" })) &&
      throwsLayoutError(() => deferArrow(a, b, { standoff: NaN })) &&
      throwsLayoutError(() => deferArrow(a, b, { standoff: Infinity })) &&
      throwsLayoutError(() => deferArrow(a, b, { standoff: 10n })));
  // the resolve pass copies via through untouched, so its shape is checked here
  check("malformed via waypoints throw at call time",
    throwsLayoutError(() => deferArrow(a, b, { via: null })) &&
      throwsLayoutError(() => deferArrow(a, b, { via: [[1, 2, 3]] })) &&
      throwsLayoutError(() => deferArrow(a, b, { via: [[1, "2"]] })) &&
      throwsLayoutError(() => deferArrow(a, b, { via: [{ x: 1, y: 2 }] })) &&
      throwsLayoutError(() => deferArrow(a, b, { via: [[1n, 2n]] })));
  const overlapping = deferArrow(a, b, { standoff: 10, id: "no-room" });
  check("shapes that leave no gap are only refused at resolve time",
    throwsLayoutError(() => resolveArrows([overlapping])));
  let message = "";
  try {
    resolveArrows([deferArrow(a, b, { standoff: 10, id: "no-room" })]);
  } catch (err) {
    message = `${err.message}`;
  }
  check("the resolve-time refusal names the arrow", /no-room/.test(message), message);
}

// ---- originAt / landAt: a fraction of the facing edge, in place of the
// overlap midpoint, for the end supplied ----
{
  // landAt overrides only the end; the start keeps today's overlap midpoint
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 80 };
  const arrow = arrowBetween(a, b, { standoff: 10, landAt: 0.25 });
  check("landAt places the end at a fraction of the target's facing edge",
    arrow.y === 25 && JSON.stringify(arrow.points) === "[[0,0],[40,-5]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // originAt overrides only the start; the end keeps today's overlap midpoint
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 80 };
  const arrow = arrowBetween(a, b, { standoff: 10, originAt: 0.75 });
  check("originAt places the start at a fraction of the source's facing edge",
    arrow.y === 37.5 && JSON.stringify(arrow.points) === "[[0,0],[40,-12.5]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // both omitted: today's overlap-midpoint pick at both ends is unchanged
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 80 };
  const arrow = arrowBetween(a, b, { standoff: 10 });
  check("originAt and landAt both omitted keep the overlap midpoint at both ends",
    arrow.y === 25 && JSON.stringify(arrow.points) === "[[0,0],[40,0]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // the vertical branch honours both the same way, off the top/bottom edges
  const a = { type: "rectangle", id: "top", x: 0, y: 0, width: 100, height: 40 };
  const b = { type: "rectangle", id: "bot", x: 0, y: 100, width: 140, height: 40 };
  const arrow = arrowBetween(a, b, { standoff: 8, originAt: 0.25, landAt: 0.75 });
  check("originAt and landAt on the vertical axis pick fractions of the top/bottom edges",
    arrow.x === 25 && arrow.y === 48 && JSON.stringify(arrow.points) === "[[0,0],[80,44]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // out-of-range or non-finite fractions are refused where they were written,
  // the same treatment standoff already gets
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 };
  const b = { type: "rectangle", id: "b", x: 160, y: 0, width: 100, height: 50 };
  check("an out-of-range or non-finite originAt is a LayoutError",
    throwsLayoutError(() => deferArrow(a, b, { originAt: -0.1 })) &&
      throwsLayoutError(() => deferArrow(a, b, { originAt: 1.1 })) &&
      throwsLayoutError(() => deferArrow(a, b, { originAt: NaN })) &&
      throwsLayoutError(() => deferArrow(a, b, { originAt: "0.5" })));
  check("an out-of-range or non-finite landAt is a LayoutError",
    throwsLayoutError(() => deferArrow(a, b, { landAt: -0.1 })) &&
      throwsLayoutError(() => deferArrow(a, b, { landAt: 1.1 })) &&
      throwsLayoutError(() => deferArrow(a, b, { landAt: NaN })) &&
      throwsLayoutError(() => deferArrow(a, b, { landAt: "0.5" })));
  check("an out-of-range or non-finite spread is a LayoutError",
    throwsLayoutError(() => fanOut(a, [b], { spread: -0.1 })) &&
      throwsLayoutError(() => fanOut(a, [b], { spread: 1.1 })) &&
      throwsLayoutError(() => fanOut(a, [b], { spread: NaN })) &&
      throwsLayoutError(() => fanOut(a, [b], { spread: "0.5" })));
  check("fanOut needs a non-empty targets array",
    throwsLayoutError(() => fanOut(a, [])) && throwsLayoutError(() => fanOut(a, null)));
}

// ---- fanOut: one source, N deferred arrows, united origin, spread landings ----
{
  const src = { type: "rectangle", id: "src", x: 0, y: 0, width: 100, height: 200 };
  const t1 = { type: "rectangle", id: "t1", x: 200, y: 0, width: 80, height: 40 };
  const t2 = { type: "rectangle", id: "t2", x: 200, y: 100, width: 80, height: 40 };
  const t3 = { type: "rectangle", id: "t3", x: 200, y: 200, width: 80, height: 40 };
  const arrows = fanOut(src, [t1, t2, t3], { standoff: 10 }).map(resolveOne);
  check("fanOut unites every origin at the source edge middle",
    arrows.every((arw) => arw.x === 110 && arw.y === 100),
    arrows.map((arw) => `${arw.x},${arw.y}`).join(" | "));
  const ends = arrows.map((arw) => [arw.x + arw.points.at(-1)[0], arw.y + arw.points.at(-1)[1]]);
  check("fanOut spreads landings at 0.2/0.5/0.8 of each target's own facing edge",
    JSON.stringify(ends) === JSON.stringify([[190, 8], [190, 120], [190, 232]]),
    JSON.stringify(ends));
}
{
  // fanOut returns deferred arrows too: a mover after the call still resolves
  // against the final position, same as any arrowBetween arrow
  const src = { type: "rectangle", id: "src2", width: 100, height: 50 };
  const t1 = { type: "rectangle", id: "t1-2", width: 80, height: 40 };
  const [arrow] = fanOut(src, [t1], { standoff: 10 });
  row([src, t1], { gap: 60, x: 500, y: 300, align: "start" });
  resolveArrows([arrow]);
  check("a fanOut arrow deferred before a mover resolves against the moved shapes",
    arrow.x === 610 && arrow.y === 325 && JSON.stringify(arrow.points) === "[[0,0],[40,-5]]",
    `${arrow.x},${arrow.y} ${JSON.stringify(arrow.points)}`);
}
{
  // fanOut composes with route: "orthogonal" — every arrow keeps axis-aligned
  // segments, the same guarantee a single arrowBetween route gives
  const src = { type: "rectangle", id: "src3", x: 0, y: 0, width: 100, height: 200 };
  const t1 = { type: "rectangle", id: "ot1", x: 200, y: 0, width: 80, height: 40 };
  const t2 = { type: "rectangle", id: "ot2", x: 200, y: 100, width: 80, height: 40 };
  const t3 = { type: "rectangle", id: "ot3", x: 200, y: 200, width: 80, height: 40 };
  const arrows = fanOut(src, [t1, t2, t3], { standoff: 10, route: "orthogonal" }).map(resolveOne);
  const sloped = arrows.flatMap((arw) => {
    const pts = arw.points.map(([px, py]) => [arw.x + px, arw.y + py]);
    return pts.slice(0, -1)
      .map((p, i) => [p, pts[i + 1]])
      .filter(([p, q]) => p[0] !== q[0] && p[1] !== q[1]);
  });
  check("fanOut with route: orthogonal keeps every segment axis-aligned",
    sloped.length === 0, JSON.stringify(sloped));
}
{
  // fanOut hands label, standoff and style through to every arrowBetween call
  const src = { type: "rectangle", id: "src4", x: 0, y: 0, width: 100, height: 50 };
  const t1 = { type: "rectangle", id: "pt1", x: 200, y: 0, width: 80, height: 40 };
  const [arrow] = fanOut(src, [t1], { standoff: 20, label: "writes", strokeWidth: 3 }).map(resolveOne);
  check("fanOut passes label, standoff and style through to each arrow",
    arrow.label.text === "writes" && arrow.strokeWidth === 3 && arrow.x === 120,
    JSON.stringify(arrow));
}
{
  // a single target still gets a computed landAt, at the edge middle — the
  // same geometry as asking for originAt/landAt 0.5 explicitly
  const src = { type: "rectangle", id: "src5", x: 0, y: 0, width: 100, height: 50 };
  const t1 = { type: "rectangle", id: "one", x: 200, y: 0, width: 80, height: 90 };
  const [viaFanOut] = fanOut(src, [t1], { standoff: 10 }).map(resolveOne);
  const viaExplicit = arrowBetween(src, t1, { standoff: 10, originAt: 0.5, landAt: 0.5 });
  const shape = (arw) => JSON.stringify({ x: arw.x, y: arw.y, points: arw.points });
  check("fanOut with one target computes landAt 0.5, same as asking for it explicitly",
    shape(viaFanOut) === shape(viaExplicit), `${shape(viaFanOut)} vs ${shape(viaExplicit)}`);
}
{
  // many-to-one: two arrows landing on one target at distinct landAt fractions
  // separate instead of both pinning to the target's centre
  const a1 = { type: "rectangle", id: "m1", x: 0, y: 0, width: 100, height: 50 };
  const a2 = { type: "rectangle", id: "m2", x: 0, y: 100, width: 100, height: 50 };
  const target = { type: "rectangle", id: "shared", x: 200, y: 0, width: 100, height: 150 };
  const arrow1 = arrowBetween(a1, target, { standoff: 10, landAt: 0.28 });
  const arrow2 = arrowBetween(a2, target, { standoff: 10, landAt: 0.72 });
  const endY = (arw) => arw.y + arw.points.at(-1)[1];
  check("two arrows into one target at distinct landAt fractions land apart",
    near(endY(arrow1), 42) && near(endY(arrow2), 108) && endY(arrow1) !== endY(arrow2),
    `${endY(arrow1)} vs ${endY(arrow2)}`);
}

// ---- a fan is geometry the gate accepts: heads clear, nothing crossed ----
// The criterion behind the helper is that its output passes verification, so
// score it on the gate's own measurements rather than trusting the arithmetic:
// `shapeDepth` is what `arrow-buried` reads, `segmentLengthInsideShape` what
// `arrow-crossing` does, at the same thresholds.
{
  const offences = [];
  let fans = 0;
  for (const spread of [0, 0.3, 0.6, 1])
    for (const gap of [40, 160])
      for (const n of [1, 2, 3, 5])
        for (const route of [undefined, "orthogonal"]) {
          const src = { type: "rectangle", id: "src", x: 0, y: 0, width: 100, height: 60 * n };
          const targets = Array.from({ length: n }, (_, i) => ({
            type: "rectangle", id: `t${i}`, x: 100 + gap + 200, y: i * (60 + gap), width: 120, height: 60,
          }));
          const arrows = fanOut(src, targets, { standoff: 10, spread, route });
          resolveArrows(arrows);
          fans++;
          const where = `n=${n} spread=${spread} gap=${gap} ${route ?? "straight"}`;
          const heads = [];
          arrows.forEach((arrow, i) => {
            const pts = arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py]);
            heads.push(pts.at(-1).join(","));
            for (let s = 0; s + 1 < pts.length; s++) {
              const [p, q] = [pts[s], pts[s + 1]];
              for (const shape of [src, targets[i]]) {
                if (shapeDepth(shape, p) > 0.5 || shapeDepth(shape, q) > 0.5) {
                  offences.push(`${where}: arrow ${i} seg${s} has a vertex inside ${shape.id}`);
                }
                if (segmentLengthInsideShape(shape, p, q) > 2) {
                  offences.push(`${where}: arrow ${i} seg${s} crosses ${shape.id}`);
                }
              }
            }
          });
          // spread 0 sends every landing to its own target's edge middle, and
          // distinct targets keep those apart — piling needs one shared target
          if (new Set(heads).size !== n) offences.push(`${where}: ${n - new Set(heads).size} head(s) piled`);
        }
  check("every fan clears both its shapes and lands its heads apart",
    fans === 64 && offences.length === 0, `${fans} fans, ${offences[0] ?? "no offences"}`);
}

// ---- graph: ELK lays the nodes out in layers, the house still draws the edges ----
{
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { g, arrows } = await graph([a, b, c], [[a, b], [a, c]]);

  check("graph returns a placeable layout group over the nodes it was given",
    g.kind === "layout-group" && g.children.length === 3 &&
      g.children[0] === a && g.children[1] === b && g.children[2] === c);
  // the source of a two-edge fan is one layer above both its targets, and the
  // targets share that layer — the arrangement no hand placement was asked for
  check("graph layers the source above the targets it points at",
    a.y + a.height <= b.y && b.y === c.y);
  check("graph spreads one layer across the cross axis", b.x !== c.x);
  // a group that starts anywhere else would carry ELK's own root padding into
  // every panel that composes it
  check("graph hands back a group at the origin, its nodes flush against it",
    g.x === 0 && g.y === 0 &&
      Math.min(a.x, b.x, c.x) === 0 && Math.min(a.y, b.y, c.y) === 0);
  check("graph sizes the group to the nodes it placed",
    g.width === Math.max(a.x + a.width, b.x + b.width, c.x + c.width) &&
      g.height === Math.max(a.y + a.height, b.y + b.height, c.y + c.height));
  check("graph returns one deferred arrow per edge, bound to its endpoints",
    arrows.length === 2 &&
      arrows.every((ar) => ar.type === "arrow" && ar.width === undefined) &&
      arrows[0].start.id === "a" && arrows[0].end.id === "b" &&
      arrows[1].start.id === "a" && arrows[1].end.id === "c");
}

// ---- graph: direction transposes the flow, gap and layerGap space the two axes ----
{
  const lay = async (opts) => {
    const [a, b, c] = ["a", "b", "c"].map(node);
    await graph([a, b, c], [[a, b], [a, c]], opts);
    return { a, b, c };
  };

  const down = await lay({});
  const right = await lay({ direction: "right" });
  // the same graph read along the other axis: the layer that ran across now runs
  // down, and the source that sat above now sits beside
  check('graph direction: "right" transposes the flow',
    right.a.x + right.a.width <= right.b.x && right.b.x === right.c.x && right.b.y !== right.c.y &&
      down.a.y + down.a.height <= down.b.y);

  // each spacing moves its own axis and leaves the other alone — the claim that
  // makes them two options rather than one
  const wider = await lay({ gap: 140 });
  check("graph gap widens the space within a layer by exactly its increase",
    wider.c.x - (wider.b.x + wider.b.width) - (down.c.x - (down.b.x + down.b.width)) === 100 &&
      wider.b.y - (wider.a.y + wider.a.height) === down.b.y - (down.a.y + down.a.height));

  const taller = await lay({ layerGap: 160 });
  check("graph layerGap deepens the space between layers by exactly its increase",
    taller.b.y - (taller.a.y + taller.a.height) - (down.b.y - (down.a.y + down.a.height)) === 100 &&
      taller.c.x - (taller.b.x + taller.b.width) === down.c.x - (down.b.x + down.b.width));
}

// ---- graph: the group obeys the outermost mover, and its arrows follow ----
{
  const [a, b] = ["a", "b"].map(node);
  const { g, arrows } = await graph([a, b], [[a, b]], { standoff: 10 });
  const heading = { type: "text", id: "heading", width: 60, height: 20 };
  // the band-level mover runs after graph(), exactly as it would over a stack —
  // if the group did not carry its children, the arrow would resolve on the old
  // coordinates and be left behind
  column([heading, g], { x: 500, y: 300, gap: 30 });
  check("a graph group moves its nodes when a later layout call places it",
    a.x >= 500 && a.y >= 350 && g.x === 500);
  const [arrow] = resolveArrows(arrows);
  check("a graph arrow resolves against the moved nodes",
    arrow.y === a.y + a.height + 10 && arrow.y + arrow.height === b.y - 10);
}

// ---- graph: whole pixels, repeatable, and no trace of the engine ----
{
  const geometry = async () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map(node);
    // "right" is the direction that made ELK produce a fractional y before the
    // rounding — the case a byte-stable artifact depends on
    const { g, arrows } = await graph([a, b, c, d], [[a, b], [a, c], [b, d], [c, d]], { direction: "right" });
    return JSON.stringify(flatten([g, ...resolveArrows(arrows)]));
  };
  const first = await geometry();
  check("two graph runs on the same input produce identical geometry", first === await geometry());
  check("graph places every node on a whole pixel",
    JSON.parse(first).every((el) => Number.isInteger(el.x) && Number.isInteger(el.y)));
  // ELK stamps `$H` on every object it is handed; a house element that reached
  // the engine would carry it into the written document
  check("no ELK artifact reaches the elements graph hands back", !first.includes("$H"));
}

// ---- graph: per-edge options override the defaults shared by every arrow ----
{
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { arrows } = await graph(
    [a, b, c],
    [[a, b, { label: "yes" }], [a, c]],
    { standoff: 20, strokeWidth: 3 },
  );
  check("graph merges per-edge options over the shared arrow defaults",
    arrows[0].label.text === "yes" && arrows[0].strokeWidth === 3 &&
      arrows[1].label === undefined && arrows[1].strokeWidth === 3);
  const [yes] = resolveArrows([arrows[0]]);
  check("a shared arrow default reaches the resolved geometry",
    yes.y === a.y + a.height + 20);
}

// ---- graph: refusals, in the house voice ----
{
  const [a, b] = ["a", "b"].map(node);
  const stranger = node("stranger");
  check("graph needs a non-empty node list",
    await rejectsLayoutError(() => graph([])) && await rejectsLayoutError(() => graph(null)));
  check("graph refuses an edge naming a shape outside the node list",
    await rejectsLayoutError(() => graph([a, b], [[a, stranger]])) &&
      await rejectsLayoutError(() => graph([a, b], [[stranger, b]])));
  check("graph refuses an edge missing an endpoint",
    await rejectsLayoutError(() => graph([a, b], [[a]])) &&
      await rejectsLayoutError(() => graph([a, b], [a, b])));
  // a fourth entry is something the author wrote to be read, so it refuses
  // rather than dropping it silently
  check("graph refuses an edge carrying more than its options",
    await rejectsLayoutError(() => graph([a, b], [[a, b, { label: "x" }, { label: "y" }]])));
  check("graph refuses a direction it cannot lay out",
    await rejectsLayoutError(() => graph([a, b], [], { direction: "up" })));
  check("graph refuses spacings that are not pixel counts",
    await rejectsLayoutError(() => graph([a, b], [], { gap: NaN })) &&
      await rejectsLayoutError(() => graph([a, b], [], { layerGap: -10 })));
  check("graph refuses a node it cannot measure",
    await rejectsLayoutError(() => graph([{ type: "rectangle", id: "unmeasured" }])));
  // the same shape twice would collapse in the identity index, laying out a node
  // no edge could name rather than refusing
  check("graph refuses the same shape listed as two nodes",
    await rejectsLayoutError(() => graph([a, b, a], [[a, b]])));
}

// ---- engine route: graph() reads ELK's own path back, so the house stops hand-routing ----
// The whole point is the geometry the gate scores, so these claims are checked with
// `segmentLengthInsideShape` and `shapeDepth` — what `arrow-crossing` and
// `arrow-buried` read — rather than against arithmetic restated here.
const pathOf = (arrow) => arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py]);
const crossings = (arrow, shapes) => {
  const pts = pathOf(arrow);
  const hits = [];
  for (let s = 0; s + 1 < pts.length; s++) {
    for (const shape of shapes) {
      if (shapeDepth(shape, pts[s]) > 0.5 || shapeDepth(shape, pts[s + 1]) > 0.5) {
        hits.push(`vertex in ${shape.id}`);
      }
      if (segmentLengthInsideShape(shape, pts[s], pts[s + 1]) > 2) hits.push(`seg${s} crosses ${shape.id}`);
    }
  }
  return hits;
};

// a -> b -> c layers three deep, and a -> c skips the middle layer: the edge that
// used to be refused as `arrow-crossing` and hand-routed around b with `via`
const skipping = async (opts) => {
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { g, arrows } = await graph([a, b, c], [[a, b], [b, c], [a, c]], opts);
  const resolved = resolveArrows(arrows);
  return { a, b, c, g, arrows: resolved, skip: resolved[2] };
};

{
  const { a, b, c, skip } = await skipping({});
  check("an engine route bends the layer-skipping edge around the node between",
    pathOf(skip).length > 2, JSON.stringify(pathOf(skip)));
  check("the engine route clears every node in the graph",
    crossings(skip, [a, b, c]).length === 0, crossings(skip, [a, b, c])[0]);
  // the contrast is the reason this ticket exists: the same edge routed the old
  // way runs straight through the node ELK went around
  const direct = await skipping({ route: "direct" });
  check("the same edge routed direct still crosses the node between",
    pathOf(direct.skip).length === 2 &&
      crossings(direct.skip, [direct.b]).length > 0,
    crossings(direct.skip, [direct.b]).join("; "));
  // the endpoints stay the house's: standoff still holds both ends off their shape
  check("an engine route leaves standoff at both ends to the house",
    pathOf(skip)[0][1] === a.y + a.height + 10 && pathOf(skip).at(-1)[1] === c.y - 10,
    `${pathOf(skip)[0]} → ${pathOf(skip).at(-1)}`);
  // a path with corners goes in as explicit points, so roundness must be off —
  // the same rule `route: "orthogonal"` follows
  check("an engine route with bends turns roundness off", skip.roundness === null);
}

// a two-way pair needs no bend: ELK gives the two edges different ports, and the
// house reads those back — without them both arrows run the overlap centre and pile
{
  const [a, b] = ["a", "b"].map(node);
  const { arrows } = await graph([a, b], [[a, b], [b, a]]);
  const [there, back] = resolveArrows(arrows);
  check("an engine route separates a two-way pair by the ports ELK gave it",
    pathOf(there)[0][0] !== pathOf(back)[0][0] && pathOf(there).at(-1)[0] !== pathOf(back).at(-1)[0],
    `${pathOf(there)[0]} vs ${pathOf(back)[0]}`);
  check("each half of the pair still runs axis-aligned",
    pathOf(there)[0][0] === pathOf(there).at(-1)[0] &&
      pathOf(back)[0][0] === pathOf(back).at(-1)[0]);
  check("neither half of the pair enters a node",
    crossings(there, [a, b]).length === 0 && crossings(back, [a, b]).length === 0,
    [...crossings(there, [a, b]), ...crossings(back, [a, b])].join("; "));
}

// the band idiom is a later mover: `row(panels.map(p => p.g))` shifts the whole
// graph, and an absolute bend list would point at where the nodes used to be
{
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { g, arrows } = await graph([a, b, c], [[a, b], [b, c], [a, c]]);
  const before = pathOf(resolveArrows([{ ...arrows[2] }])[0]);
  const legend = { type: "rectangle", id: "legend", width: 80, height: 40 };
  row([g, legend], { x: 400, y: 250, gap: 30 });
  const [, , moved] = resolveArrows(arrows);
  check("an engine route survives a band-level mover, shifted with its group",
    JSON.stringify(pathOf(moved)) ===
      JSON.stringify(before.map(([px, py]) => [px + 400, py + 250])),
    JSON.stringify(pathOf(moved)));
  check("the moved engine route still clears every node",
    crossings(moved, [a, b, c]).length === 0, crossings(moved, [a, b, c])[0]);
}

// a node moved on its own leaves ELK's corridor stale: bends pointing at where the
// node was are the exact refusal this replaces, so the route drops to direct
{
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { arrows } = await graph([a, b, c], [[a, b], [b, c], [a, c]]);
  b.x += 300;
  const [, , skip] = resolveArrows(arrows);
  check("an engine route whose endpoints moved independently falls back to direct",
    pathOf(skip).length === 2, JSON.stringify(pathOf(skip)));
}
{
  // a resized node clears the corridor no more than a moved one does — the route
  // was computed against an extent that is gone
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { arrows } = await graph([a, b, c], [[a, b], [b, c], [a, c]]);
  a.width += 60;
  const [, , skip] = resolveArrows(arrows);
  check("a resized endpoint drops the engine route too",
    pathOf(skip).length === 2, JSON.stringify(pathOf(skip)));
}

// placing an endpoint yourself takes the whole path back: the corridor was cut for
// ELK's ports, and a bend list the endpoint no longer lines up with draws worse
// geometry than the straight run the fraction was picked against
{
  const { skip } = await skipping({ originAt: 0.9 });
  check("an originAt of the author's own revokes the engine route, not one end of it",
    pathOf(skip).length === 2, JSON.stringify(pathOf(skip)));
  const landed = await skipping({ landAt: 0.1 });
  check("so does a landAt", pathOf(landed.skip).length === 2, JSON.stringify(pathOf(landed.skip)));
  // and the fraction it was given is the one it lands on
  check("the revoked route still honours the fraction it was handed",
    pathOf(landed.skip).at(-1)[0] === landed.c.x + 0.1 * landed.c.width,
    `${pathOf(landed.skip).at(-1)[0]} vs ${landed.c.x + 0.1 * landed.c.width}`);
}

// ---- route: three named values, and the one only graph() can hand out ----
{
  const [a, b, c] = ["a", "b", "c"].map(node);
  const { arrows } = await graph([a, b, c], [[a, b], [b, c], [a, c, { route: "orthogonal" }]]);
  const [, , orth] = resolveArrows(arrows);
  // the elbow owns only the gap between its two shapes, so on this aligned pair it
  // has no slope to remove and stays the straight run — through b, as it always did
  check("a per-edge route overrides the engine default graph() applies",
    pathOf(orth).length === 2 && crossings(orth, [b]).length > 0,
    JSON.stringify(pathOf(orth)));

  const x = { type: "rectangle", id: "x", x: 0, y: 0, width: 100, height: 60 };
  const y = { type: "rectangle", id: "y", x: 0, y: 200, width: 100, height: 60 };
  check('route: "direct" is the escape hatch and draws the straight run',
    pathOf(arrowBetween(x, y, { route: "direct" })).length === 2);
  check("route refuses a value it cannot draw",
    throwsLayoutError(() => deferArrow(x, y, { route: "curved" })));
  // an engine route is ELK's answer; a hand-composed arrow has no engine behind it,
  // and drawing it straight instead would answer a question nobody asked
  check('route: "engine" outside graph() refuses rather than drawing direct',
    throwsLayoutError(() => resolveOne(deferArrow(x, y, { route: "engine" }))));
  check("route and via still refuse together, engine included",
    throwsLayoutError(() => deferArrow(x, y, { route: "engine", via: [[50, 100]] })));
}

// ---- flatten: mixed elements and groups, depth-first ----
{
  const t = { type: "text", width: 10, height: 10 };
  const g = box({ type: "text", width: 10, height: 10 }, { padding: 5 });
  const els = flatten([t, g]);
  check("flatten expands groups in place", els.length === 3 && els[0] === t && els[1] === g.shape);
}

// ---- output presets: one vocabulary, and a ramp the layout helpers read ----
{
  check("every preset names a surface and a full type ramp",
    PRESET_NAMES.every((name) => {
      const p = PRESETS[name];
      const surfaceOk = name === "fit"
        ? p.surface === null
        : Number.isFinite(p.surface?.width) && Number.isFinite(p.surface?.height);
      return surfaceOk && ["title", "label", "sublabel"].every((rung) => Number.isFinite(p.ramp[rung]));
    }),
    PRESET_NAMES.join(", "));
  // fit is the default and must not move today's numbers: the byte-identity
  // claim for every committed example rests on this one value
  check("fit is the default and keeps the 16px arrow-label size",
    DEFAULT_PRESET === "fit" && PRESETS.fit.ramp.sublabel === 16,
    `${DEFAULT_PRESET} / ${PRESETS.fit.ramp.sublabel}`);
  // a ramp reads title > label > sublabel, and a projected preset outsizes an
  // inline one at every rung — that is what "the sizes scale together" means
  check("each ramp descends title > label > sublabel",
    PRESET_NAMES.every((name) => {
      const r = PRESETS[name].ramp;
      return r.title > r.label && r.label > r.sublabel;
    }));
  check("slide-16x9 outsizes doc-inline at every rung",
    ["title", "label", "sublabel"].every(
      (rung) => PRESETS["slide-16x9"].ramp[rung] > PRESETS["doc-inline"].ramp[rung]));
  // a build receives surface and ramp by reference, and withAuthoring runs many
  // diagrams in one process — an assignment here would resize every later one
  check("a preset's surface and ramp are frozen against a build that assigns to them",
    PRESET_NAMES.every((name) => Object.isFrozen(PRESETS[name].ramp) &&
      (PRESETS[name].surface === null || Object.isFrozen(PRESETS[name].surface))));
  check("slide-16x9 is 16:9 and social-og is the OG card",
    PRESETS["slide-16x9"].surface.width / PRESETS["slide-16x9"].surface.height === 16 / 9 &&
      PRESETS["social-og"].surface.width === 1200 && PRESETS["social-og"].surface.height === 630);
}

// ---- rampedLayout: the ramp reaches an arrow label without a new option ----
{
  const a = { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 60 };
  const b = { type: "rectangle", id: "b", x: 300, y: 0, width: 100, height: 60 };
  const slide = rampedLayout(PRESETS["slide-16x9"].ramp);
  const [ramped] = resolveArrows([slide.arrowBetween(a, b, { label: "writes" })]);
  check("a ramped string label takes the preset's sublabel size",
    ramped.label.fontSize === PRESETS["slide-16x9"].ramp.sublabel &&
      ramped.label.fontFamily === PROSE,
    JSON.stringify(ramped.label));
  const [plainRamp] = resolveArrows([deferArrow(a, b, { label: "writes" })]);
  check("the bare helper still takes the fit ramp",
    plainRamp.label.fontSize === PRESETS.fit.ramp.sublabel, plainRamp.label.fontSize);
  // an explicit size is the more specific statement and outranks the ramp
  const [override] = resolveArrows([slide.arrowBetween(a, b, { label: { text: "12 ms", fontSize: 11 } })]);
  check("an explicit label fontSize still outranks the ramp", override.label.fontSize === 11);
  // fanOut and graph draw arrows too, so the ramp has to reach them as well
  const [fanned] = rampedLayout(PRESETS["slide-16x9"].ramp)
    .fanOut(a, [b], { label: "writes" }).map(resolveOne);
  check("fanOut's arrows carry the ramp",
    fanned.label.fontSize === PRESETS["slide-16x9"].ramp.sublabel, fanned.label.fontSize);
  check("rampedLayout exposes exactly the arrow-drawing helpers",
    JSON.stringify(Object.keys(slide).sort()) === JSON.stringify(["arrowBetween", "fanOut", "graph"]),
    Object.keys(slide).join(", "));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nlayout helpers behave");
process.exit(fail.length ? 1 : 0);
