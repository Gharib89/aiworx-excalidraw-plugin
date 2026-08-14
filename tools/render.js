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
 *     [--]                 end of flags: the next argument is the file even if it
 *                          starts with a dash
 *
 * The per-frame PNGs are the point: a wide multi-frame diagram is unreadable as
 * a single image, and frame-by-frame is how layout defects actually get caught.
 * PNGs are numbered in reading order — rows top to bottom, left to right within
 * a row — so frame numbers match the review order, not element-array accidents.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, dirname, extname, resolve } from "node:path";
import { withExcalidraw } from "./browser.js";
import { RENDER_FLAGS, parseFlags } from "./cli-flags.js";
import { NamedError, UsageError, DocumentError } from "./errors.js";

const USAGE =
  "usage: render.js [--out DIR] [--scale N] [--no-frames] [--frame N] [--dark] " +
  "[--padding N] [--background COLOR] [--] <file.excalidraw>";

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
  const stem = basename(input, extname(input));

  let raw;
  try {
    raw = readFileSync(input, "utf8");
  } catch (err) {
    throw new DocumentError(`cannot read — ${err.message}`, {
      where: input, next: "Check that the file exists and is readable.",
    });
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new DocumentError(`not valid JSON — ${err.message}`, {
      where: input, next: "Fix the JSON syntax error.",
    });
  }
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
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

    if (frameNo === undefined) {
      const whole = await ex.exportSvg(base);
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
      const out = await ex.exportSvg({ ...base, exportingFrame: frame });
      const png = join(outDir, `${stem}-frame${String(n).padStart(2, "0")}.png`);
      await ex.svgToPng(out.svg, png);
      console.log(`${png}  ${out.width}x${out.height}  ${frame.name ?? "(unnamed)"}`);
    }
    if (frames.length === 0) {
      const whole = await ex.exportSvg(base);
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
