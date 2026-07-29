/**
 * Authoring helpers. A generator script describes what it wants; this module
 * measures, converts, verifies, and writes the artifacts. The geometry gate
 * (tools/verify.js) runs in-process before anything touches disk — a generator
 * cannot produce a file the gate would reject.
 *
 *   import { authorDiagram } from "<plugin>/tools/author.js";
 *
 *   await authorDiagram({
 *     out: "docs/diagrams/thing.excalidraw",
 *     build: async ({ measure, wrap, palette, PROSE, CODE, stack, row, column, box, arrowBetween }) =>
 *       [ ...skeleton or layout groups ],
 *   });
 *
 * A human-edited file re-enters the pipeline through reviseDiagram, which
 * round-trips it through the library's restore (refreshed text metrics,
 * repaired bindings) and the same gate.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withExcalidraw } from "./browser.js";
import { bounds, contains } from "./geometry.js";
import { verifyDocument, KNOWN } from "./verify.js";
import { stack, row, column, box, arrowBetween, flatten } from "./layout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const palette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

export const PROSE = palette.fontFamily.prose;
export const CODE = palette.fontFamily.code;

class NamedError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}
/** The build callback returned something that is not a usable skeleton. */
export class SkeletonError extends NamedError {}
/** The built document failed the geometry gate; nothing was written. */
export class GateError extends NamedError {}
/** Text cannot be wrapped to the requested width. */
export class WrapError extends NamedError {}
/** The input file is not a parseable Excalidraw document. */
export class DocumentError extends NamedError {}

/**
 * Wrap text to a pixel width using real measurements.
 *
 * Word widths come from one batch measurement and lines are filled greedily;
 * every line is then re-measured and overfull lines are repaired — the last
 * word moves down, and a word that alone exceeds the width is broken at the
 * widest character boundary that fits. The result never exceeds `maxWidth`.
 */
export function makeWrap(measure) {
  return async function wrap(text, maxWidth, { fontSize = 18, fontFamily = PROSE } = {}) {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
      throw new WrapError(`wrap needs a positive pixel width, got ${maxWidth}`);
    }
    const paragraphs = String(text).split("\n");
    const words = [...new Set(paragraphs.flatMap((p) => p.split(/\s+/)).filter(Boolean))];
    if (words.length === 0) return { text: "", width: 0, height: 0, lines: [] };

    const widthOf = async (strs) => {
      const nonEmpty = strs.filter(Boolean);
      const m = await measure(nonEmpty.map((s) => ({ text: s, fontSize, fontFamily })));
      const byStr = new Map(nonEmpty.map((s, i) => [s, m[i].width]));
      return strs.map((s) => (s ? byStr.get(s) : 0));
    };

    const wordWidths = new Map();
    (await widthOf(words)).forEach((w, i) => wordWidths.set(words[i], w));
    const [aSpaceA, aa] = await widthOf(["a a", "aa"]);
    const space = aSpaceA - aa;

    const lines = [];
    for (const para of paragraphs) {
      let line = [];
      let w = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const ww = wordWidths.get(word) ?? 0;
        const next = line.length ? w + space + ww : ww;
        if (line.length && next > maxWidth) {
          lines.push(line.join(" "));
          line = [word];
          w = ww;
        } else {
          line.push(word);
          w = next;
        }
      }
      lines.push(line.join(" "));
    }

    // The greedy fill worked from summed word widths; the renderer draws whole
    // lines. Re-measure and repair until every line actually fits.
    for (let pass = 0; ; pass++) {
      if (pass > 100) throw new WrapError(`wrap did not converge for width ${maxWidth}px`);
      const measured = await widthOf(lines);
      const i = measured.findIndex((w) => w > maxWidth);
      if (i === -1) break;
      const parts = lines[i].split(" ");
      if (parts.length > 1) {
        lines.splice(i, 1, parts.slice(0, -1).join(" "), parts[parts.length - 1]);
        continue;
      }
      // a single word wider than the requested width: break it mid-word
      const word = parts[0];
      const prefixWidths = await widthOf(
        Array.from({ length: word.length }, (_, n) => word.slice(0, n + 1)),
      );
      if (prefixWidths[0] > maxWidth) {
        throw new WrapError(
          `width ${maxWidth}px cannot fit even one character of "${word}" at ${fontSize}px`,
        );
      }
      let cut = 1;
      while (cut < word.length && prefixWidths[cut] <= maxWidth) cut++;
      lines.splice(i, 1, word.slice(0, cut), word.slice(cut));
    }

    const joined = lines.join("\n");
    const [boxM] = await measure([{ text: joined, fontSize, fontFamily }]);
    return { text: joined, width: boxM.width, height: boxM.height, lines };
  };
}

/**
 * Bind every element that sits inside a frame to that frame.
 *
 * A frame decides membership by frameId, not by geometry: an element merely
 * sitting on top of a frame renders in the wrong per-frame export or disappears
 * from review. Listing every child id by hand is the alternative, and it silently
 * rots as panels gain elements — so infer it from the geometry that is already there.
 */
export function bindToFrames(elements) {
  const frames = elements.filter((e) => e.type === "frame" && !e.isDeleted);
  if (frames.length === 0) return elements;

  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements) {
    if (e.type === "frame" || e.frameId) continue;
    // bound text follows its container, whatever the container's own geometry
    if (e.containerId) {
      const host = byId.get(e.containerId);
      if (host?.frameId) e.frameId = host.frameId;
      continue;
    }
    const b = bounds(e);
    const f = frames.find((fr) => contains(bounds(fr), b));
    if (f) e.frameId = f.id;
  }
  // second pass so bound text picks up a container bound in the first
  for (const e of elements) {
    if (e.containerId && !e.frameId) {
      const host = byId.get(e.containerId);
      if (host?.frameId) e.frameId = host.frameId;
    }
  }
  return elements;
}

/** Reject a skeleton the converter or the gate would choke on, before any browser work. */
function validateSkeleton(built) {
  if (built == null) {
    throw new SkeletonError("build returned nothing — refusing to write an empty diagram");
  }
  if (!Array.isArray(built)) {
    throw new SkeletonError(`build must return an array of elements, got ${typeof built}`);
  }
  const skeleton = flatten(built);
  if (skeleton.length === 0) {
    throw new SkeletonError("build returned an empty skeleton — refusing to write an empty diagram");
  }
  skeleton.forEach((el, i) => {
    if (!el || typeof el !== "object" || Array.isArray(el)) {
      throw new SkeletonError(`skeleton[${i}] is not an element object (${JSON.stringify(el)})`);
    }
    if (!KNOWN.has(el.type)) {
      throw new SkeletonError(
        `skeleton[${i}] has unknown element type ${JSON.stringify(el.type)} — known: ${[...KNOWN].join(", ")}`,
      );
    }
  });
  return skeleton;
}

/** Gate in-process, then write the .excalidraw and its SVG; a gate failure throws before anything is written. */
async function gateAndWrite(ex, { out, elements, appState, files, svg }) {
  const doc = { type: "excalidraw", version: 2, source: "aiworx-excalidraw", elements, appState, files };
  const { problems } = verifyDocument(doc);
  if (problems.length) {
    throw new GateError(
      `refusing to write ${out} — ${problems.length} defect(s):\n  ${problems.join("\n  ")}`,
    );
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  let svgOut = null;
  if (svg) {
    const rendered = await ex.exportSvg({ elements, appState, files });
    svgOut = out.replace(/\.excalidraw$/, "") + ".svg";
    writeFileSync(svgOut, rendered.svg);
  }
  const frames = elements.filter((e) => e.type === "frame");
  console.log(`${out}  ${elements.length} elements, ${frames.length} frames${svgOut ? `\n${svgOut}` : ""}`);
  return { elements, frames, out, svgOut };
}

const buildContext = (ex) => ({
  measure: ex.measureText,
  wrap: makeWrap(ex.measureText),
  palette,
  PROSE,
  CODE,
  stack,
  row,
  column,
  box,
  arrowBetween,
});

/** Build, verify in-process, and write a diagram from a skeleton. */
export async function authorDiagram({ out, build, svg = true, background }) {
  return withExcalidraw(async (ex) => {
    const skeleton = validateSkeleton(await build(buildContext(ex)));
    const elements = bindToFrames(await ex.convert(skeleton));
    const appState = {
      viewBackgroundColor: background ?? palette.canvas,
      gridSize: 20,
    };
    return gateAndWrite(ex, { out, elements, appState, files: {}, svg });
  });
}

/**
 * Round-trip a human-edited file back through the pipeline: restore refreshes
 * text metrics and repairs bindings, frame membership is re-inferred, and the
 * same gate runs before the file is rewritten in place.
 */
export async function reviseDiagram({ file, svg = true }) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new DocumentError(`${file}: cannot read — ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new DocumentError(`${file}: not valid JSON — ${err.message}`);
  }
  if (data?.type !== "excalidraw" || !Array.isArray(data.elements)) {
    throw new DocumentError(`${file}: not an Excalidraw document (type ${JSON.stringify(data?.type)})`);
  }
  return withExcalidraw(async (ex) => {
    const restored = await ex.restore(data);
    const elements = restored.elements.filter((e) => !e.isDeleted);
    // A hand edit that moves an element out of its frame leaves a stale
    // frameId behind; clear membership the geometry no longer supports so
    // bindToFrames can re-infer it. Generated files never get here — the
    // converter only binds what a frame actually contains.
    const byId = new Map(elements.map((e) => [e.id, e]));
    for (const e of elements) {
      if (!e.frameId || e.type === "frame") continue;
      const f = byId.get(e.frameId);
      if (!f || f.type !== "frame" || !contains(bounds(f), bounds(e))) e.frameId = null;
    }
    bindToFrames(elements);
    // the human's appState survives the round-trip; defaults fill only the gaps
    const appState = {
      viewBackgroundColor: palette.canvas,
      gridSize: 20,
      ...data.appState,
    };
    return gateAndWrite(ex, { out: file, elements, appState, files: data.files ?? {}, svg });
  });
}
