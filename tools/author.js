/**
 * Authoring helpers. A generator script describes what it wants; this module
 * measures, converts, and writes the artifacts.
 *
 *   import { authorDiagram } from "<plugin>/tools/author.js";
 *
 *   await authorDiagram({
 *     out: "docs/diagrams/thing.excalidraw",
 *     build: async ({ measure, wrap, palette, PROSE, CODE }) => [ ...skeleton ],
 *   });
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withExcalidraw } from "./browser.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const palette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

export const PROSE = palette.fontFamily.prose;
export const CODE = palette.fontFamily.code;

/**
 * Wrap text to a pixel width using real measurements.
 *
 * Word widths come from one batch measurement, lines are filled greedily, then
 * the resulting lines are measured again so the caller sizes cards from the width
 * the renderer will actually produce.
 */
export function makeWrap(measure) {
  return async function wrap(text, maxWidth, { fontSize = 18, fontFamily = PROSE } = {}) {
    const paragraphs = String(text).split("\n");
    const words = [...new Set(paragraphs.flatMap((p) => p.split(/\s+/)).filter(Boolean))];
    if (words.length === 0) return { text: "", width: 0, height: 0, lines: [] };

    const widths = new Map();
    const measured = await measure(words.map((w) => ({ text: w, fontSize, fontFamily })));
    words.forEach((w, i) => widths.set(w, measured[i].width));
    const space = (await measure([{ text: "a a", fontSize, fontFamily }, { text: "aa", fontSize, fontFamily }]))
      .reduce((a, b) => a.width - b.width);

    const lines = [];
    for (const para of paragraphs) {
      let line = [];
      let w = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const ww = widths.get(word) ?? 0;
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

    const joined = lines.join("\n");
    const [box] = await measure([{ text: joined, fontSize, fontFamily }]);
    return { text: joined, width: box.width, height: box.height, lines };
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

  const span = (e) =>
    (e.type === "arrow" || e.type === "line") && Array.isArray(e.points)
      ? {
          x1: Math.min(...e.points.map((p) => e.x + p[0])),
          y1: Math.min(...e.points.map((p) => e.y + p[1])),
          x2: Math.max(...e.points.map((p) => e.x + p[0])),
          y2: Math.max(...e.points.map((p) => e.y + p[1])),
        }
      : { x1: e.x, y1: e.y, x2: e.x + Math.abs(e.width ?? 0), y2: e.y + Math.abs(e.height ?? 0) };

  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements) {
    if (e.type === "frame" || e.frameId) continue;
    // bound text follows its container, whatever the container's own geometry
    if (e.containerId) {
      const host = byId.get(e.containerId);
      if (host?.frameId) e.frameId = host.frameId;
      continue;
    }
    const b = span(e);
    const f = frames.find((fr) => {
      const s = span(fr);
      return b.x1 >= s.x1 - 0.5 && b.y1 >= s.y1 - 0.5 && b.x2 <= s.x2 + 0.5 && b.y2 <= s.y2 + 0.5;
    });
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

/** Build, verify-render and write a diagram from a skeleton. */
export async function authorDiagram({ out, build, svg = true, background }) {
  return withExcalidraw(async (ex) => {
    const wrap = makeWrap(ex.measureText);
    const skeleton = await build({
      measure: ex.measureText,
      wrap,
      palette,
      PROSE,
      CODE,
    });
    const elements = bindToFrames(await ex.convert(skeleton));
    const appState = {
      viewBackgroundColor: background ?? palette.canvas,
      gridSize: 20,
    };
    writeFileSync(
      out,
      JSON.stringify(
        { type: "excalidraw", version: 2, source: "aiworx-excalidraw", elements, appState, files: {} },
        null,
        2,
      ) + "\n",
    );
    let svgOut = null;
    if (svg) {
      const rendered = await ex.exportSvg({ elements, appState });
      svgOut = out.replace(/\.excalidraw$/, "") + ".svg";
      writeFileSync(svgOut, rendered.svg);
    }
    const frames = elements.filter((e) => e.type === "frame");
    console.log(`${out}  ${elements.length} elements, ${frames.length} frames${svgOut ? `\n${svgOut}` : ""}`);
    return { elements, frames, out, svgOut };
  });
}
