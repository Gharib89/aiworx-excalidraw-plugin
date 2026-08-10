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

/**
 * Whether two elements' outlines intersect, rotation honoured (separating-axis
 * test on the outline quads). Linear elements fall back to their bounding box —
 * their point list is not a convex polygon. Touching edges do not overlap.
 *
 * An outline with no area still has extent: a flat arrow or a zero-width text
 * collapses to a segment, and one reaching into another outline overlaps it.
 * Two such outlines are the exception — where a degenerate pair's only axis is
 * the one they share, the equal projections read as touching, so collinear
 * segments covering the same ink report no overlap. Both are then degenerate
 * enough that rule 1 of the gate reports them on their own.
 */
export function outlinesOverlap(a, b) {
  const pa = convexOutline(a);
  const pb = convexOutline(b);
  // Two outlines that have both collapsed to a point offer no axis between
  // them, and a test with no axis to try reports every pair as overlapping.
  // They have no extent to share, so the touching rule answers this: never.
  if (isPoint(pa) && isPoint(pb)) return false;
  return !separated(pa, pb) && !separated(pb, pa);
}

/** Whether an outline has collapsed to a single point — no extent in any direction. */
function isPoint(pts) {
  return pts.every(([x, y]) => x === pts[0][0] && y === pts[0][1]);
}

function convexOutline(e) {
  if ((e.type === "arrow" || e.type === "line" || e.type === "freedraw") && Array.isArray(e.points)) {
    const b = bounds(e);
    return [
      [b.x1, b.y1],
      [b.x2, b.y1],
      [b.x2, b.y2],
      [b.x1, b.y2],
    ];
  }
  return outline(e);
}

/** True when some edge normal of `pts` separates the two point sets. */
function separated(pts, other) {
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const nx = y2 - y1;
    const ny = x1 - x2;
    // A zero-length edge — which every degenerate outline has, a flat arrow's
    // box being a segment walked out and back — has the null vector for a
    // normal. It projects both sets onto 0, and `aMax <= bMin` then reads that
    // as a separating axis, so a flat connector deep inside a frame reported no
    // overlap at all. Skipping it leaves exactly the axes a segment really has.
    if (nx === 0 && ny === 0) continue;
    const project = (poly) => {
      let min = Infinity;
      let max = -Infinity;
      for (const [px, py] of poly) {
        const d = px * nx + py * ny;
        if (d < min) min = d;
        if (d > max) max = d;
      }
      return [min, max];
    };
    const [aMin, aMax] = project(pts);
    const [bMin, bMax] = project(other);
    if (aMax <= bMin || bMax <= aMin) return true;
  }
  return false;
}

/**
 * Whether `inner` sits entirely inside `outer`, rotation honoured, with `pad` px
 * of slack — no point of inner's ink pokes past any edge of outer's outline.
 * Judging this on axis-aligned boxes reports a rotated ellipse or diamond as
 * escaping while its ink still fits, because the corners of its rotated box are
 * empty. So ink is what counts: ellipse and diamond are the ellipse inscribed in
 * their box (the same shape model as `shapeDepth` — exact for an ellipse, and
 * for a diamond an approximation that swells past its edges towards its
 * vertices, so containment errs towards reporting), everything else its outline,
 * and linear elements their box, as `outlinesOverlap` does.
 */
export function outlineContains(outer, inner, pad = 0.5) {
  // negated, not `>= -pad`: non-finite geometry yields NaN, and a document the
  // gate already reports as non-finite must not also be reported as escaping
  return !(clearance(outer, inner) < -pad);
}

/**
 * How far inside `outer`'s outline `inner`'s ink stops, in px: the smallest
 * clearance to any of outer's edges, measured on the same ink model
 * `outlineContains` judges containment on. Negative when inner pokes out — then
 * it is the overhang. `Infinity` for an outer with no edges.
 */
export function clearance(outer, inner) {
  const poly = convexOutline(outer);
  let least = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!len) continue;
    // Outward unit normal of this edge, then how far short of it inner stops.
    // `convexOutline` always winds top-left → top-right → bottom-right, which
    // rotation preserves, so (dy, -dx) points away from the interior.
    const n = [(y2 - y1) / len, (x1 - x2) / len];
    least = Math.min(least, x1 * n[0] + y1 * n[1] - support(inner, n));
  }
  return least;
}

/** How far an element's ink reaches in direction `n` (a unit vector). */
function support(e, [nx, ny]) {
  if (e.type === "ellipse" || e.type === "diamond") {
    const a = Math.abs(e.width ?? 0) / 2;
    const b = Math.abs(e.height ?? 0) / 2;
    const angle = e.angle ?? 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // the ellipse's own axes in world space
    const u = nx * cos + ny * sin;
    const v = -nx * sin + ny * cos;
    return (e.x + a) * nx + (e.y + b) * ny + Math.hypot(a * u, b * v);
  }
  let max = -Infinity;
  for (const [px, py] of convexOutline(e)) max = Math.max(max, px * nx + py * ny);
  return max;
}

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
 * Shortest distance from segment p→q to an element's outline, in px — 0 when
 * the segment crosses an edge of the outline or either endpoint lies inside
 * it. The outline is `outline(e)`'s point list read as a closed polygon, so
 * rotation is honoured the same way the rest of this module honours it. That
 * polygon is the element's rotated box, not the inscribed-ellipse ink model
 * `shapeDepth` and `segmentLengthInsideShape` use for ellipse and diamond —
 * right for a text's rectangular outline, wrong for an ellipse or diamond's
 * ink.
 */
export function segmentGap(e, p, q) {
  const poly = outline(e);
  if (pointInPolygon(p, poly) || pointInPolygon(q, poly)) return 0;
  let least = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (segmentsCross(p, q, a, b)) return 0;
    least = Math.min(least, pointToSegment(p, a, b), pointToSegment(q, a, b), pointToSegment(a, p, q), pointToSegment(b, p, q));
  }
  return least;
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether segments p→q and a→b cross properly (touching at an endpoint isn't a cross, but the point-distance below is 0 either way). */
function segmentsCross([px, py], [qx, qy], [ax, ay], [bx, by]) {
  const cross = (ox, oy, ux, uy, vx, vy) => (ux - ox) * (vy - oy) - (uy - oy) * (vx - ox);
  const d1 = cross(ax, ay, bx, by, px, py);
  const d2 = cross(ax, ay, bx, by, qx, qy);
  const d3 = cross(px, py, qx, qy, ax, ay);
  const d4 = cross(px, py, qx, qy, bx, by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance from point p to segment a→b. */
function pointToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
