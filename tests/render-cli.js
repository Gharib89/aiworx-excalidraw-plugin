#!/usr/bin/env node
/**
 * Contract suite for the render CLI (tools/render.js).
 *
 * Two halves:
 *   1. argument validation — every invalid invocation exits 2 with a named
 *      UsageError, so a typo can never silently degrade output
 *   2. rendering knobs — dark mode, export padding, background override,
 *      single-frame-by-number, and reading-order PNG numbering, proven
 *      against real browser renders
 *
 * Exits non-zero on any mismatch.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const renderJs = join(root, "tools/render.js");
const example = join(root, "examples/example.excalidraw");
const orderFixture = join(root, "tests/fixtures/render-order.excalidraw");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const render = (...args) =>
  spawnSync(process.execPath, [renderJs, ...args], { encoding: "utf8" });

// ---- 1. validation: invalid arguments are rejected with a named error ----

const INVALID = [
  { name: "non-numeric scale", args: [example, "--scale", "abc"] },
  { name: "zero scale", args: [example, "--scale", "0"] },
  { name: "non-numeric padding", args: [example, "--padding", "abc"] },
  { name: "negative padding", args: [example, "--padding", "-5"] },
  { name: "non-integer frame", args: [example, "--frame", "1.5"] },
  { name: "zero frame", args: [example, "--frame", "0"] },
  { name: "out-of-range frame", args: [example, "--frame", "99"] },
  { name: "unknown flag", args: [example, "--bogus"] },
  { name: "missing input", args: [] },
  { name: "contradictory --frame and --no-frames", args: [example, "--frame", "1", "--no-frames"] },
  { name: "malformed background", args: [example, "--background", "12;3456"] },
];

for (const c of INVALID) {
  const r = render(...c.args);
  check(`${c.name}: exits 2`, r.status === 2, `got ${r.status}`);
  check(`${c.name}: names UsageError`, /UsageError/.test(r.stderr),
    r.stderr.trim().split("\n")[0]);
}

// ---- 1b. a refused input is named, never a raw Node stack ----
//
// Argument validation was the only path with a catch; everything the filesystem
// or JSON.parse could throw escaped as an unhandled rejection. These are the
// three that a user actually hits, and each must come back as `Name: message`
// with a stack-free stderr, the way revise.js reports the same conditions.
{
  const scratch = mkdtempSync(join(tmpdir(), "render-cli-refuse-"));
  const badJson = join(scratch, "bad.excalidraw");
  writeFileSync(badJson, "{ not json");
  const occupied = join(scratch, "occupied");
  writeFileSync(occupied, "a file where a directory was asked for");
  const empty = join(scratch, "empty.excalidraw");
  writeFileSync(empty, JSON.stringify({ type: "excalidraw", elements: [], appState: {} }));

  const REFUSED = [
    { name: "missing input file", args: [join(scratch, "nope.excalidraw")], status: 1, error: "DocumentError", says: "cannot read" },
    { name: "unparseable input", args: [badJson], status: 1, error: "DocumentError", says: "not valid JSON" },
    { name: "element-less input", args: [empty], status: 1, error: "DocumentError", says: "has no elements" },
    { name: "--out naming a file", args: [example, "--out", occupied], status: 2, error: "UsageError", says: "output directory" },
  ];
  for (const c of REFUSED) {
    const r = render(...c.args);
    check(`${c.name}: exits ${c.status}`, r.status === c.status, `got ${r.status}`);
    check(`${c.name}: names ${c.error}`, r.stderr.includes(`${c.error}:`) && r.stderr.includes(c.says),
      r.stderr.trim().split("\n")[0]);
    check(`${c.name}: prints no stack trace`, !/^\s+at\s/m.test(r.stderr),
      r.stderr.trim().split("\n").slice(0, 2).join(" | "));
  }
}

// ---- 1c. a single-dash argument is a typo, never a path ----
//
// The parser admitted anything that did not start with `--` as a positional, so
// `-dark` after a real file was collected as a second positional and silently
// dropped — a light-theme render with no diagnostic — while `-dark` before it
// became the file name and came back as "cannot read". check.js closed this in
// #76; this CLI now shares its vocabulary, `--` escape included. Both spellings
// that matter are covered: a bool flag (`-dark`) and a value flag (`-out`).
{
  const scratch = mkdtempSync(join(tmpdir(), "render-cli-dash-"));
  const never = join(scratch, "never-created");

  const DASH = [
    { name: "single-dash flag after the file", args: [example, "-dark", "--out", never], arg: "-dark" },
    { name: "single-dash flag before the file", args: ["-dark", example, "--out", never], arg: "-dark" },
    { name: "single-dash value flag", args: [example, "-out", never], arg: "-out" },
    { name: "bare dash", args: ["-", example, "--out", never], arg: "-" },
  ];
  for (const c of DASH) {
    const r = render(...c.args);
    check(`${c.name}: exits 2`, r.status === 2, `got ${r.status}`);
    check(`${c.name}: names the offending argument`,
      r.stderr.includes(`UsageError: ${c.arg}: unknown flag`),
      r.stderr.trim().split("\n")[0]);
  }
  // the guard fires during parsing, so no output directory is ever created
  check("a rejected argument renders nothing", !existsSync(never));

  // A value flag must not swallow one either. `--out -dark` used to exit 0 having
  // created a directory literally named "-dark" — the same silently-swallowed
  // flag the guard exists to stop, one argument further along. Run from a scratch
  // cwd so a regression pollutes a temp directory rather than the repo.
  const cwd = mkdtempSync(join(tmpdir(), "render-cli-value-"));
  const swallowed = spawnSync(process.execPath, [renderJs, example, "--out", "-dark"],
    { encoding: "utf8", cwd });
  check("a dash-prefixed value is refused: exits 2", swallowed.status === 2, `got ${swallowed.status}`);
  check("a dash-prefixed value is refused: names both the flag and the token",
    /UsageError: --out: needs a value, got -dark/.test(swallowed.stderr),
    swallowed.stderr.trim().split("\n")[0]);
  check("a dash-prefixed value creates no directory", !existsSync(join(cwd, "-dark")));
}

// ---- 1d. `--` still admits a genuinely dash-named file ----
//
// What makes the strict guard above tenable. The child runs from the scratch
// directory so the argument itself begins with a dash — an absolute path never
// would, and the escape would go untested.
{
  const scratch = mkdtempSync(join(tmpdir(), "render-cli-literal-"));
  copyFileSync(example, join(scratch, "-dashed.excalidraw"));
  const r = spawnSync(
    process.execPath,
    [renderJs, "--no-frames", "--scale", "1", "--", "-dashed.excalidraw"],
    { encoding: "utf8", cwd: scratch },
  );
  check("-- admits a dash-named input", r.status === 0, r.stderr.trim().split("\n")[0]);
  check("-- renders the dash-named file", existsSync(join(scratch, "-dashed.svg")), r.stdout.trim());
}

// ---- 2. rendering knobs, against real renders ----

const svgWidth = (path) => {
  const m = readFileSync(path, "utf8").match(/<svg[^>]*\swidth="([\d.]+)"/);
  return m ? Number(m[1]) : NaN;
};
const svgViewBoxWidth = (path) => {
  const m = readFileSync(path, "utf8").match(/<svg[^>]*\sviewBox="0 0 ([\d.]+) [\d.]+"/);
  return m ? Number(m[1]) : NaN;
};
// PNG width lives in the IHDR chunk: bytes 16–19, big-endian
const pngWidth = (path) => readFileSync(path).readUInt32BE(16);

// baseline: no padding, --scale 1 to keep the padding delta in CSS pixels
const outA = mkdtempSync(join(tmpdir(), "render-cli-a-"));
const a = render(example, "--out", outA, "--no-frames", "--scale", "1", "--padding", "0");
check("baseline render exits 0", a.status === 0, a.stderr.trim());
const svgA = join(outA, "example.svg");
check("baseline writes the SVG", existsSync(svgA));

// dark + background + padding in one pass
const outB = mkdtempSync(join(tmpdir(), "render-cli-b-"));
const b = render(example, "--out", outB, "--no-frames", "--scale", "1",
  "--padding", "40", "--dark", "--background", "#123456");
check("knobbed render exits 0", b.status === 0, b.stderr.trim());
const svgB = join(outB, "example.svg");
if (b.status === 0) {
  const svgText = readFileSync(svgB, "utf8");
  check("--dark applies the dark theme filter", /invert\(/.test(svgText));
  check("--background overrides the canvas colour", /123456/i.test(svgText));
  check("--padding 40 widens the export by 80",
    Math.abs(svgWidth(svgB) - svgWidth(svgA) - 80) < 1,
    `${svgWidth(svgA)} → ${svgWidth(svgB)}`);
}

// single frame by number: only that PNG, no band re-render
const outC = mkdtempSync(join(tmpdir(), "render-cli-c-"));
const c = render(orderFixture, "--out", outC, "--frame", "1");
check("--frame render exits 0", c.status === 0, c.stderr.trim());
if (c.status === 0) {
  const files = readdirSync(outC).sort();
  check("--frame 1 writes exactly one PNG",
    files.filter((f) => f.endsWith(".png")).length === 1, files.join(", "));
  check("--frame does not re-render the band SVG",
    !files.includes("render-order.svg"), files.join(", "));
  // frames are listed below-right-left in the file; reading order must win
  check("frame 1 is the top-left frame, not the first in the file",
    files.includes("render-order-frame01.png") && /left/.test(c.stdout),
    c.stdout.trim());
}

// full render: PNG numbering follows reading order — rows top to bottom,
// left to right within a row — not the scrambled element order in the file
const outD = mkdtempSync(join(tmpdir(), "render-cli-d-"));
const d = render(orderFixture, "--out", outD);
check("full render exits 0", d.status === 0, d.stderr.trim());
if (d.status === 0) {
  const order = [...d.stdout.matchAll(/frame\d+\.png.*  (\S+)$/gm)].map((m) => m[1]);
  check("frames are numbered in reading order",
    order.join(",") === "left,right,below", order.join(","));
}

// ---- 3. --scale is applied exactly once ----
// The SVG stays at natural size (width == viewBox) and the raster alone
// carries the scale. Before the fix both carried it: exportScale defaulted to
// devicePixelRatio inside the page, so PNGs came out scale².
const outE = mkdtempSync(join(tmpdir(), "render-cli-e-"));
const e = render(orderFixture, "--out", outE, "--frame", "1", "--scale", "1");
check("scale-1 frame render exits 0", e.status === 0, e.stderr.trim());
if (d.status === 0 && e.status === 0) {
  const svgD = join(outD, "render-order.svg");
  check("SVG width equals viewBox width at the default --scale 2",
    Math.abs(svgWidth(svgD) - svgViewBoxWidth(svgD)) < 0.01,
    `width ${svgWidth(svgD)}, viewBox ${svgViewBoxWidth(svgD)}`);
  const w1 = pngWidth(join(outE, "render-order-frame01.png"));
  const w2 = pngWidth(join(outD, "render-order-frame01.png"));
  check("--scale 2 PNG is 2× the --scale 1 PNG, not 4×",
    Math.abs(w2 - 2 * w1) <= 2, `scale1 ${w1}px, scale2 ${w2}px`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nrender CLI behaves");
process.exit(fail.length ? 1 : 0);
