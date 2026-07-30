#!/usr/bin/env node
/**
 * Unit suite for the layout helpers (tools/layout.js). Pure geometry — no
 * browser. Pins the placement arithmetic a generator would otherwise hand-roll:
 * stacking with explicit gaps, cross-axis alignment, nesting, padded boxes, and
 * arrows that own the gap between two shapes — labelled or not.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { column, row, stack, box, arrowBetween, flatten, LayoutError } from "../tools/layout.js";

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
const throwsLayoutError = (fn) => {
  try {
    fn();
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

// ---- flatten: mixed elements and groups, depth-first ----
{
  const t = { type: "text", width: 10, height: 10 };
  const g = box({ type: "text", width: 10, height: 10 }, { padding: 5 });
  const els = flatten([t, g]);
  check("flatten expands groups in place", els.length === 3 && els[0] === t && els[1] === g.shape);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nlayout helpers behave");
process.exit(fail.length ? 1 : 0);
