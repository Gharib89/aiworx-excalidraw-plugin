/**
 * The gate's rule engine, callable in-process. tools/check.js wraps it as a CLI;
 * tools/author.js runs it before writing anything, so a generator cannot produce
 * a file the gate would reject.
 *
 * Catches the defects that are invisible in JSON and tedious to spot by eye —
 * geometry, colour contrast, fonts, file integrity — so eyes are spent on
 * composition instead.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bounds, outline, outlinesOverlap, outlineContains, clearance, gap, shapeDepth, segmentLengthInsideShape } from "./geometry.js";
import { blend, contrast, normalizeHex, toDarkTheme } from "./color.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

const LINEAR = new Set(["arrow", "line", "freedraw"]);
// shapes with area: what an arrow can cross, what a text can sit on
const SOLID = new Set(["rectangle", "ellipse", "diamond", "image"]);
// only what this toolchain authors and renders — anything else is a typo or an import artefact
export const KNOWN = new Set([...LINEAR, ...SOLID, "text", "frame"]);

/**
 * Run every element-level rule over a parsed Excalidraw document.
 * Returns the defects found and the counts the CLI prints as a summary.
 *
 * Each problem is a flat discriminated-union object:
 * `{ code, message, elements, ...per-code fields }`. `code` is a stable
 * kebab-case defect-kind id and the contract machine consumers key on — the
 * registry is append-only: a shipped code is never renamed or reused; splitting
 * a kind mints new codes. `message` is the human prose and carries no contract.
 * `elements` lists the ids involved in a fixed meaningful order per code
 * (defendant first, then the frame/container/target it offends against), and
 * may name an id the document no longer contains — that dangling id is the
 * defect. Code-specific fields sit flat at top level; numbers are rounded as
 * the message prints them.
 *
 * The contrast rule is scored twice per run — once per theme, from the same
 * light colours — because the dark export's filter is not contrast-preserving:
 * a pair can clear 4.5:1 light and fail it dark. Each `low-contrast` problem
 * records the theme it was scored under in its own `theme` field; a pair
 * failing both themes yields two problems. Geometry is theme-independent, so
 * nothing else runs twice.
 */
export function verifyDocument(data) {
  const problems = [];
  const note = (code, message, elements = [], extra = {}) =>
    problems.push({ code, message, elements, ...extra });

  // A null or primitive in the elements array — what a hand edit or a bad merge
  // leaves behind — has no type, id or geometry, and would take every rule below
  // down with it. Name it and drop it, so the rest of the document still gets checked.
  const wellFormed = data.elements.filter((e, i) => {
    if (e && typeof e === "object" && !Array.isArray(e)) return true;
    note("malformed-element", `element at index ${i} is not an element object (${JSON.stringify(e) ?? typeof e})`, [], { index: i });
    return false;
  });
  const els = wellFormed.filter((e) => !e.isDeleted);
  // The rules run over live elements only, so a reference into a tombstone
  // resolves to nothing here. It is still a different defect from a reference
  // into thin air, and the author fixes it differently — undelete versus
  // re-point — so the message names which one it is.
  const tombstoned = new Set(wellFormed.filter((e) => e.isDeleted).map((e) => e.id));
  const fate = (id) => (tombstoned.has(id) ? "deleted" : "missing");
  const frames = els.filter((e) => e.type === "frame");
  const others = els.filter((e) => e.type !== "frame");
  const byId = new Map(els.map((e) => [e.id, e]));

  const texts = others.filter((e) => e.type === "text");

  // 1. every element must be renderable: known type, finite and non-empty geometry
  const nonFinite = new Set();
  for (const e of els) {
    if (!KNOWN.has(e.type)) note("unknown-type", `unknown element type ${JSON.stringify(e.type)} (${e.id})`, [e.id]);
    const nums = [e.x, e.y, e.width ?? 0, e.height ?? 0, e.angle ?? 0, ...(Array.isArray(e.points) ? e.points.flat() : [])];
    if (!nums.every(Number.isFinite)) {
      note("non-finite-geometry", `${e.type} ${e.id} has non-finite geometry`, [e.id]);
      nonFinite.add(e.id);
      continue;
    }
    if (LINEAR.has(e.type)) {
      const b = bounds(e);
      if (!Array.isArray(e.points) || e.points.length < 2 || (b.x2 - b.x1 < 0.5 && b.y2 - b.y1 < 0.5)) {
        note("degenerate", `${e.type} ${e.id} is degenerate (zero length)`, [e.id]);
      }
    } else if (!((e.width ?? 0) > 0) || !((e.height ?? 0) > 0)) {
      note("degenerate", `${e.type} ${e.id} is degenerate (zero size: ${round(e.width)}x${round(e.height)})`, [e.id]);
    }
  }

  // 2. duplicate ids — silently drops elements on import
  const seen = new Set();
  for (const e of els) {
    if (seen.has(e.id)) note("duplicate-id", `duplicate id ${e.id} (${e.type})`, [e.id]);
    seen.add(e.id);
  }

  // 3. frames must not overlap: a band reads left to right, and overlapping frames
  //    make exportingFrame pick up a neighbour's elements
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (outlinesOverlap(frames[i], frames[j])) {
        note("frame-overlap", `frames overlap: "${frames[i].name ?? frames[i].id}" and "${frames[j].name ?? frames[j].id}"`, [frames[i].id, frames[j].id]);
      }
    }
  }

  // 4. bound text must fit its container, or it renders clipped
  for (const t of texts.filter((e) => e.containerId)) {
    const c = byId.get(t.containerId);
    if (!c) {
      note("missing-container", `text "${preview(t.text)}" references ${fate(t.containerId)} container ${t.containerId}`, [t.id, t.containerId]);
      continue;
    }
    // A shape clips the text inside it; a line does not. An arrow's label is
    // centred on the path and drawn over whatever is behind it, so a label wider
    // than a short arrow is how labelled edges render, not a defect.
    if (LINEAR.has(c.type)) continue;
    const fit = boundTextFit(c);
    if (t.width > fit.width + 1 || t.height > fit.height + 1) {
      note(
        "text-overflow",
        `text overflows container: "${preview(t.text)}" ${round(t.width)}x${round(t.height)} exceeds the usable ${round(fit.width)}x${round(fit.height)} of ${c.type} ${c.id} (${round(c.width)}x${round(c.height)})`,
        [t.id, c.id],
      );
    }
  }

  // 5. every element bound to a frame must sit inside it, judged on ink: the
  //    corners of a rotated ellipse's box are empty, so a box test reports it
  //    escaping while the shape still fits. The reported boxes stay the boxes —
  //    for a rotated ellipse the overhang they show is the box's, larger than
  //    the ink's.
  for (const e of others.filter((e) => e.frameId)) {
    const f = byId.get(e.frameId);
    if (!f) {
      note("missing-frame", `element ${e.id} (${e.type}) references ${fate(e.frameId)} frame ${e.frameId}`, [e.id, e.frameId]);
      continue;
    }
    if (!outlineContains(f, e)) {
      const b = bounds(e);
      const fb = bounds(f);
      note(
        "frame-escape",
        `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} escapes frame "${f.name ?? f.id}": element ${round(b.x1)},${round(b.y1)}–${round(b.x2)},${round(b.y2)} vs frame ${round(fb.x1)},${round(fb.y1)}–${round(fb.x2)},${round(fb.y2)}`,
        [e.id, f.id],
        { element: roundBox(b), frame: roundBox(fb) },
      );
      continue;
    }
    // 5b. …and it must stop short of the border, not sit flush against it: a
    //     per-frame export crops exactly at the frame edge (the app zeroes
    //     padding for frame export), so content on the border reads clipped in
    //     the rendered panel. An element that already escapes is reported once,
    //     as an escape. Measured on ink, like containment, so a rotated shape is
    //     judged by what renders. NaN clearance fails the comparison and is left
    //     to the non-finite rule.
    const c = clearance(f, e);
    if (c < FRAME_EDGE_INSET) {
      note(
        "frame-edge-crowding",
        `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} sits ${round(c)}px from the border of frame "${f.name ?? f.id}", inside the ${FRAME_EDGE_INSET}px minimum inset: a frame export crops at the border, so it renders clipped`,
        [e.id, f.id],
        { clearance: round(c), needs: FRAME_EDGE_INSET },
      );
    }
  }

  // 6. an element overlapping a frame it isn't bound to is a defect: per-frame
  //    export decides membership by frameId, so it renders in the wrong panel or
  //    vanishes from review. Elements clear of every frame are fine — titles,
  //    legends and captions legitimately sit outside the band.
  let outsideAll = 0;
  if (frames.length > 0) {
    for (const e of others.filter((e) => !e.frameId && !e.containerId)) {
      const host = frames.find((f) => outlinesOverlap(f, e));
      if (host) {
        note(
          "unbound-over-frame",
          `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} sits over frame "${host.name ?? host.id}" without being bound to it`,
          [e.id, host.id],
        );
      } else {
        outsideAll++;
      }
    }
  }

  // 7. bindings must resolve
  const arrows = others.filter((e) => e.type === "arrow");
  for (const a of arrows) {
    for (const end of ["startBinding", "endBinding"]) {
      const id = a[end]?.elementId;
      if (id && !byId.get(id)) note("dangling-binding", `arrow ${a.id} ${end} points at ${fate(id)} element ${id}`, [a.id, id]);
    }
  }

  // 8. free texts sitting on each other render as one unreadable smear
  const freeTexts = texts.filter((e) => !e.containerId);
  for (let i = 0; i < freeTexts.length; i++) {
    for (let j = i + 1; j < freeTexts.length; j++) {
      if (outlinesOverlap(freeTexts[i], freeTexts[j])) {
        note("free-text-overlap", `free texts overlap: "${preview(freeTexts[i].text)}" and "${preview(freeTexts[j].text)}"`, [freeTexts[i].id, freeTexts[j].id]);
      }
    }
  }

  // 9. an arrow passing clean through a shape it isn't bound to reads as a
  //    connection that doesn't exist. The polyline is walked as contiguous runs
  //    through the shape's ink — a turn at a vertex inside the shape is still the
  //    same pass-through. A run that begins at the arrow's tail or is still open
  //    at its head merely starts or ends inside the shape: binding hygiene, not
  //    a crossing.
  for (const a of arrows) {
    const pts = outline(a);
    const related = new Set([a.startBinding?.elementId, a.endBinding?.elementId]);
    for (const s of others.filter((e) => SOLID.has(e.type) && !related.has(e.id) && !nonFinite.has(e.id))) {
      let run = 0;
      let openAtTail = shapeDepth(s, pts[0]) > 0;
      let crossed = false;
      for (let i = 0; i + 1 < pts.length; i++) {
        run += segmentLengthInsideShape(s, pts[i], pts[i + 1]);
        if (shapeDepth(s, pts[i + 1]) > 0) continue; // still inside: the run goes on
        if (run > 2 && !openAtTail) {
          crossed = true;
          break;
        }
        run = 0;
        openAtTail = false;
      }
      if (crossed) note("arrow-crossing", `arrow ${a.id} crosses ${s.type} ${s.id} it is not bound to`, [a.id, s.id]);
    }
  }

  // 10. a bound arrow's endpoint should stop at its target's edge; buried deeper
  //     it strikes through the target's label. Small targets can't be 8px deep,
  //     so the tolerance shrinks with the target.
  for (const a of arrows) {
    const pts = outline(a);
    for (const [end, point] of [["startBinding", pts[0]], ["endBinding", pts[pts.length - 1]]]) {
      const t = byId.get(a[end]?.elementId);
      if (!t || !point || nonFinite.has(t.id)) continue;
      const depth = shapeDepth(t, point);
      const slack = Math.min(8, Math.min(Math.abs(t.width ?? 0), Math.abs(t.height ?? 0)) / 4);
      if (depth > slack) {
        note(
          "arrow-buried",
          `arrow ${a.id} ${end === "endBinding" ? "head" : "tail"} lands inside its target ${t.type} ${t.id} (${round(depth)}px deep)`,
          [a.id, t.id],
          { depth: round(depth) },
        );
      }
    }
  }

  // 11. an element far from everything else is a coordinate typo: it silently
  //     stretches the export canvas and shrinks the diagram to a corner
  const STRAY_GAP = 1000;
  // one NaN box would silence the rule for every element, so measure finite ones only
  const placeable = els.filter((e) => !nonFinite.has(e.id));
  if (placeable.length > 1) {
    const boxes = placeable.map(bounds);
    // A document of two elements holds exactly one gap, and each end measures it
    // as "the distance to anything else" — so both ends report the same defect.
    // Name it once, at the first element. Deliberately not generalised to any
    // mutually-nearest pair: with a third element present, two elements far from
    // it and from each other are two separate coordinate typos, and suppressing
    // one of them would hide a real stray.
    const oneGap = placeable.length === 2;
    placeable.forEach((e, i) => {
      const nearest = Math.min(...boxes.map((b, j) => (i === j ? Infinity : gap(boxes[i], b))));
      if (Number.isFinite(nearest) && nearest > STRAY_GAP && !(oneGap && i > 0)) {
        note("stray", `${e.type} ${e.id} is an off-canvas stray (${round(nearest)}px from anything else)`, [e.id]);
      }
    });
  }

  // 12. text must clear WCAG contrast against the fill it sits on: the
  //     container's fill for bound text, the topmost solid shape under a free
  //     text's centre, the canvas otherwise. Hachure and cross-hatch fills are
  //     mostly canvas behind the glyphs, so only solid fills count as the ground.
  //     An image is a ground no ratio can measure — its pixels are unknown — so
  //     text over one is flagged instead of scored against whatever lies below.
  //
  //     Colours the rule cannot parse are problems, never silent fallbacks: no
  //     ratio is ever computed against an invented value. "transparent" (and
  //     empty/unset) is legitimate for fills only — the canvas shows through;
  //     transparent ink renders no text at all. Named colours are not resolved:
  //     the palette and Excalidraw's picker emit hex, and toDarkTheme cannot
  //     transform a name anyway.
  //
  //     Opacity composes into the ratio through a single-level backdrop chain —
  //     the same topmost-solid-ground simplification, now opacity-aware:
  //     effectiveGround = blend(groundFill, canvas, ground.opacity) and
  //     effectiveInk = blend(ink, effectiveGround, text.opacity). Blending
  //     happens once in light sRGB and the blended pair is themed afterwards —
  //     the order the render itself applies, the dark filter running over the
  //     final composited pixels. Blend and theme also commute while the
  //     transform stays in gamut (tests/dark.js pins it on in-gamut pairs), so
  //     the shortcut agrees with theming first wherever both are defined.
  //     Both themes are scored on every run.
  const isTransparentish = (c) => c == null || String(c).trim() === "" || String(c).trim().toLowerCase() === "transparent";
  const seenBadColor = new Set(); // one problem per (element, field), however many texts sit on it
  const badColor = (elements, field, value, message) => {
    const key = `${elements.join()}|${field}`;
    if (seenBadColor.has(key)) return;
    seenBadColor.add(key);
    note("unparseable-color", message, elements, { field, value });
  };
  const rawCanvas = data.appState?.viewBackgroundColor;
  let canvas = normalizeHex(rawCanvas);
  if (!canvas) {
    // "transparent" (and unset) canvas keeps the palette fallback silently; anything
    // else is named, then scoring continues against the palette so the rule still runs
    if (!isTransparentish(rawCanvas)) {
      badColor([], "viewBackgroundColor", rawCanvas,
        `appState.viewBackgroundColor ${JSON.stringify(rawCanvas)} is not a hex colour (scored against ${palette.canvas} instead)`);
    }
    canvas = palette.canvas;
  }
  // a solid-style shape's fill: a hex, null when the canvas legitimately shows
  // through, or "invalid" for a value the rule refuses to invent a colour for
  const fillOf = (s) => {
    if ((s?.fillStyle ?? "solid") !== "solid") return null;
    const hex = normalizeHex(s?.backgroundColor);
    if (hex) return hex;
    return isTransparentish(s?.backgroundColor) ? null : "invalid";
  };
  // the browser clamps opacity to 0..1 and treats an invalid value as the
  // initial 1, so a hand-edited "250" or "full" must not extrapolate the blend
  const alpha = (e) => {
    const o = Number(e.opacity ?? 100);
    return Number.isFinite(o) ? Math.min(1, Math.max(0, o / 100)) : 1;
  };
  for (const t of texts) {
    let ground = null; // the element the glyphs sit on; null means bare canvas
    if (t.containerId) {
      ground = byId.get(t.containerId);
    } else {
      const tb = bounds(t);
      const centre = [(tb.x1 + tb.x2) / 2, (tb.y1 + tb.y2) / 2];
      for (const s of others) {
        // later elements render on top, so the last ground under the centre wins
        if (SOLID.has(s.type) && !nonFinite.has(s.id) && shapeDepth(s, centre) > 0 && (s.type === "image" || fillOf(s))) {
          ground = s;
        }
      }
    }
    if (ground?.type === "image") {
      // theme-independent: the pixels are unknowable in either theme
      note("text-over-image", `text "${preview(t.text)}" sits over image ${ground.id}: contrast against image pixels is unknowable`, [t.id, ground.id]);
      continue;
    }
    // unset ink keeps Excalidraw's own default; transparent ink is invisible
    // text, never intended, and any other non-hex is unparseable
    const ink = t.strokeColor == null ? palette.ink : normalizeHex(t.strokeColor);
    if (!ink) {
      badColor([t.id], "strokeColor", t.strokeColor,
        String(t.strokeColor).trim().toLowerCase() === "transparent"
          ? `text "${preview(t.text)}" has transparent strokeColor — it renders invisible`
          : `text "${preview(t.text)}" strokeColor ${JSON.stringify(t.strokeColor)} is not a hex colour`);
    }
    const groundFill = ground ? fillOf(ground) : null;
    if (groundFill === "invalid") {
      badColor([ground.id], "backgroundColor", ground.backgroundColor,
        `${ground.type} ${ground.id} backgroundColor ${JSON.stringify(ground.backgroundColor)} is not a hex colour`);
    }
    if (!ink || groundFill === "invalid") continue; // no ratio against invented colours
    const effGround = groundFill ? blend(groundFill, canvas, alpha(ground)) : canvas;
    const effInk = blend(ink, effGround, alpha(t));
    // WCAG: body text needs 4.5:1, large text (>= 24px) needs 3:1
    const needs = (t.fontSize ?? 20) >= 24 ? 3 : 4.5;
    for (const theme of ["light", "dark"]) {
      const [inkT, bgT] = theme === "dark" ? [toDarkTheme(effInk), toDarkTheme(effGround)] : [effInk, effGround];
      const c = contrast(inkT, bgT);
      if (c < needs) {
        note(
          "low-contrast",
          `text "${preview(t.text)}" contrast ${c.toFixed(2)}:1${theme === "dark" ? " under the dark theme" : ""} (${inkT} on ${bgT}, needs ${needs}:1)`,
          [t.id],
          { ratio: Number(c.toFixed(2)), needs, ink: inkT, bg: bgT, theme },
        );
      }
    }
  }

  // 13. fonts outside the house pair substitute per machine and reflow the layout
  const HOUSE = new Set([palette.fontFamily.prose, palette.fontFamily.code]);
  for (const t of texts) {
    if (!HOUSE.has(t.fontFamily)) {
      note(
        "foreign-font",
        `text "${preview(t.text)}" uses fontFamily ${t.fontFamily ?? "unset"} outside the house pair (prose ${palette.fontFamily.prose}, code ${palette.fontFamily.code})`,
        [t.id],
      );
    }
  }

  // 14. an image whose bytes aren't in the files dictionary renders as an empty box
  const files = data.files ?? {};
  for (const e of others.filter((e) => e.type === "image")) {
    if (!e.fileId || !files[e.fileId]?.dataURL) {
      note("missing-image-bytes", `image ${e.id} references bytes missing from the files dictionary (fileId ${e.fileId ?? "unset"})`, [e.id]);
    }
  }

  return {
    problems,
    stats: {
      elements: els.length,
      frames: frames.length,
      texts: texts.length,
      outsideAll,
    },
  };
}

/**
 * The clearance every framed element must keep from its frame's border.
 *
 * A frame that fits itself around `children` lands its content at 10px, so
 * anything this toolchain authors clears the inset by construction: what the
 * rule catches is a hand-placed frame or a hand edit that leaves content flush
 * with the border. The floor sits below 10 deliberately — a rotated shape whose
 * ink legitimately fills its frame stops a few px inside — so it flags content
 * on the border, not content that is merely snug.
 */
const FRAME_EDGE_INSET = 4;

/**
 * The box the app actually wraps bound text into — Excalidraw's
 * getBoundTextMaxWidth/Height with BOUND_TEXT_PADDING = 5. Smaller than the
 * container's own box: padding all round, and for ellipse and diamond only the
 * inscribed text area holds ink.
 */
const BOUND_TEXT_PADDING = 5;
function boundTextFit(c) {
  const w = c.width ?? 0;
  const h = c.height ?? 0;
  if (c.type === "ellipse") {
    return {
      width: Math.round((w / 2) * Math.SQRT2) - BOUND_TEXT_PADDING * 2,
      height: Math.round((h / 2) * Math.SQRT2) - BOUND_TEXT_PADDING * 2,
    };
  }
  if (c.type === "diamond") {
    return { width: Math.round(w / 2) - BOUND_TEXT_PADDING * 2, height: Math.round(h / 2) - BOUND_TEXT_PADDING * 2 };
  }
  return { width: w - BOUND_TEXT_PADDING * 2, height: h - BOUND_TEXT_PADDING * 2 };
}

function preview(s) {
  return String(s ?? "").split("\n")[0].slice(0, 40);
}
function round(n) {
  return Math.round(Number(n ?? 0));
}
function roundBox(b) {
  return { x1: round(b.x1), y1: round(b.y1), x2: round(b.x2), y2: round(b.y2) };
}
