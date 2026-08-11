/**
 * Layout composition for generators. A generator measures its content, then
 * composes placement from these helpers instead of hand-accumulating pixel
 * offsets — the arithmetic that silently drifts as panels gain elements.
 *
 * Items are element skeletons carrying width/height (text gets both from
 * `measure`/`wrap`). Helpers mutate x/y in place and return a group — itself
 * placeable, so rows nest in columns and vice versa. `flatten` turns the tree
 * back into the element list a skeleton wants; authorDiagram does it for you.
 *
 * Arrows are the one thing that cannot be placed as it is written, because it
 * spans two shapes either of which a later call may still move. `arrowBetween`
 * therefore returns a deferred arrow and `resolveArrows` measures them all once
 * the movers are done — again, authorDiagram does it for you.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NamedError, loadDependency } from "./errors.js";
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
      `needs finite width and height (got ${w}x${h})`,
      {
        where: node?.id || `layout item ${JSON.stringify(node?.type ?? node?.kind)}`,
        next: "Measure text first, size shapes explicitly.",
      },
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
    throw new LayoutError("needs a non-empty array of items", {
      where: "stack", next: "Pass at least one item to stack().",
    });
  }
  if (direction !== "column" && direction !== "row") {
    throw new LayoutError(`direction must be "column" or "row", got ${JSON.stringify(direction)}`, {
      where: "stack", next: 'Pass "column" or "row" for direction.',
    });
  }
  if (!["start", "center", "end"].includes(align)) {
    throw new LayoutError(`align must be start, center or end, got ${JSON.stringify(align)}`, {
      where: "stack", next: 'Pass "start", "center" or "end" for align.',
    });
  }
  const gaps = Array.isArray(gap) ? gap : Array(Math.max(0, items.length - 1)).fill(gap);
  if (gaps.length !== items.length - 1) {
    throw new LayoutError(`gap array has ${gaps.length} entries for ${items.length} items`, {
      where: "stack", next: `Pass ${items.length - 1} entries.`,
    });
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
      throw new LayoutError(`angle must be a finite number, got ${got}`, {
        where: "box", next: "Pass a finite number, or omit angle.",
      });
    }
    if (angle !== 0) {
      throw new LayoutError(
        `does not rotate its content, so angle ${angle} would turn the rectangle and leave ` +
          "the content upright beside it",
        {
          where: "box",
          next: "Put the text on the shape as a label instead (a rectangle carrying both angle " +
            "and label: { text }), which rotates with its container.",
        },
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
    throw new LayoutError(`${side} is a layout group with no element to bind`, {
      where: "arrowBetween",
      next: 'Give its box an id (box(child, { id: "…" })), or wrap a plain column/row in one.',
    });
  }
}

/**
 * Waypoints turning a straight run between two standoff endpoints into an
 * orthogonal one: leave level, jog once across the gap's mid-line, arrive level.
 *
 * Endpoints that already share their cross coordinate have no slope to remove and
 * need no waypoint — the two-point arrow is already orthogonal.
 *
 * The jog cannot enter either shape, and the reason is the coupling to
 * `horizontal`: that is the axis of the *wider* separation, which is the one
 * `arrowBetween`'s `usable` check vouched for. Along it both endpoints therefore
 * sit at or beyond their own shape's facing edge and the mid-line falls strictly
 * between them — so every segment stays outside both shapes' extents. Routing
 * along the *other* axis would have no such guarantee.
 *
 * Outside, not clear of: at `standoff: 0` an endpoint sits exactly *on* its
 * shape's edge. That is depth zero, far under the gate's `arrow-buried` slack,
 * and it is what the direct arrow has always done at that standoff.
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

/**
 * The midpoint of two ranges' shared span, or `null` where they miss each other
 * entirely — the coordinate an arrow runs level through when both its shapes
 * reach across it.
 */
const overlapCentre = (a1, a2, b1, b2) => {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return lo < hi ? (lo + hi) / 2 : null;
};

/**
 * A **facing edge** read at `fraction` — `0` its low-coordinate end, `1` its
 * high one — falling back to the coordinate the arrow would have taken on its
 * own. One definition, so the horizontal and vertical branches cannot drift.
 */
const along = (fraction, lo, hi, fallback) =>
  fraction === undefined ? fallback : lo + fraction * (hi - lo);

/**
 * A rejected value, rendered for its own message. JSON reads best and is what the
 * rest of this module shows, but it throws on a bigint and drops `undefined` —
 * and an error about a bad value must not fail on the value.
 */
const shown = (value) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

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
    throw new LayoutError(`label needs text, got ${JSON.stringify(label)}`, {
      where: "arrowBetween", next: 'Pass a string or { text: "…" } for label.',
    });
  }
  return { fontSize: LABEL_FONT_SIZE, fontFamily: palette.fontFamily.prose, ...spec };
}

/**
 * The endpoints an arrow still has to be measured against, parked on the arrow
 * until `resolveArrows` runs. A symbol so it never reaches JSON — and an ordinary
 * enumerable one, so an arrow copied with `{ ...arrow, id }` stays resolvable.
 */
const DEFERRED = Symbol("deferred arrow endpoints");

/**
 * An arrow that owns the gap between two placed shapes (or boxes): it leaves the
 * source edge `standoff` px out and enters the target edge `standoff` px short.
 *
 * Geometry is **deferred**: the returned arrow carries its id, bindings, label and
 * style, and holds its two endpoints by reference until `resolveArrows` measures
 * them. So a layout call that moves either shape afterwards cannot leave the arrow
 * behind, and calling this before, between or after the movers gives one answer.
 * Options are still checked here, where they were written. `via` waypoints are the
 * exception the deferral cannot cover: they are absolute coordinates you supplied,
 * so they stay yours to keep in step with the shapes.
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
 *
 * `originAt`/`landAt` each pick a fraction of the source's/target's **facing
 * edge** — the cross-axis edge the arrow leaves or enters — in place of that
 * end's overlap midpoint: `0` is the low-coordinate end of the edge (top for a
 * vertical edge, left for a horizontal one), `1` the high end. Either one
 * omitted keeps today's overlap-midpoint (or shape-centre) behaviour for that
 * end, so nothing existing moves. This is what unpiles a many-to-one fan: two
 * arrows into one box at `landAt: 0.28` and `0.72` land apart instead of both
 * on the centre.
 */
export function arrowBetween(a, b, { standoff = 10, via = [], route, label, originAt, landAt, ...style } = {}) {
  const edge = () => `${bindId(a) ?? a?.type} and ${bindId(b) ?? b?.type}`;
  if (route !== undefined && route !== "orthogonal") {
    throw new LayoutError(
      `route must be "orthogonal", got ${JSON.stringify(route)} (arrow between ${edge()})`,
      { where: "arrowBetween", next: 'Pass route: "orthogonal", or pass the waypoints yourself as via.' },
    );
  }
  // the resolve pass takes these coordinates as given, so a malformed pair would
  // reach the gate as arrow geometry rather than the typo it is
  if (!Array.isArray(via) ||
      via.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isFinite(n)))) {
    throw new LayoutError(
      `via must be an array of [x, y] pairs of finite numbers, got ${shown(via)} ` +
        `(arrow between ${edge()})`,
      { where: "arrowBetween", next: "Pass via: [[x, y], …], or drop via for a straight run." },
    );
  }
  if (route !== undefined && via.length) {
    throw new LayoutError(
      `takes route: ${JSON.stringify(route)} or ${via.length} via waypoints, not both ` +
        `(arrow between ${edge()})`,
      { where: "arrowBetween", next: "Drop via to have the route computed, or drop route to keep your own path." },
    );
  }
  // the geometry it feeds is measured a pass later, where a bad number would
  // surface as an unplaceable arrow rather than as the typo it is
  if (!Number.isFinite(standoff)) {
    throw new LayoutError(
      `standoff must be a finite number, got ${shown(standoff)} (arrow between ${edge()})`,
      { where: "arrowBetween", next: "Pass a number for standoff, or omit it for the 10px default." },
    );
  }
  // same reasoning as standoff — a bad fraction is caught here, not as a
  // landing silently pinned to the wrong edge a pass later
  for (const [name, value] of [["originAt", originAt], ["landAt", landAt]]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new LayoutError(
        `${name} must be a finite number in [0, 1], got ${shown(value)} (arrow between ${edge()})`,
        {
          where: "arrowBetween",
          next: `Pass a fraction in [0, 1] for ${name}, or omit it to keep the overlap midpoint.`,
        },
      );
    }
  }
  requireBindable(a, "source");
  requireBindable(b, "target");
  const arrow = {
    type: "arrow",
    ...(label !== undefined ? { label: labelSpec(label) } : {}),
    ...style,
  };
  const startId = bindId(a);
  const endId = bindId(b);
  if (startId) arrow.start = { id: startId };
  if (endId) arrow.end = { id: endId };
  arrow[DEFERRED] = { a, b, standoff, via, route, originAt, landAt };
  return arrow;
}

/** Measure one deferred arrow's endpoints where they now stand, and place it. */
function resolveArrow(arrow) {
  const { a, b, standoff, via, route, originAt, landAt } = arrow[DEFERRED];
  const A = boundsOf(a);
  const B = boundsOf(b);
  const dxGap = Math.max(B.x1 - A.x2, A.x1 - B.x2);
  const dyGap = Math.max(B.y1 - A.y2, A.y1 - B.y2);
  const usable = Math.max(dxGap, dyGap) - 2 * standoff;
  if (usable <= 0) {
    throw new LayoutError(
      `no gap between ${bindId(a) ?? a.type} and ${bindId(b) ?? b.type} ` +
        `(separation ${Math.round(Math.max(dxGap, dyGap))}px, standoff ${standoff}px each side)`,
      {
        where: arrow.id ? `arrow ${arrow.id}` : "arrowBetween",
        next: "Move the shapes further apart, or lower standoff.",
      },
    );
  }

  // where the shapes' cross ranges overlap the arrow runs level through the
  // overlap's centre; otherwise it leaves and enters each shape at its own
  // centre. `originAt`/`landAt`, when supplied, replace that end's pick with a
  // fraction along the shape's own facing edge instead — the caller's fraction
  // always wins over the computed fallback.
  let start;
  let end;
  // the wider separation picks the axis, and it is the one `usable` vouched for
  const horizontal = dxGap >= dyGap;
  if (horizontal) {
    const centre = overlapCentre(A.y1, A.y2, B.y1, B.y2);
    const sy = along(originAt, A.y1, A.y2, centre ?? A.cy);
    const ey = along(landAt, B.y1, B.y2, centre ?? B.cy);
    const leftToRight = B.x1 >= A.x2;
    start = [leftToRight ? A.x2 + standoff : A.x1 - standoff, sy];
    end = [leftToRight ? B.x1 - standoff : B.x2 + standoff, ey];
  } else {
    const centre = overlapCentre(A.x1, A.x2, B.x1, B.x2);
    const sx = along(originAt, A.x1, A.x2, centre ?? A.cx);
    const ex = along(landAt, B.x1, B.x2, centre ?? B.cx);
    const topToBottom = B.y1 >= A.y2;
    start = [sx, topToBottom ? A.y2 + standoff : A.y1 - standoff];
    end = [ex, topToBottom ? B.y1 - standoff : B.y2 + standoff];
  }

  const waypoints = route === "orthogonal" ? elbow(start, end, horizontal) : via;

  const points = [start, ...waypoints, end].map(([px, py]) => [px - start[0], py - start[1]]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  delete arrow[DEFERRED];
  // a corner the caller did not ask for still needs roundness off, but a
  // roundness they set for themselves is theirs — the same ownership rule the
  // finish register follows
  if (waypoints.length && !Object.hasOwn(arrow, "roundness")) arrow.roundness = null;
  arrow.x = start[0];
  arrow.y = start[1];
  arrow.width = Math.max(...xs) - Math.min(...xs);
  arrow.height = Math.max(...ys) - Math.min(...ys);
  arrow.points = points;
  return arrow;
}

/**
 * Place every deferred arrow in a flat element list, in place, and hand the list
 * back. This is the pass that makes `arrowBetween`'s call order irrelevant, so it
 * belongs after the build returns and every mover has run — `authorDiagram` runs
 * it for you, right after `flatten`. It is idempotent: an arrow already resolved
 * (or one written by hand) passes through untouched.
 */
export function resolveArrows(elements) {
  for (const el of elements) if (el?.[DEFERRED]) resolveArrow(el);
  return elements;
}

/**
 * One source fanning out to N targets: N deferred arrows (each `arrowBetween`,
 * so bindings/label/style/standoff/route all come along unchanged), origins
 * united on the source's facing-edge middle and landings spread evenly across
 * the band centred on it. Written arrow by arrow, `arrowBetween`'s
 * overlap-midpoint pick scatters those origins across the source edge — each
 * pair is measured on its own, so the fan-out reads as unrelated stubs rather than
 * one argument.
 *
 * Arrow `i`'s `landAt`: `n === 1 ? 0.5 : 0.5 + spread * (i / (n - 1) - 0.5)`.
 * Fractions follow **argument order**, not target position. `spread` (default
 * `0.6`) bands the middle of the edge — `spread: 0` collapses every landing
 * back to the edge middle.
 *
 * Origins unite only while every target sits off the *same* source edge: one
 * straddling the source picks a different facing edge and legitimately gets a
 * different origin there too. An `originAt` or `landAt` of your own in `opts`
 * lands last and holds, the same ownership rule `roundness` follows.
 */
export function fanOut(source, targets, { spread = 0.6, ...opts } = {}) {
  // named for the source, because two fans in one build otherwise refuse in
  // byte-identical words — the same reason `arrowBetween` names its own edge
  const from = () => `fan from ${bindId(source) ?? source?.type}`;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new LayoutError(`targets must be a non-empty array, got ${shown(targets)} (${from()})`, {
      where: "fanOut", next: "Pass at least one target shape.",
    });
  }
  if (!Number.isFinite(spread) || spread < 0 || spread > 1) {
    throw new LayoutError(`spread must be a finite number in [0, 1], got ${shown(spread)} (${from()})`, {
      where: "fanOut", next: "Pass a fraction in [0, 1] for spread, or omit it for the 0.6 default.",
    });
  }
  const n = targets.length;
  return targets.map((target, i) => arrowBetween(source, target, {
    originAt: 0.5,
    landAt: n === 1 ? 0.5 : 0.5 + spread * (i / (n - 1) - 0.5),
    ...opts,
  }));
}

/**
 * ELK's engine, built on first use. Constructing one costs ~100ms, and the
 * import is deferred for the reason `loadDependency` explains — so a `check` run
 * never loads a graph engine it has no graph for.
 */
let engine;
async function elkEngine() {
  if (!engine) {
    const { default: ELK } = await loadDependency("elkjs", "graph() needs the layout engine");
    engine = new ELK();
  }
  return engine;
}

const ELK_DIRECTION = { down: "DOWN", right: "RIGHT" };

/**
 * A graph — nodes and the edges between them — laid out by ELK's `layered`
 * algorithm instead of by hand. The nodes arrive already measured, ELK decides
 * which layer each one sits in and where along it, and the result composes like
 * any other group: `{ g, arrows }`, `g` a placed layout group over the same node
 * objects, `arrows` one deferred `arrowBetween` per edge.
 *
 * Edges are `[source, target]` or `[source, target, arrowOpts]` — the node
 * objects themselves, not ids. Per-edge options merge over the shared arrow
 * defaults left in `opts`, so `graph(nodes, edges, { standoff: 14 })` styles
 * every arrow and a third entry overrides one.
 *
 * **The house draws the edges, not ELK.** ELK's own routing sections are
 * discarded and every edge becomes a bound `arrowBetween`, which is what keeps
 * labels, standoff, arrowheads and gate checking working exactly as they do for
 * a hand-written arrow. The cost is that a dense graph can route an arrow across
 * a node ELK would have gone around: the gate's `arrow-crossing` refusal is the
 * detector, and `via` waypoints on that one edge are the way out.
 *
 * Positions are rounded to whole pixels, so the same input regenerates the same
 * artifact byte for byte. ELK is deterministic on its own; the rounding closes
 * the float-formatting gap between Node versions.
 *
 * `direction` is the flow — `"down"` (default) layers top to bottom, `"right"`
 * left to right. `gap` spaces nodes within a layer, `layerGap` spaces the layers
 * themselves. Flat graphs only, and `layered` only; nested children and the
 * other ELK algorithms are out of scope by design.
 */
export async function graph(nodes, edges = [], { direction = "down", gap = 40, layerGap = 60, ...arrowDefaults } = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new LayoutError(`nodes must be a non-empty array, got ${shown(nodes)}`, {
      where: "graph", next: "Pass at least one measured shape as a node.",
    });
  }
  if (!Object.hasOwn(ELK_DIRECTION, direction)) {
    throw new LayoutError(`direction must be "down" or "right", got ${shown(direction)}`, {
      where: "graph", next: 'Pass "down" or "right" for direction.',
    });
  }
  for (const [name, value] of [["gap", gap], ["layerGap", layerGap]]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new LayoutError(`${name} must be a finite number of pixels, got ${shown(value)}`, {
        where: "graph", next: `Pass a non-negative number for ${name}, or omit it for the default.`,
      });
    }
  }
  if (!Array.isArray(edges)) {
    throw new LayoutError(`edges must be an array of [source, target] pairs, got ${shown(edges)}`, {
      where: "graph", next: "Pass edges: [[a, b], [b, c]], or omit them for nodes alone.",
    });
  }

  // identity, not id: the caller hands over the same objects it built, and an
  // edge naming a shape from a different panel is the mistake worth catching
  const index = new Map(nodes.map((node, i) => [node, i]));
  // one shape cannot stand in two places, and the map above would silently keep
  // only its last slot — so the engine would lay out a node no edge could reach
  if (index.size !== nodes.length) {
    throw new LayoutError(`nodes lists ${nodes.length} entries but only ${index.size} distinct shapes`, {
      where: "graph", next: "Build a separate shape per node, and list each one once.",
    });
  }
  const wired = edges.map((edge, i) => {
    // exactly two or three: a fourth entry is something the author meant to be
    // read, and accepting it would drop it without a word
    if (!Array.isArray(edge) || edge.length < 2 || edge.length > 3) {
      throw new LayoutError(`edge ${i} must be [source, target] or [source, target, opts], got ${shown(edge)}`, {
        where: "graph", next: "Give the edge both of its endpoints, and its options in one third entry.",
      });
    }
    const [source, target, opts = {}] = edge;
    for (const [side, node] of [["source", source], ["target", target]]) {
      if (!index.has(node)) {
        throw new LayoutError(
          `edge ${i}'s ${side} ${bindId(node) ?? shown(node?.type)} is not one of the ${nodes.length} nodes`,
          { where: "graph", next: "Pass the node object itself, and list every endpoint in nodes." },
        );
      }
    }
    return { source, target, opts };
  });

  // measured once: `place` moves a node without resizing it, so these hold for
  // the group's own extent below
  const sizes = nodes.map(extent);

  // ELK decorates every object it is handed with an internal `$H` and writes the
  // results back onto it, so it is fed a plain graph built here and never a
  // house element.
  const laid = await (await elkEngine()).layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": ELK_DIRECTION[direction],
      "elk.spacing.nodeNode": gap,
      "elk.layered.spacing.nodeNodeBetweenLayers": layerGap,
    },
    children: sizes.map((size, i) => ({ id: `n${i}`, ...size })),
    edges: wired.map(({ source, target }, i) => ({
      id: `e${i}`,
      sources: [`n${index.get(source)}`],
      targets: [`n${index.get(target)}`],
    })),
  });

  // `laid.children[i]` is `nodes[i]`: ELK lays out in place and hands back the
  // very array it was given, so the order it was built in is the order it
  // returns in. Read by index rather than by the `n${i}` ids, which exist for
  // the edges to name.
  //
  // ELK also pads its root, so the placed nodes are pulled back flush against
  // the origin: a group carrying that padding would space every panel that
  // composed it by an amount its author never wrote.
  const placed = laid.children.map((child) => ({ x: Math.round(child.x), y: Math.round(child.y) }));
  const originX = Math.min(...placed.map((p) => p.x));
  const originY = Math.min(...placed.map((p) => p.y));
  nodes.forEach((node, i) => place(node, placed[i].x - originX, placed[i].y - originY));

  return {
    g: {
      kind: "layout-group",
      x: 0,
      y: 0,
      width: Math.max(...nodes.map((node, i) => node.x + sizes[i].width)),
      height: Math.max(...nodes.map((node, i) => node.y + sizes[i].height)),
      children: nodes,
    },
    arrows: wired.map(({ source, target, opts }) => arrowBetween(source, target, { ...arrowDefaults, ...opts })),
  };
}
