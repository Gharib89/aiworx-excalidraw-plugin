/**
 * Advisories: how far a diagram sits from the house rules, measured and
 * reported beside the gate's problems and never refused over (ADR-0002).
 * tools/check.js is the one reporting surface; this module is pure so a later
 * consumer (revise.js, the authoring API) can adopt it as an append-only step.
 *
 * Each advisory is `{ code, message, elements, ...fields }` — the problem
 * shape. A **quantity** finding carries the measured value and the bound it
 * was judged against; a **presence** finding names the elements involved and
 * invents neither. A per-panel finding names the frame first in `elements`; a
 * whole-picture finding names none. The thresholds are the exported constants
 * below, quoted by the registry (`reference/problem-codes.md`) and held equal
 * by tests/problem-codes.js.
 *
 * Scope — the frame is the picture. Where a file holds frames, the aspect and
 * hue measurements are taken per frame and never for the file as a whole: a
 * band's row shape is an artifact of panel count, not a design choice.
 * Elements clear of every frame are scored with no picture.
 */
import { bounds, outline, outlineContains, outlinesOverlap, segmentGap, segmentsCross } from "./geometry.js";
import { normalizeHex } from "./color.js";
import { loadBrandPalette } from "./brand.js";
import { PRESETS } from "./presets.js";
import { SOLID, preview } from "./verify.js";

/** The picture's aspect must sit within this band of the preset surface's aspect (as a ratio). */
export const ASPECT_BAND = Object.freeze({ low: 0.75, high: 1.33 });
/** Smallest text a surface is read at, in px. `fit` names no surface and has no floor. */
export const FONT_FLOOR = Object.freeze({ "doc-inline": 13, "doc-wide": 16, "social-og": 24, "slide-16x9": 30 });
/** How far an arrow keeps from anything it is not bound to, in px. */
export const ARROW_CLEARANCE = 10;
/** Most direction changes one arrow may take. */
export const MAX_BENDS = 2;
/** A heading change above this many degrees is a bend; below it is the router's jog. */
export const BEND_ANGLE = 10;
/** Most non-grey hue families one picture may use. */
export const MAX_HUES = 4;
/** Two hues within this many degrees of each other (HSL hue) are one family — a role's stroke and its fill. */
export const HUE_FAMILY_SPAN = 30;
/** HSL chroma (max − min of the RGB channels, 0–1) under which a colour is grey and counts for no hue. */
export const GREY_CHROMA = 0.05;
/** Widest ÷ narrowest frame width a band may hold. */
export const MAX_PANEL_WIDTH_DRIFT = 1.25;

// Loaded on first use, as verify.js does: check.js must survive this module's
// import under an invalid brand override so it can map the refusal itself.
let brandPalette;
const getBrandPalette = () => (brandPalette ??= loadBrandPalette());

/**
 * Measure a parsed Excalidraw document against the house rules.
 * `preset` is the output preset the diagram was authored for; without it, the
 * two surface-relative measurements (`aspect-off-preset`, `font-below-floor`)
 * stay silent, because nothing in a written scene records its preset.
 */
export function adviseDocument(data, { preset } = {}) {
  const advisories = [];
  const note = (code, message, elements = [], extra = {}) => advisories.push({ code, message, elements, ...extra });

  // The same live, well-formed elements the refusing rules read; an element
  // without finite geometry is the gate's `non-finite` defect, not a measurement.
  const els = (Array.isArray(data.elements) ? data.elements : []).filter(
    (e) => e && typeof e === "object" && !Array.isArray(e) && !e.isDeleted && finiteBox(e),
  );
  const byId = new Map(els.map((e) => [e.id, e]));
  const frames = els.filter((e) => e.type === "frame");
  const shapes = els.filter((e) => SOLID.has(e.type));
  const arrows = els.filter((e) => e.type === "arrow" && Array.isArray(e.points) && e.points.length >= 2);
  const texts = els.filter((e) => e.type === "text");
  const surface = PRESETS[preset]?.surface ?? null;

  // Where a file has frames, each frame is a picture and the file has none;
  // otherwise the picture is everything.
  const pictures = frames.length
    ? frames.map((f) => ({ frame: f, members: els.filter((e) => e.frameId === f.id), box: bounds(f) }))
    : [{ frame: null, members: els, box: unionBounds(els) }];
  const where = (p) => (p.frame ? `frame "${p.frame.name ?? p.frame.id}"` : "the picture");
  const named = (p) => (p.frame ? [p.frame.id] : []);

  // 1. two arrows crossing read as a junction that isn't there. Every proper
  //    crossing is reported whatever its angle — the angle is carried, not
  //    judged — between arrows that share no bound endpoint: two arrows fanning
  //    out of one shape touch by construction.
  for (let i = 0; i < arrows.length; i++) {
    for (let j = i + 1; j < arrows.length; j++) {
      const a = arrows[i];
      const b = arrows[j];
      const bound = new Set(bindings(a));
      if (bindings(b).some((id) => bound.has(id))) continue;
      const pa = outline(a);
      const pb = outline(b);
      for (let x = 0; x + 1 < pa.length; x++) {
        for (let y = 0; y + 1 < pb.length; y++) {
          if (!segmentsCross(pa[x], pa[x + 1], pb[y], pb[y + 1])) continue;
          const angle = round(angleBetween(pa[x], pa[x + 1], pb[y], pb[y + 1]), 1);
          note("arrows-cross", `arrows ${a.id} and ${b.id} cross at ${angle}°`, [a.id, b.id], { angle });
        }
      }
    }
  }

  // 2. a picture far from its surface's aspect letterboxes on export — a tall
  //    diagram on a slide reads at a fraction of the room's width.
  if (surface) {
    const needs = surface.width / surface.height;
    for (const p of pictures) {
      const w = p.box.x2 - p.box.x1;
      const h = p.box.y2 - p.box.y1;
      if (!(w > 0 && h > 0)) continue;
      const ratio = w / h / needs;
      if (ratio >= ASPECT_BAND.low && ratio <= ASPECT_BAND.high) continue;
      note(
        "aspect-off-preset",
        `${where(p)} is ${round(w / h, 2)}:1, ${round(ratio, 2)}× the ${preset} surface's ${round(needs, 2)}:1 (needs ${ASPECT_BAND.low}–${ASPECT_BAND.high}×)`,
        named(p),
        { aspect: round(w / h, 2), needs: round(needs, 2), preset },
      );
    }
  }

  // 3. text under the surface's floor is unreadable at the distance that
  //    surface is read from; the ramp clears the floor, hand-set sizes may not.
  const floor = FONT_FLOOR[preset];
  if (floor !== undefined) {
    for (const t of texts) {
      const size = typeof t.fontSize === "number" ? t.fontSize : undefined;
      if (!(size < floor)) continue;
      note(
        "font-below-floor",
        `text "${preview(t.text)}" is ${size}px, under the ${preset} floor of ${floor}px`,
        [t.id],
        { size, needs: floor, preset },
      );
    }
  }

  // 4. an arrow squeezing past something it is not bound to reads as a
  //    connection that isn't there. Only an arrow bound at both ends is
  //    measured — "unrelated" is undecidable without a binding — and it reads
  //    past its own label, its targets' labels, containers and their titles (an
  //    arrow crosses a boundary by design) and plates (backing under a text,
  //    not a node — the text itself is still content, and still measured).
  const containers = new Set(shapes.filter((o) => shapes.some((i) => i !== o && outlineContains(o, i))).map((o) => o.id));
  const plates = new Set(
    shapes
      .filter((s) => s.strokeColor === "transparent" && texts.some((t) => t.containerId === s.id || outlinesOverlap(s, t)))
      .map((s) => s.id),
  );
  for (const a of arrows) {
    const bound = bindings(a);
    if (bound.length < 2) continue;
    const related = new Set(bound);
    const pts = outline(a);
    const candidates = [
      ...shapes.filter((s) => !related.has(s.id) && !containers.has(s.id) && !plates.has(s.id)),
      ...texts.filter((t) => t.containerId !== a.id && !related.has(t.containerId) && !containers.has(t.containerId)),
    ];
    for (const c of candidates) {
      let clear = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) clear = Math.min(clear, segmentGap(c, pts[i], pts[i + 1]));
      if (!(clear < ARROW_CLEARANCE)) continue;
      const px = round(clear, 1);
      note(
        "arrow-crowding",
        `arrow ${a.id} passes ${px}px from ${c.type} ${c.id}${c.text ? ` "${preview(c.text)}"` : ""} it is not bound to (needs ${ARROW_CLEARANCE}px clear)`,
        [a.id, c.id],
        { clearance: px, needs: ARROW_CLEARANCE },
      );
    }
  }

  // 5. an arrow that keeps changing direction is a route the reader has to
  //    follow rather than a connection they can see. A bend is a heading
  //    change above BEND_ANGLE — a router's sub-degree jog is not one.
  for (const a of arrows) {
    const pts = outline(a);
    let bends = 0;
    let heading = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      if (Math.hypot(dx, dy) < 0.5) continue;
      const h = Math.atan2(dy, dx) * (180 / Math.PI);
      if (heading !== null) {
        let turn = Math.abs(h - heading) % 360;
        if (turn > 180) turn = 360 - turn;
        if (turn > BEND_ANGLE) bends++;
      }
      heading = h;
    }
    if (bends > MAX_BENDS) {
      note("too-many-bends", `arrow ${a.id} changes direction ${bends} times (needs at most ${MAX_BENDS})`, [a.id], { bends, needs: MAX_BENDS });
    }
  }

  // 6. arrows as heavy as the shapes they join give the picture no depth:
  //    nothing reads as figure, nothing as ground. Once per arrow, against the
  //    first bound shape it is not thinner than.
  for (const a of arrows) {
    if (typeof a.strokeWidth !== "number") continue;
    for (const id of bindings(a)) {
      const s = byId.get(id);
      if (!s || !SOLID.has(s.type) || typeof s.strokeWidth !== "number" || a.strokeWidth < s.strokeWidth) continue;
      note(
        "flat-stroke-weight",
        `arrow ${a.id} (stroke ${a.strokeWidth}) is not thinner than ${s.type} ${s.id} (stroke ${s.strokeWidth}) it binds to`,
        [a.id, s.id],
        { arrowWidth: a.strokeWidth, shapeWidth: s.strokeWidth },
      );
      break;
    }
  }

  // 7. pass and fail told apart by hue alone is lost on a colour-blind reader
  //    and on a greyscale print; both roles on one picture need a second cue.
  //    A presence finding: the carriers are named, no number is invented.
  const palette = getBrandPalette();
  const roleColours = (role) => new Set([palette.roles[role].stroke, palette.roles[role].fill].map(normalizeHex));
  const passColours = roleColours("pass");
  const failColours = roleColours("fail");
  const carries = (e, set) => set.has(normalizeHex(e.strokeColor)) || set.has(normalizeHex(e.backgroundColor));
  // what carries colour on a picture: not the frame itself, and not a plate
  const inked = (p) => p.members.filter((e) => e.type !== "frame" && !plates.has(e.id));
  for (const p of pictures) {
    const pass = inked(p).filter((e) => carries(e, passColours));
    const fail = inked(p).filter((e) => carries(e, failColours));
    if (!pass.length || !fail.length) continue;
    note(
      "hue-only-pass-fail",
      `${where(p)} tells pass from fail by hue alone: ${pass.length} pass and ${fail.length} fail element(s) with no second cue`,
      [...named(p), ...new Set([...pass, ...fail].map((e) => e.id))],
    );
  }

  // 8. more hue families than a reader can hold as a legend. A family is a hue
  //    angle, not a hex — a role's stroke and its fill are one family — and a
  //    grey is no hue at all.
  for (const p of pictures) {
    const hexes = new Set(inked(p).flatMap((e) => [e.strokeColor, e.backgroundColor]).map(normalizeHex).filter(Boolean));
    const hues = hueFamilies([...hexes]);
    if (hues > MAX_HUES) note("too-many-hues", `${where(p)} uses ${hues} hue families (needs at most ${MAX_HUES})`, named(p), { hues, needs: MAX_HUES });
  }

  // 9. a band's panels are exported frame by frame without scaling, so the
  //    same label projects at different sizes from a wide panel and a narrow
  //    one — the type ramp survives the panel and not the band.
  const sized = frames.filter((f) => f.width > 0).sort((a, b) => b.width - a.width);
  if (sized.length >= 2) {
    const widest = sized[0];
    const narrowest = sized[sized.length - 1];
    const ratio = widest.width / narrowest.width;
    if (ratio > MAX_PANEL_WIDTH_DRIFT) {
      const drift = round(ratio, 2);
      note(
        "panel-width-drift",
        `frame "${widest.name ?? widest.id}" is ${drift}× as wide as frame "${narrowest.name ?? narrowest.id}" (needs within ${MAX_PANEL_WIDTH_DRIFT}×): per-frame export frames without scaling, so one label size projects at two sizes`,
        [widest.id, narrowest.id],
        { drift, needs: MAX_PANEL_WIDTH_DRIFT },
      );
    }
  }

  return advisories;
}

const finiteBox = (e) => ["x", "y", "width", "height"].every((k) => Number.isFinite(e[k]));
const bindings = (a) => [a.startBinding?.elementId, a.endBinding?.elementId].filter(Boolean);
const round = (n, places = 0) => Math.round(n * 10 ** places) / 10 ** places;

function unionBounds(els) {
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const e of els) {
    const b = bounds(e);
    box.x1 = Math.min(box.x1, b.x1);
    box.y1 = Math.min(box.y1, b.y1);
    box.x2 = Math.max(box.x2, b.x2);
    box.y2 = Math.max(box.y2, b.y2);
  }
  return box;
}

/** The acute angle between segments p→q and a→b, in degrees (0–90). */
function angleBetween([px, py], [qx, qy], [ax, ay], [bx, by]) {
  const t = Math.abs(Math.atan2(qy - py, qx - px) - Math.atan2(by - ay, bx - ax)) * (180 / Math.PI);
  const m = t % 180;
  return Math.min(m, 180 - m);
}

/**
 * How many hue families a set of colours spans. Colours are read in HSL: chroma
 * under GREY_CHROMA is grey and dropped; the rest seed families from the most
 * saturated down, and a colour within HUE_FAMILY_SPAN of an existing seed joins
 * it. Seeding by saturation keeps a pale fill from bridging two roles' strokes.
 */
function hueFamilies(hexes) {
  const seeds = [];
  const colours = hexes.map(hueChroma).filter((c) => c.chroma >= GREY_CHROMA).sort((a, b) => b.chroma - a.chroma);
  for (const c of colours) {
    if (!seeds.some((h) => hueGap(h, c.hue) <= HUE_FAMILY_SPAN)) seeds.push(c.hue);
  }
  return seeds.length;
}

/** HSL hue (degrees) and chroma (max − min, 0–1) of a normalized #RRGGBB. */
function hueChroma(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue *= 60;
  }
  return { hue, chroma };
}

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
