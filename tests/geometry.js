#!/usr/bin/env node
/**
 * Unit suite for the gate's geometric foundation (tools/geometry.js). Every
 * rule in tools/verify.js is an opinion built on these primitives, so a
 * regression here surfaces three layers up as a fixture diff unless it is
 * caught at the module that broke.
 *
 * Expected values are derived by hand from the rotation the renderer applies
 * (about the box centre), never read back from the implementation. The rotated
 * cases carry the load: each one is paired with the axis-aligned answer it must
 * *not* give, so a primitive that quietly drops `angle` fails here instead of
 * passing on symmetry.
 *
 * Exits non-zero on any mismatch.
 */
import {
  outline,
  bounds,
  outlinesOverlap,
  outlineContains,
  clearance,
  gap,
  shapeDepth,
  segmentLengthInsideShape,
} from "../tools/geometry.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const EPS = 1e-9;
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps;
const pointsNear = (got, want, eps = EPS) =>
  Array.isArray(got) &&
  got.length === want.length &&
  got.every((p, i) => near(p[0], want[i][0], eps) && near(p[1], want[i][1], eps));
const show = (pts) => JSON.stringify(pts.map((p) => p.map((n) => Math.round(n * 1e6) / 1e6)));

const QUARTER = Math.PI / 2;
const DIAGONAL = Math.PI / 4;
const box = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

// ---- 1. outline: corners for solids, translated points for linears ----
{
  const corners = outline({ type: "rectangle", x: 10, y: 20, width: 30, height: 40 });
  check(
    "rectangle outlines its four corners clockwise from top-left",
    pointsNear(corners, [
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]),
    show(corners),
  );

  // a drag up-and-left leaves negative extents behind; the outline is the same box
  check(
    "negative width and height outline the same box",
    pointsNear(outline({ type: "rectangle", x: 10, y: 20, width: -30, height: -40 }), [
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]),
  );

  // 40x20 at the origin, turned a quarter turn about its centre (20,10):
  // (0,0)→(30,-10), (40,0)→(30,30), (40,20)→(10,30), (0,20)→(10,-10)
  const turned = outline({ type: "rectangle", x: 0, y: 0, width: 40, height: 20, angle: QUARTER });
  check(
    "a quarter turn rotates the corners about the box centre",
    pointsNear(turned, [
      [30, -10],
      [30, 30],
      [10, 30],
      [10, -10],
    ], 1e-12),
    show(turned),
  );

  check(
    "an arrow outlines its points in absolute coordinates",
    pointsNear(outline({ type: "arrow", x: 5, y: 7, points: [[0, 0], [10, 0], [10, 10]] }), [
      [5, 7],
      [15, 7],
      [15, 17],
    ]),
  );

  // a linear element turns about the centre of its point cloud, not its origin:
  // a 10px horizontal arrow at the origin becomes a 10px vertical one about (5,0)
  const turnedArrow = outline({ type: "arrow", x: 0, y: 0, points: [[0, 0], [10, 0]], angle: QUARTER });
  check(
    "a rotated arrow turns about its point cloud's centre",
    pointsNear(turnedArrow, [
      [5, -5],
      [5, 5],
    ], 1e-12),
    show(turnedArrow),
  );
}

// ---- 2. bounds: the axis-aligned box, rotation honoured ----
{
  const b = bounds({ type: "rectangle", x: 10, y: 20, width: 30, height: 40 });
  check(
    "an unrotated rectangle bounds its own extents",
    near(b.x1, 10) && near(b.y1, 20) && near(b.x2, 40) && near(b.y2, 60),
    JSON.stringify(b),
  );

  // a 100px square turned 45° about (50,50) reaches its diagonal half-length,
  // 50*sqrt(2) = 70.7107, in every direction — the box grows, the ink does not
  const r = bounds({ type: "rectangle", x: 0, y: 0, width: 100, height: 100, angle: DIAGONAL });
  const half = 50 * Math.SQRT2;
  check(
    "a square turned 45 degrees bounds its diagonal",
    near(r.x1, 50 - half, 1e-9) && near(r.x2, 50 + half, 1e-9) && near(r.y1, 50 - half, 1e-9) && near(r.y2, 50 + half, 1e-9),
    JSON.stringify(r),
  );

  const lb = bounds({ type: "line", x: 100, y: 100, points: [[0, 0], [-20, 40], [30, 10]] });
  check(
    "a line bounds the extremes of its points",
    near(lb.x1, 80) && near(lb.y1, 100) && near(lb.x2, 130) && near(lb.y2, 140),
    JSON.stringify(lb),
  );
}

// ---- 3. outlinesOverlap: separating axis on the outline quads ----
{
  const a = { type: "rectangle", x: 0, y: 0, width: 100, height: 100 };
  check("disjoint rectangles do not overlap", outlinesOverlap(a, { type: "rectangle", x: 200, y: 0, width: 50, height: 50 }) === false);
  check("intersecting rectangles overlap", outlinesOverlap(a, { type: "rectangle", x: 90, y: 90, width: 50, height: 50 }) === true);
  // frames sit edge to edge in a band; touching is the intended layout, not a defect
  check("rectangles sharing an edge do not overlap", outlinesOverlap(a, { type: "rectangle", x: 100, y: 0, width: 50, height: 100 }) === false);

  // the case a box test gets wrong: a 100px square turned 45° centred at
  // (165,165) is a diamond whose nearest vertex is (94.29,165) — its *box*
  // reaches back to x=94.29,y=94.29 and so overlaps `a`, while its ink stays
  // 59px clear (|100-165|+|100-165| = 130 > 70.71)
  const diamondish = { type: "rectangle", x: 115, y: 115, width: 100, height: 100, angle: DIAGONAL };
  check(
    "the rotated square's box does overlap (the witness)",
    gap(bounds(a), bounds(diamondish)) === 0,
    JSON.stringify(bounds(diamondish)),
  );
  check("a rotated square clear of a rectangle does not overlap it", outlinesOverlap(a, diamondish) === false);

  // documented simplification: a polyline is not convex, so linears fall back to
  // their box — a diagonal arrow "overlaps" a rectangle its path misses
  const diagonal = { type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 100]] };
  check(
    "a linear element is judged on its bounding box",
    outlinesOverlap(diagonal, { type: "rectangle", x: 60, y: 0, width: 20, height: 20 }) === true,
  );
}

// ---- 4. outlineContains: ink inside ink, with slack ----
{
  const frame = { type: "frame", x: 0, y: 0, width: 100, height: 100 };
  check("a rectangle well inside a frame is contained", outlineContains(frame, { type: "rectangle", x: 10, y: 10, width: 50, height: 50 }) === true);
  check("a rectangle poking out of a frame is not contained", outlineContains(frame, { type: "rectangle", x: 80, y: 10, width: 50, height: 50 }) === false);

  // 120x40 ellipse centred in the frame at 45°: its rotated *box* corners reach
  // 0.7071*(60+20) = 56.57px from the centre and escape, while its ink reaches
  // only 0.7071*hypot(60,20) = 44.72px. Judged on the box this reports an escape
  // the render never shows.
  const ellipse = { type: "ellipse", x: -10, y: 30, width: 120, height: 40, angle: DIAGONAL };
  const eb = bounds(ellipse);
  check("the rotated ellipse's box does escape (the witness)", eb.y2 > 100 && eb.x2 > 100, JSON.stringify(eb));
  check("a rotated ellipse whose ink fits is contained", outlineContains(frame, ellipse) === true);

  // the same box, as a rectangle, really is out: its corners are ink
  check("the same rotated box as a rectangle is not contained", outlineContains(frame, { ...ellipse, type: "rectangle" }) === false);

  // pad is the slack: 0.3px of overhang is inside the default tolerance and
  // outside a zero one
  const grazing = { type: "rectangle", x: 10, y: 10, width: 90.3, height: 10 };
  check("a 0.3px overhang is within the default pad", outlineContains(frame, grazing) === true);
  check("a 0.3px overhang fails a zero pad", outlineContains(frame, grazing, 0) === false);
}

// ---- 4b. clearance: how far inside the outer's ink the inner stops ----
{
  const frame = { type: "frame", x: 0, y: 0, width: 100, height: 100 };
  check("clearance is the distance to the nearest edge",
    near(clearance(frame, { type: "rectangle", x: 10, y: 20, width: 50, height: 50 }), 10),
    String(clearance(frame, { type: "rectangle", x: 10, y: 20, width: 50, height: 50 })));
  check("an element flush with an edge has zero clearance",
    near(clearance(frame, { type: "rectangle", x: 0, y: 20, width: 50, height: 50 }), 0));
  check("an escaping element has negative clearance — the overhang",
    near(clearance(frame, { type: "rectangle", x: 80, y: 10, width: 50, height: 50 }), -30));

  // ink, not box: the same rotated ellipse whose corners escape stops 50 - 44.72
  // = 5.28px inside the frame's edge
  check("clearance is measured on ink, like outlineContains",
    near(clearance(frame, { type: "ellipse", x: -10, y: 30, width: 120, height: 40, angle: DIAGONAL }),
      50 - Math.SQRT1_2 * Math.hypot(60, 20), 1e-9));

  // outlineContains is this same number against its slack, so the two can never
  // disagree about where the edge is
  const cases = [
    { type: "rectangle", x: 10, y: 10, width: 50, height: 50 },
    { type: "rectangle", x: 80, y: 10, width: 50, height: 50 },
    { type: "rectangle", x: 10, y: 10, width: 90.3, height: 10 },
  ];
  for (const pad of [0, 0.5, 4]) {
    check(`clearance agrees with outlineContains at pad ${pad}`,
      cases.every((e) => outlineContains(frame, e, pad) === (clearance(frame, e) >= -pad)),
      JSON.stringify(cases.map((e) => clearance(frame, e))));
  }
}

// ---- 5. gap: shortest distance between two boxes ----
{
  check("a horizontal gap is the x distance", near(gap(box(0, 0, 10, 10), box(20, 0, 30, 10)), 10));
  check("a diagonal gap is the hypotenuse", near(gap(box(0, 0, 10, 10), box(20, 20, 30, 30)), Math.hypot(10, 10)));
  check("overlapping boxes have no gap", gap(box(0, 0, 10, 10), box(5, 5, 30, 30)) === 0);
  check("touching boxes have no gap", gap(box(0, 0, 10, 10), box(10, 0, 30, 10)) === 0);

  // the stray rule measures gaps between `bounds()` output, so rotation shrinks
  // them: two 100px squares 120px apart close to 220 - 100*sqrt(2) = 78.579
  // once both are turned 45° and their boxes swell to the diagonal
  const a = { type: "rectangle", x: 0, y: 0, width: 100, height: 100 };
  const b = { type: "rectangle", x: 220, y: 0, width: 100, height: 100 };
  check("upright boxes are 120px apart", near(gap(bounds(a), bounds(b)), 120));
  check(
    "turning both 45 degrees closes the gap to their diagonals",
    near(gap(bounds({ ...a, angle: DIAGONAL }), bounds({ ...b, angle: DIAGONAL })), 220 - 100 * Math.SQRT2, 1e-9),
    String(gap(bounds({ ...a, angle: DIAGONAL }), bounds({ ...b, angle: DIAGONAL }))),
  );
}

// ---- 6. shapeDepth: how deep a point sits in the ink ----
{
  const rect = { type: "rectangle", x: 0, y: 0, width: 100, height: 40 };
  check("a rectangle's centre is half its short side deep", near(shapeDepth(rect, [50, 20]), 20));
  check("a point outside a rectangle is negative", near(shapeDepth(rect, [110, 20]), -10));

  const ellipse = { type: "ellipse", x: 0, y: 0, width: 100, height: 40 };
  check("an ellipse's centre is its short semi-axis deep", near(shapeDepth(ellipse, [50, 20]), 20));
  check("a point on the ellipse is exactly on the edge", near(shapeDepth(ellipse, [100, 20]), 0));

  // a diamond is modelled by the ellipse inscribed in its box — generous near
  // the vertices, and the same model outlineContains uses. At (75,25) the
  // normalised radius is hypot(25/50, 5/20) = 0.559017, so the depth is
  // (1 - 0.559017) * 20 = 8.819660.
  const inscribed = (1 - Math.hypot(0.5, 0.25)) * 20;
  check("an off-centre ellipse point is its scaled radius deep", near(shapeDepth(ellipse, [75, 25]), inscribed, 1e-12), String(shapeDepth(ellipse, [75, 25])));
  check("a diamond is scored as its inscribed ellipse", near(shapeDepth({ ...ellipse, type: "diamond" }, [75, 25]), inscribed, 1e-12));

  // the rotated case: (50,65) is 25px below an unrotated 100x40 rectangle, but
  // 5px inside the same rectangle turned a quarter turn about its centre (50,20)
  const turned = { ...rect, angle: QUARTER };
  check("a point below the box is outside the unrotated rectangle", near(shapeDepth(rect, [50, 65]), -25));
  check("the same point is 5px inside the rotated rectangle", near(shapeDepth(turned, [50, 65]), 5, 1e-9));
}

// ---- 7. segmentLengthInsideShape: how much of a segment the ink swallows ----
{
  const rect = { type: "rectangle", x: 0, y: 0, width: 100, height: 40 };
  const across = segmentLengthInsideShape(rect, [-50, 20], [150, 20]);
  check("a segment crossing a rectangle counts its width less the inset", near(across, 98), String(across));
  check("inset 0 counts the full width", near(segmentLengthInsideShape(rect, [-50, 20], [150, 20], 0), 100));
  check("a segment that misses the shape counts nothing", segmentLengthInsideShape(rect, [-50, 100], [150, 100]) === 0);

  const ellipse = { type: "ellipse", x: 0, y: 0, width: 100, height: 40 };
  const chord = segmentLengthInsideShape(ellipse, [-50, 20], [150, 20]);
  check("a segment through an ellipse's centre counts its inset major axis", near(chord, 98, 1e-9), String(chord));
  // grazing the top of the ellipse is inside the box and outside the ink
  check("a segment grazing an ellipse's box corner counts nothing", segmentLengthInsideShape(ellipse, [0, 0], [10, 0]) === 0);

  // the rotated case: a vertical segment through the centre crosses 38px of the
  // unrotated 100x40 rectangle and 98px of the same rectangle turned upright
  const down = segmentLengthInsideShape(rect, [50, -100], [50, 100]);
  const downTurned = segmentLengthInsideShape({ ...rect, angle: QUARTER }, [50, -100], [50, 100]);
  check("a vertical segment crosses the unrotated rectangle's height", near(down, 38), String(down));
  check("the same segment crosses the rotated rectangle's length", near(downTurned, 98, 1e-9), String(downTurned));

  // a shape thinner than twice the inset has no interior left to cross
  check("a shape thinner than the inset swallows nothing", segmentLengthInsideShape({ type: "rectangle", x: 0, y: 0, width: 2, height: 40 }, [-10, 20], [10, 20]) === 0);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\ngeometry primitives hold under rotation");
process.exit(fail.length ? 1 : 0);
