/**
 * Layout composition for generators. A generator measures its content, then
 * composes placement from these helpers instead of hand-accumulating pixel
 * offsets — the arithmetic that silently drifts as panels gain elements.
 *
 * Items are element skeletons carrying width/height (text gets both from
 * `measure`/`wrap`). Helpers mutate x/y in place and return a group — itself
 * placeable, so rows nest in columns and vice versa. `flatten` turns the tree
 * back into the element list a skeleton wants; authorDiagram does it for you.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const palette = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../brand/palette.json"), "utf8"),
);

export class LayoutError extends Error {
  name = "LayoutError";
}

const isGroup = (node) => node?.kind === "layout-group";

function extent(node) {
  const w = node?.width;
  const h = node?.height;
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new LayoutError(
      `layout item ${JSON.stringify(node?.type ?? node?.kind)} needs finite width and height ` +
        `(got ${w}x${h}) — measure text first, size shapes explicitly`,
    );
  }
  return { width: w, height: h };
}

function shift(node, dx, dy) {
  if (isGroup(node)) {
    node.x += dx;
    node.y += dy;
    for (const child of node.children) shift(child, dx, dy);
  } else {
    node.x = (node.x ?? 0) + dx;
    node.y = (node.y ?? 0) + dy;
  }
}

const place = (node, x, y) => shift(node, x - (node.x ?? 0), y - (node.y ?? 0));

/** Expand groups depth-first into the flat element list a skeleton wants. */
export function flatten(nodes) {
  const out = [];
  for (const n of Array.isArray(nodes) ? nodes : [nodes]) {
    if (isGroup(n)) out.push(...flatten(n.children));
    else out.push(n);
  }
  return out;
}

/**
 * Place items along one axis with explicit gaps and cross-axis alignment.
 * `gap` is one number for every pair or an array with one entry per pair;
 * `align` is start | center | end across the other axis.
 */
export function stack(items, { direction = "column", x = 0, y = 0, gap = 0, align = "start" } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new LayoutError("stack needs a non-empty array of items");
  }
  if (direction !== "column" && direction !== "row") {
    throw new LayoutError(`direction must be "column" or "row", got ${JSON.stringify(direction)}`);
  }
  if (!["start", "center", "end"].includes(align)) {
    throw new LayoutError(`align must be start, center or end, got ${JSON.stringify(align)}`);
  }
  const gaps = Array.isArray(gap) ? gap : Array(Math.max(0, items.length - 1)).fill(gap);
  if (gaps.length !== items.length - 1) {
    throw new LayoutError(`gap array has ${gaps.length} entries for ${items.length} items (needs ${items.length - 1})`);
  }

  const sizes = items.map(extent);
  const crossOf = (s) => (direction === "column" ? s.width : s.height);
  const mainOf = (s) => (direction === "column" ? s.height : s.width);
  const cross = Math.max(...sizes.map(crossOf));

  let main = 0;
  items.forEach((item, i) => {
    if (i > 0) main += gaps[i - 1];
    const off =
      align === "center" ? (cross - crossOf(sizes[i])) / 2 : align === "end" ? cross - crossOf(sizes[i]) : 0;
    if (direction === "column") place(item, x + off, y + main);
    else place(item, x + main, y + off);
    main += mainOf(sizes[i]);
  });

  return {
    kind: "layout-group",
    x,
    y,
    width: direction === "column" ? cross : main,
    height: direction === "column" ? main : cross,
    children: items,
  };
}

export const column = (items, opts = {}) => stack(items, { ...opts, direction: "column" });
export const row = (items, opts = {}) => stack(items, { ...opts, direction: "row" });

/**
 * Wrap content in a rectangle sized by padding — a card whose height follows
 * its measured content. Shape props (id, colours, roundness…) pass through;
 * the returned group exposes the rectangle as `.shape` so arrows can bind it.
 */
export function box(child, { padding = 20, ...shapeProps } = {}) {
  const s = extent(child);
  const shape = {
    type: "rectangle",
    x: 0,
    y: 0,
    width: s.width + 2 * padding,
    height: s.height + 2 * padding,
    ...shapeProps,
  };
  place(child, padding, padding);
  return {
    kind: "layout-group",
    x: 0,
    y: 0,
    width: shape.width,
    height: shape.height,
    children: [shape, child],
    shape,
  };
}

const boundsOf = (el) => {
  const { width, height } = extent(el);
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  return { x1: x, y1: y, x2: x + width, y2: y + height, cx: x + width / 2, cy: y + height / 2 };
};

const bindId = (node) => node?.id ?? node?.shape?.id;

/** One step below body prose: an edge annotation, not a heading. */
const LABEL_FONT_SIZE = 16;

/**
 * Turn the `label` shorthand into the skeleton's bound-text form. A string is the
 * common case; an object overrides the defaults (`fontSize`, colour, anything the
 * converter accepts). The house prose font is the default because the gate rejects
 * text outside the house pair, and the converter measures the text itself — the
 * label is real bound text, not a decoration.
 */
function labelSpec(label) {
  const spec = typeof label === "string" ? { text: label } : label;
  if (!spec || typeof spec.text !== "string" || spec.text === "") {
    throw new LayoutError(
      `arrow label needs text: pass a string or { text: "…" }, got ${JSON.stringify(label)}`,
    );
  }
  return { fontSize: LABEL_FONT_SIZE, fontFamily: palette.fontFamily.prose, ...spec };
}

/**
 * An arrow that owns the gap between two placed shapes (or boxes): it leaves the
 * source edge `standoff` px out, enters the target edge `standoff` px short, and
 * writes explicit points — the converter does not run the app's elbow router, so
 * a routed path goes in as `via` waypoints (absolute coordinates) and keeps its
 * corners with roundness off.
 *
 * `label` annotates the edge: `{ label: "writes" }` binds measured text to the
 * arrow, centred on the path. It is drawn over whatever lies behind it, so a
 * label wider than a short arrow is normal — but check the render when the arrow
 * runs close to a neighbour.
 */
export function arrowBetween(a, b, { standoff = 10, via = [], label, ...style } = {}) {
  const A = boundsOf(a);
  const B = boundsOf(b);
  const dxGap = Math.max(B.x1 - A.x2, A.x1 - B.x2);
  const dyGap = Math.max(B.y1 - A.y2, A.y1 - B.y2);
  const usable = Math.max(dxGap, dyGap) - 2 * standoff;
  if (usable <= 0) {
    throw new LayoutError(
      `no gap for an arrow to own between ${bindId(a) ?? a.type} and ${bindId(b) ?? b.type} ` +
        `(separation ${Math.round(Math.max(dxGap, dyGap))}px, standoff ${standoff}px each side)`,
    );
  }

  // where the shapes' cross ranges overlap the arrow runs level through the
  // overlap's centre; otherwise it leaves and enters each shape at its own centre
  let start;
  let end;
  if (dxGap >= dyGap) {
    const o1 = Math.max(A.y1, B.y1);
    const o2 = Math.min(A.y2, B.y2);
    const sy = o1 < o2 ? (o1 + o2) / 2 : A.cy;
    const ey = o1 < o2 ? (o1 + o2) / 2 : B.cy;
    const leftToRight = B.x1 >= A.x2;
    start = [leftToRight ? A.x2 + standoff : A.x1 - standoff, sy];
    end = [leftToRight ? B.x1 - standoff : B.x2 + standoff, ey];
  } else {
    const o1 = Math.max(A.x1, B.x1);
    const o2 = Math.min(A.x2, B.x2);
    const sx = o1 < o2 ? (o1 + o2) / 2 : A.cx;
    const ex = o1 < o2 ? (o1 + o2) / 2 : B.cx;
    const topToBottom = B.y1 >= A.y2;
    start = [sx, topToBottom ? A.y2 + standoff : A.y1 - standoff];
    end = [ex, topToBottom ? B.y1 - standoff : B.y2 + standoff];
  }

  const points = [start, ...via, end].map(([px, py]) => [px - start[0], py - start[1]]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const arrow = {
    type: "arrow",
    x: start[0],
    y: start[1],
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points,
    ...(via.length ? { roundness: null } : {}),
    ...(label !== undefined ? { label: labelSpec(label) } : {}),
    ...style,
  };
  const startId = bindId(a);
  const endId = bindId(b);
  if (startId) arrow.start = { id: startId };
  if (endId) arrow.end = { id: endId };
  return arrow;
}
