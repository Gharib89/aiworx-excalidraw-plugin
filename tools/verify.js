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
import { bounds, outline, overlap, contains, gap, shapeDepth, segmentLengthInsideShape } from "./geometry.js";
import { contrast, normalizeHex } from "./color.js";

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
 */
export function verifyDocument(data) {
  const problems = [];
  const note = (msg) => problems.push(msg);

  // A null or primitive in the elements array — what a hand edit or a bad merge
  // leaves behind — has no type, id or geometry, and would take every rule below
  // down with it. Name it and drop it, so the rest of the document still gets checked.
  const wellFormed = data.elements.filter((e, i) => {
    if (e && typeof e === "object" && !Array.isArray(e)) return true;
    note(`element at index ${i} is not an element object (${JSON.stringify(e) ?? typeof e})`);
    return false;
  });
  const els = wellFormed.filter((e) => !e.isDeleted);
  const frames = els.filter((e) => e.type === "frame");
  const others = els.filter((e) => e.type !== "frame");
  const byId = new Map(els.map((e) => [e.id, e]));

  const texts = others.filter((e) => e.type === "text");

  // 1. every element must be renderable: known type, finite and non-empty geometry
  const nonFinite = new Set();
  for (const e of els) {
    if (!KNOWN.has(e.type)) note(`unknown element type ${JSON.stringify(e.type)} (${e.id})`);
    const nums = [e.x, e.y, e.width ?? 0, e.height ?? 0, e.angle ?? 0, ...(Array.isArray(e.points) ? e.points.flat() : [])];
    if (!nums.every(Number.isFinite)) {
      note(`${e.type} ${e.id} has non-finite geometry`);
      nonFinite.add(e.id);
      continue;
    }
    if (LINEAR.has(e.type)) {
      const b = bounds(e);
      if (!Array.isArray(e.points) || e.points.length < 2 || (b.x2 - b.x1 < 0.5 && b.y2 - b.y1 < 0.5)) {
        note(`${e.type} ${e.id} is degenerate (zero length)`);
      }
    } else if (!((e.width ?? 0) > 0) || !((e.height ?? 0) > 0)) {
      note(`${e.type} ${e.id} is degenerate (zero size: ${round(e.width)}x${round(e.height)})`);
    }
  }

  // 2. duplicate ids — silently drops elements on import
  const seen = new Set();
  for (const e of els) {
    if (seen.has(e.id)) note(`duplicate id ${e.id} (${e.type})`);
    seen.add(e.id);
  }

  // 3. frames must not overlap: a band reads left to right, and overlapping frames
  //    make exportingFrame pick up a neighbour's elements
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (overlap(bounds(frames[i]), bounds(frames[j]))) {
        note(`frames overlap: "${frames[i].name ?? frames[i].id}" and "${frames[j].name ?? frames[j].id}"`);
      }
    }
  }

  // 4. bound text must fit its container, or it renders clipped
  for (const t of texts.filter((e) => e.containerId)) {
    const c = byId.get(t.containerId);
    if (!c) {
      note(`text "${preview(t.text)}" references missing container ${t.containerId}`);
      continue;
    }
    // A shape clips the text inside it; a line does not. An arrow's label is
    // centred on the path and drawn over whatever is behind it, so a label wider
    // than a short arrow is how labelled edges render, not a defect.
    if (LINEAR.has(c.type)) continue;
    if (t.width > (c.width ?? 0) + 1 || t.height > (c.height ?? 0) + 1) {
      note(
        `text overflows container: "${preview(t.text)}" ${round(t.width)}x${round(t.height)} in ${round(c.width)}x${round(c.height)} (${c.type} ${c.id})`,
      );
    }
  }

  // 5. every element bound to a frame must sit inside it
  for (const e of others.filter((e) => e.frameId)) {
    const f = byId.get(e.frameId);
    if (!f) {
      note(`element ${e.id} (${e.type}) references missing frame ${e.frameId}`);
      continue;
    }
    if (!contains(bounds(f), bounds(e))) {
      const b = bounds(e);
      const fb = bounds(f);
      note(
        `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} escapes frame "${f.name ?? f.id}": element ${round(b.x1)},${round(b.y1)}–${round(b.x2)},${round(b.y2)} vs frame ${round(fb.x1)},${round(fb.y1)}–${round(fb.x2)},${round(fb.y2)}`,
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
      const host = frames.find((f) => overlap(bounds(f), bounds(e)));
      if (host) {
        note(
          `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} sits over frame "${host.name ?? host.id}" without being bound to it`,
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
      if (id && !byId.get(id)) note(`arrow ${a.id} ${end} points at missing element ${id}`);
    }
  }

  // 8. free texts sitting on each other render as one unreadable smear
  const freeTexts = texts.filter((e) => !e.containerId);
  for (let i = 0; i < freeTexts.length; i++) {
    for (let j = i + 1; j < freeTexts.length; j++) {
      if (overlap(bounds(freeTexts[i]), bounds(freeTexts[j]))) {
        note(`free texts overlap: "${preview(freeTexts[i].text)}" and "${preview(freeTexts[j].text)}"`);
      }
    }
  }

  // 9. an arrow segment passing clean through a shape it isn't bound to reads as
  //    a connection that doesn't exist. A segment merely starting or ending inside
  //    a shape is binding hygiene, not a crossing, so both endpoints must be outside.
  for (const a of arrows) {
    const pts = outline(a);
    const related = new Set([a.startBinding?.elementId, a.endBinding?.elementId]);
    for (const s of others.filter((e) => SOLID.has(e.type) && !related.has(e.id) && !nonFinite.has(e.id))) {
      const crossed = pts.some(
        (p, i) =>
          i + 1 < pts.length &&
          shapeDepth(s, p) <= 0 &&
          shapeDepth(s, pts[i + 1]) <= 0 &&
          segmentLengthInsideShape(s, p, pts[i + 1]) > 2,
      );
      if (crossed) note(`arrow ${a.id} crosses ${s.type} ${s.id} it is not bound to`);
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
        note(`arrow ${a.id} ${end === "endBinding" ? "head" : "tail"} lands inside its target ${t.type} ${t.id} (${round(depth)}px deep)`);
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
    placeable.forEach((e, i) => {
      const nearest = Math.min(...boxes.map((b, j) => (i === j ? Infinity : gap(boxes[i], b))));
      if (Number.isFinite(nearest) && nearest > STRAY_GAP) {
        note(`${e.type} ${e.id} is an off-canvas stray (${round(nearest)}px from anything else)`);
      }
    });
  }

  // 12. text must clear WCAG contrast against the fill it sits on: the
  //     container's fill for bound text, the topmost solid shape under a free
  //     text's centre, the canvas otherwise. Hachure and cross-hatch fills are
  //     mostly canvas behind the glyphs, so only solid fills count as the ground.
  //     An image is a ground no ratio can measure — its pixels are unknown — so
  //     text over one is flagged instead of scored against whatever lies below.
  const canvas = normalizeHex(data.appState?.viewBackgroundColor) ?? palette.canvas;
  const fillOf = (s) => ((s?.fillStyle ?? "solid") === "solid" ? normalizeHex(s?.backgroundColor) : null);
  for (const t of texts) {
    const ink = normalizeHex(t.strokeColor) ?? palette.ink;
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
      note(`text "${preview(t.text)}" sits over image ${ground.id}: contrast against image pixels is unknowable`);
      continue;
    }
    const bg = fillOf(ground) ?? canvas;
    // WCAG: body text needs 4.5:1, large text (>= 24px) needs 3:1
    const needs = (t.fontSize ?? 20) >= 24 ? 3 : 4.5;
    const c = contrast(ink, bg);
    if (c < needs) {
      note(`text "${preview(t.text)}" contrast ${c.toFixed(2)}:1 (${ink} on ${bg}, needs ${needs}:1)`);
    }
  }

  // 13. fonts outside the house pair substitute per machine and reflow the layout
  const HOUSE = new Set([palette.fontFamily.prose, palette.fontFamily.code]);
  for (const t of texts) {
    if (!HOUSE.has(t.fontFamily)) {
      note(
        `text "${preview(t.text)}" uses fontFamily ${t.fontFamily ?? "unset"} outside the house pair (prose ${palette.fontFamily.prose}, code ${palette.fontFamily.code})`,
      );
    }
  }

  // 14. an image whose bytes aren't in the files dictionary renders as an empty box
  const files = data.files ?? {};
  for (const e of others.filter((e) => e.type === "image")) {
    if (!e.fileId || !files[e.fileId]?.dataURL) {
      note(`image ${e.id} references bytes missing from the files dictionary (fileId ${e.fileId ?? "unset"})`);
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

function preview(s) {
  return String(s ?? "").split("\n")[0].slice(0, 40);
}
function round(n) {
  return Math.round(Number(n ?? 0));
}
