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
import { NamedError } from "./errors.js";
import { bounds } from "./geometry.js";

const palette = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../brand/palette.json"), "utf8"),
);

/** A group cannot be composed as asked — bad items, gaps, direction or align. */
export class LayoutError extends NamedError {}

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
 *
 * A rotating `angle` is refused: the content is placed by translation alone, so
 * it would stay upright while the rectangle turned. `angle: 0` is the
 * renderer's default and passes as the no-op it is.
 */
export function box(child, { padding = 20, ...shapeProps } = {}) {
  if ("angle" in shapeProps) {
    const { angle } = shapeProps;
    if (!Number.isFinite(angle)) {
      // NaN and Infinity stringify to null as JSON, and a bigint throws — show
      // the value the way its own type reads instead
      const got = typeof angle === "string" ? JSON.stringify(angle) : String(angle);
      throw new LayoutError(`box angle must be a finite number, got ${got}`);
    }
    if (angle !== 0) {
      throw new LayoutError(
        `box does not rotate its content, so angle ${angle} would turn the rectangle and leave ` +
          "the content upright beside it — put the text on the shape as a label instead " +
          "(a rectangle carrying both angle and label: { text }), which rotates with its container",
      );
    }
    delete shapeProps.angle;
  }
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

/**
 * Where an arrow anchors: a group anchors on the rectangle it binds, so the
 * bounds and the binding can never name different elements. `requireBindable`
 * has already rejected any group without that rectangle.
 */
const anchorOf = (node) => (isGroup(node) ? node.shape : node);

/**
 * One bounds definition: geometry.js applies rotation, so an arrow to a turned
 * shape reaches its real extent instead of the upright box it was authored in.
 * That extent is the rotated *bounding box* — the same definition the gate
 * scores against — so at an oblique angle the anchor sits on the box rather
 * than on the shape's slanted edge.
 */
const boundsOf = (el) => {
  extent(el); // an unmeasured item fails here, with layout's own message
  const target = anchorOf(el);
  // this module reads a missing x/y as the origin (so do shift/place); geometry
  // reads them raw, so default them here instead of handing it NaN
  const { x1, y1, x2, y2 } = bounds({ ...target, x: target.x ?? 0, y: target.y ?? 0 });
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
};

// An element binds by its own id; a group binds only through the shape it
// exposes, because `flatten` drops groups — a group's own id, however it got
// there, names nothing in the finished skeleton.
const bindId = (node) => (isGroup(node) ? node.shape?.id : node?.id);

/**
 * A group is only bindable through the shape it exposes. A plain `column`/`row`
 * exposes none, so an arrow to it would go in unbound — passing the gate, then
 * detaching from the shape on the first edit in the app. Reject the call instead
 * of writing an arrow that looks connected and is not.
 */
function requireBindable(node, side) {
  if (isGroup(node) && !bindId(node)) {
    throw new LayoutError(
      `arrowBetween ${side} is a layout group with no element to bind — give its box an id ` +
        `(box(child, { id: "…" })), or wrap a plain column/row in one`,
    );
  }
}

/**
 * Waypoints turning a straight run between two standoff endpoints into an
 * orthogonal one: leave level, jog once across the gap's mid-line, arrive level.
 *
 * Endpoints already level (the shapes' cross ranges overlap, so the run has no
 * slope to remove) need no waypoint — the two-point arrow is already orthogonal.
 *
 * The jog cannot touch either shape: `arrowBetween` has already refused a
 * separation of `2 * standoff` or less, so both endpoints clear their own edge
 * and the mid-line sits strictly inside the gap.
 */
function elbow([sx, sy], [ex, ey], horizontal) {
  if (horizontal) {
    if (sy === ey) return [];
    const mx = (sx + ex) / 2;
    return [[mx, sy], [mx, ey]];
  }
  if (sx === ex) return [];
  const my = (sy + ey) / 2;
  return [[sx, my], [ex, my]];
}

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
 * source edge `standoff` px out and enters the target edge `standoff` px short.
 *
 * The converter does not run the app's elbow router, so a path with corners goes
 * in as explicit points with roundness off. `route: "orthogonal"` computes those
 * points — see `elbow` — and `via` takes them by hand as absolute coordinates;
 * asking for both is a `LayoutError`.
 *
 * `label` annotates the edge: `{ label: "writes" }` binds measured text to the
 * arrow, centred on the path. It is drawn over whatever lies behind it, so a
 * label wider than a short arrow is normal — but check the render when the arrow
 * runs close to a neighbour.
 */
export function arrowBetween(a, b, { standoff = 10, via = [], route, label, ...style } = {}) {
  if (route !== undefined && route !== "orthogonal") {
    throw new LayoutError(
      `arrowBetween route must be "orthogonal", got ${JSON.stringify(route)} — ` +
        "that is the only computed route; for any other path pass the waypoints yourself as via",
    );
  }
  if (route !== undefined && via.length) {
    throw new LayoutError(
      `arrowBetween cannot take both route: ${JSON.stringify(route)} and ${via.length} via ` +
        "waypoint(s) — drop via to have the route computed, or drop route to keep your own path",
    );
  }
  requireBindable(a, "source");
  requireBindable(b, "target");
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

  const waypoints = route === "orthogonal" ? elbow(start, end, dxGap >= dyGap) : via;

  const points = [start, ...waypoints, end].map(([px, py]) => [px - start[0], py - start[1]]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const arrow = {
    type: "arrow",
    x: start[0],
    y: start[1],
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points,
    ...(waypoints.length ? { roundness: null } : {}),
    ...(label !== undefined ? { label: labelSpec(label) } : {}),
    ...style,
  };
  const startId = bindId(a);
  const endId = bindId(b);
  if (startId) arrow.start = { id: startId };
  if (endId) arrow.end = { id: endId };
  return arrow;
}
