/**
 * Shared geometry for the gate (check.js) and the author module (author.js).
 * One definition of where an element is, so the gate and the frame binder can
 * never disagree about it.
 */

/**
 * Absolute outline points of an element, rotation applied. Linear elements
 * (arrow, line, freedraw) carry their shape in `points` with x/y as the origin;
 * everything else is its four corners. `angle` rotates about the box centre,
 * matching Excalidraw's renderer.
 */
export function outline(e) {
  let pts;
  if ((e.type === "arrow" || e.type === "line" || e.type === "freedraw") && Array.isArray(e.points)) {
    pts = e.points.map(([px, py]) => [e.x + px, e.y + py]);
  } else {
    const w = Math.abs(e.width ?? 0);
    const h = Math.abs(e.height ?? 0);
    pts = [
      [e.x, e.y],
      [e.x + w, e.y],
      [e.x + w, e.y + h],
      [e.x, e.y + h],
    ];
  }
  const angle = e.angle ?? 0;
  if (!angle) return pts;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pts.map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
}

/** Axis-aligned bounding box, honouring rotation. */
export function bounds(e) {
  const pts = outline(e);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

export const overlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

export const contains = (outer, inner, pad = 0.5) =>
  inner.x1 >= outer.x1 - pad &&
  inner.y1 >= outer.y1 - pad &&
  inner.x2 <= outer.x2 + pad &&
  inner.y2 <= outer.y2 + pad;

/** Shortest distance between two boxes; 0 when they touch or overlap. */
export function gap(a, b) {
  const dx = Math.max(0, Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2));
  const dy = Math.max(0, Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2));
  return Math.hypot(dx, dy);
}

/**
 * How deep a point sits inside a shape's actual ink, in px; negative outside.
 * Works in the shape's local (unrotated) frame, so rotated shapes are exact.
 * Ellipses use the true ellipse; diamonds are approximated by their inscribed
 * ellipse (slightly generous near the vertices). Everything else is its box.
 */
export function shapeDepth(e, point) {
  const { x, y, a, b, cx, cy } = local(e, point);
  if (e.type === "ellipse" || e.type === "diamond") {
    const rho = Math.hypot((x - cx) / a, (y - cy) / b);
    return (1 - rho) * Math.min(a, b);
  }
  return Math.min(x - (cx - a), cx + a - x, y - (cy - b), cy + b - y);
}

/**
 * Length of the part of segment p→q that lies inside a shape's ink, shrunk by
 * `inset` px so grazing an edge doesn't count. Same shape model as shapeDepth.
 */
export function segmentLengthInsideShape(e, p, q, inset = 1) {
  const lp = local(e, p);
  const lq = local(e, q);
  const { a, b, cx, cy } = lp;
  if (a <= inset || b <= inset) return 0;
  if (e.type === "ellipse" || e.type === "diamond") {
    const u0 = [(lp.x - cx) / (a - inset), (lp.y - cy) / (b - inset)];
    const du = [(lq.x - lp.x) / (a - inset), (lq.y - lp.y) / (b - inset)];
    const A = du[0] ** 2 + du[1] ** 2;
    if (A === 0) return 0;
    const B = 2 * (u0[0] * du[0] + u0[1] * du[1]);
    const C = u0[0] ** 2 + u0[1] ** 2 - 1;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return 0;
    const t0 = Math.max(0, (-B - Math.sqrt(disc)) / (2 * A));
    const t1 = Math.min(1, (-B + Math.sqrt(disc)) / (2 * A));
    return Math.max(0, t1 - t0) * Math.hypot(lq.x - lp.x, lq.y - lp.y);
  }
  const r = { x1: cx - a + inset, y1: cy - b + inset, x2: cx + a - inset, y2: cy + b - inset };
  return segmentLengthInside([lp.x, lp.y], [lq.x, lq.y], r);
}

/** A point in the shape's unrotated frame, plus the shape's centre and semi-axes. */
function local(e, [px, py]) {
  const a = Math.abs(e.width ?? 0) / 2;
  const b = Math.abs(e.height ?? 0) / 2;
  const cx = e.x + a;
  const cy = e.y + b;
  const angle = e.angle ?? 0;
  if (!angle) return { x: px, y: py, a, b, cx, cy };
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return {
    x: cx + (px - cx) * cos - (py - cy) * sin,
    y: cy + (px - cx) * sin + (py - cy) * cos,
    a,
    b,
    cx,
    cy,
  };
}

/**
 * Length of the part of segment p→q that lies inside box r (Liang–Barsky clip).
 * Zero when the segment misses the box.
 */
function segmentLengthInside([x0, y0], [x1, y1], r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, x0 - r.x1],
    [dx, r.x2 - x0],
    [-dy, y0 - r.y1],
    [dy, r.y2 - y0],
  ]) {
    if (p === 0) {
      if (q < 0) return 0;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return 0;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return 0;
      if (t < t1) t1 = t;
    }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}
