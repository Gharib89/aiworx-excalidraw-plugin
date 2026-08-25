#!/usr/bin/env node
/**
 * Render an .excalidraw file: one SVG for the whole canvas, plus one PNG per
 * frame for visual inspection.
 *
 * Usage:
 *   node tools/render.js diagram.excalidraw
 *     [--out DIR] [--scale N] [--no-frames]
 *     [--frame N]          render only frame N (reading order), skip the band
 *     [--dark]             export with Excalidraw's dark theme filter
 *     [--padding N]        export padding in px
 *     [--background COLOR] override the canvas colour (e.g. "#121212", "transparent")
 *     [--preset NAME]      frame every export to a named surface's aspect ratio
 *     [--]                 end of flags: the next argument is the file even if it
 *                          starts with a dash
 *
 * The per-frame PNGs are the point: a wide multi-frame diagram is unreadable as
 * a single image, and frame-by-frame is how layout defects actually get caught.
 * PNGs are numbered in reading order — rows top to bottom, left to right within
 * a row — so frame numbers match the review order, not element-array accidents.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { basename, join, dirname, extname, resolve } from "node:path";
import { withExcalidraw } from "./browser.js";
import { RENDER_FLAGS, parseFlags } from "./cli-flags.js";
import { PRESETS, PRESET_NAMES } from "./presets.js";
import { readExcalidrawDocument } from "./document.js";
import { NamedError, UsageError, DocumentError } from "./errors.js";

const USAGE =
  "usage: render.js [--out DIR] [--scale N] [--no-frames] [--frame N] [--dark] " +
  "[--padding N] [--background COLOR] [--preset NAME] [--] <file.excalidraw>";

const numeric = (name, raw, { min, integer = false } = {}) => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || (min !== undefined && n < min)) {
    throw new UsageError(
      `must be ${integer ? "an integer" : "a number"}${min !== undefined ? ` >= ${min}` : ""}, got "${raw}"`,
      { where: `--${name}`, next: "Pass a valid number." },
    );
  }
  return n;
};

/**
 * Grow an exported SVG's canvas until it matches `surface`'s aspect ratio,
 * leaving every drawn element exactly where it is.
 *
 * Framing, never scaling: a slide wants the picture at slide *shape*, and
 * shrinking it to fit would undo the whole reason a preset raises the type ramp
 * at authoring time. So the shorter axis gains canvas — half at each end, so the
 * picture stays centred.
 *
 * Done by nesting rather than by rewriting: the export becomes an inner `<svg>`
 * offset by `x`/`y` inside a new root that carries the framed size, so the
 * markup Excalidraw produced is passed through untouched and an upstream change
 * to it cannot silently mis-frame anything. The new root paints the canvas
 * colour itself, because a letterbox that exports transparent is one that prints
 * as a hole.
 */
function frameToSurface(svg, { width, height }, surface, background) {
  const aspect = surface.width / surface.height;
  const w = Math.max(width, height * aspect);
  const h = Math.max(height, width / aspect);
  const num = (n) => String(Number(n.toFixed(4)));
  const framed =
    `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w)}" height="${num(h)}">` +
    `<rect x="0" y="0" width="${num(w)}" height="${num(h)}" fill="${background}"></rect>` +
    svg.replace("<svg ", `<svg x="${num((w - width) / 2)}" y="${num((h - height) / 2)}" `) +
    "</svg>";
  return { svg: framed, width: w, height: h };
}

/**
 * Frames in reading order: rows top to bottom, left to right within a row.
 *
 * Not a comparator on purpose — pairwise "same row" (vertical overlap) is not
 * transitive, so sorting with it makes the result depend on element order.
 * Instead frames are swept top-to-bottom into rows, where a frame joins a row
 * when its vertical span overlaps the row's running span.
 */
function readingOrder(frames) {
  const rows = [];
  for (const f of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => f.y < r.y2 && r.y1 < f.y + f.height);
    if (row) {
      row.frames.push(f);
      row.y1 = Math.min(row.y1, f.y);
      row.y2 = Math.max(row.y2, f.y + f.height);
    } else {
      rows.push({ y1: f.y, y2: f.y + f.height, frames: [f] });
    }
  }
  return rows.flatMap((r) => r.frames.sort((a, b) => a.x - b.x));
}

try {
  const { positionals, flags } = parseFlags(process.argv.slice(2), { ...RENDER_FLAGS, usage: USAGE });
  const input = positionals[0];
  if (!input) throw new UsageError("no input file given", { where: "input", next: USAGE });

  // Resolved once, so every path a success line reports is absolute: a relative
  // --out (and the default, the input file's directory) resolves against the
  // process cwd, so a run from a scratchpad writes there — and echoing the path
  // as given made the two runs report the same line. The refusal below still
  // names the directory as given.
  const outGiven = flags.out ?? dirname(input);
  const outDir = resolve(outGiven);
  const scale = numeric("scale", flags.scale, { min: 0.1 }) ?? 2;
  const padding = numeric("padding", flags.padding, { min: 0 });
  const frameNo = numeric("frame", flags.frame, { min: 1, integer: true });
  const doFrames = !flags["no-frames"];
  if (frameNo !== undefined && !doFrames) {
    throw new UsageError("cannot be combined with --no-frames", {
      where: "--frame", next: "Drop one of the two flags.",
    });
  }
  if (flags.background !== undefined && !/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(flags.background)) {
    throw new UsageError(`must be a hex colour or CSS colour name, got "${flags.background}"`, {
      where: "--background", next: "Pass a hex colour like #121212 or a CSS colour name.",
    });
  }
  // Framing only: the file was authored at one surface's type ramp and this
  // cannot change that, so a preset here shapes the export and nothing else.
  // `fit` names no surface, which is why passing it is the same as passing none.
  if (flags.preset !== undefined && !Object.hasOwn(PRESETS, flags.preset)) {
    throw new UsageError(`must name an output preset, got "${flags.preset}"`, {
      where: "--preset", next: `Use one of: ${PRESET_NAMES.join(", ")}.`,
    });
  }
  const surface = flags.preset ? PRESETS[flags.preset].surface : null;
  const stem = basename(input, extname(input));

  const data = readExcalidrawDocument(input);
  if (data.elements.length === 0) {
    throw new DocumentError("has no elements", {
      where: input, next: "Add elements to the document, or point at a different file.",
    });
  }
  const frameCount = data.elements.filter((e) => e.type === "frame" && !e.isDeleted).length;
  if (frameNo !== undefined && frameNo > frameCount) {
    throw new UsageError(`--frame ${frameNo} requested but has ${frameCount} frame(s)`, {
      where: input, next: "Pass a frame number that exists in the file.",
    });
  }

  try {
    mkdirSync(outDir, { recursive: true });
  } catch (err) {
    throw new UsageError(`cannot create output directory — ${err.message}`, {
      where: outGiven, next: "Point --out at a writable directory path.",
    });
  }

  await withExcalidraw(async (ex) => {
    const restored = await ex.restore(data);
    const base = {
      elements: restored.elements,
      appState: {
        viewBackgroundColor: flags.background ?? data.appState?.viewBackgroundColor ?? "#ffffff",
        ...(flags.dark ? { exportWithDarkMode: true } : {}),
      },
      files: data.files ?? {},
      ...(padding !== undefined ? { exportPadding: padding } : {}),
    };

    // every export this run writes goes through the same framing, so a deck
    // rendered at one preset comes out uniform: band, frames and all
    const framed = (out) =>
      surface ? frameToSurface(out.svg, out, surface, base.appState.viewBackgroundColor) : out;

    if (frameNo === undefined) {
      const whole = framed(await ex.exportSvg(base));
      const svgPath = join(outDir, `${stem}.svg`);
      writeFileSync(svgPath, whole.svg);
      console.log(`${svgPath}  ${whole.width}x${whole.height}`);
      if (!doFrames) return;
    }

    const frames = readingOrder(
      base.elements.filter((e) => e.type === "frame" && !e.isDeleted),
    );
    const targets = frames
      .map((frame, i) => ({ frame, n: i + 1 }))
      .filter(({ n }) => frameNo === undefined || n === frameNo);
    for (const { frame, n } of targets) {
      const out = framed(await ex.exportSvg({ ...base, exportingFrame: frame }));
      const png = join(outDir, `${stem}-frame${String(n).padStart(2, "0")}.png`);
      await ex.svgToPng(out.svg, png);
      console.log(`${png}  ${out.width}x${out.height}  ${frame.name ?? "(unnamed)"}`);
    }
    if (frames.length === 0) {
      const whole = framed(await ex.exportSvg(base));
      const png = join(outDir, `${stem}.png`);
      await ex.svgToPng(whole.svg, png);
      console.log(`${png}  (no frames — whole canvas)`);
    }
  }, { scale });
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`UsageError: ${err.message}`);
    process.exit(2);
  }
  // One branch for every named error: the refused document here, and whatever
  // the pipeline beneath raises — a stale bundle, no Chrome, a page failure.
  if (err instanceof NamedError) {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
