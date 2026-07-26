#!/usr/bin/env node
/**
 * Render an .excalidraw file: one SVG for the whole canvas, plus one PNG per
 * frame for visual inspection.
 *
 * Usage:
 *   node tools/render.js diagram.excalidraw [--out DIR] [--scale 2] [--no-frames]
 *
 * The per-frame PNGs are the point: a wide multi-frame diagram is unreadable as
 * a single image, and frame-by-frame is how layout defects actually get caught.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, dirname, extname } from "node:path";
import { withExcalidraw } from "./browser.js";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("usage: render.js <file.excalidraw> [--out DIR] [--scale N] [--no-frames]");
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const outDir = flag("out", dirname(input));
const scale = Number(flag("scale", 2));
const doFrames = !args.includes("--no-frames");
const stem = basename(input, extname(input));

const data = JSON.parse(readFileSync(input, "utf8"));
if (!Array.isArray(data.elements) || data.elements.length === 0) {
  console.error(`ERROR: ${input} has no elements`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

await withExcalidraw(async (ex) => {
  const restored = await ex.restore(data);
  const elements = restored.elements;
  const appState = { viewBackgroundColor: data.appState?.viewBackgroundColor ?? "#ffffff" };
  const files = data.files ?? {};

  const whole = await ex.exportSvg({ elements, appState, files });
  const svgPath = join(outDir, `${stem}.svg`);
  writeFileSync(svgPath, whole.svg);
  console.log(`${svgPath}  ${whole.width}x${whole.height}`);

  if (!doFrames) return;

  const frames = elements.filter((e) => e.type === "frame" && !e.isDeleted);
  for (const [i, frame] of frames.entries()) {
    const out = await ex.exportSvg({
      elements,
      appState,
      files,
      exportingFrame: frame,
    });
    const png = join(outDir, `${stem}-frame${String(i + 1).padStart(2, "0")}.png`);
    await ex.svgToPng(out.svg, png);
    console.log(`${png}  ${out.width}x${out.height}  ${frame.name ?? "(unnamed)"}`);
  }
  if (frames.length === 0) {
    const png = join(outDir, `${stem}.png`);
    await ex.svgToPng(whole.svg, png);
    console.log(`${png}  (no frames — whole canvas)`);
  }
}, { scale });
