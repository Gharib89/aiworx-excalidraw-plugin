#!/usr/bin/env node
/**
 * Contract suite for the render CLI (tools/render.js).
 *
 * Four parts:
 *   1. argument validation — every invalid invocation exits 2 with a named
 *      UsageError, so a typo can never silently degrade output
 *   2. rendering knobs — dark mode, export padding, background override,
 *      single-frame-by-number, and reading-order PNG numbering, proven
 *      against real browser renders
 *   3. --scale is applied exactly once — the SVG stays at natural size and the
 *      raster alone carries the scale
 *   4. every path a success line reports is absolute and names the file that
 *      was written — a relative `--out` run from another cwd says where it
 *      really landed
 *   5. --preset frames an export to a named surface's aspect ratio by growing
 *      the canvas around the picture, never by scaling it — and the canvas it
 *      grows darkens with the picture under --dark
 *
 * Exits non-zero on any mismatch.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, copyFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute, sep } from "node:path";
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
  const foreignJson = join(scratch, "foreign.excalidraw");
  writeFileSync(foreignJson, JSON.stringify({ elements: [{ type: "rectangle" }] }));
  const zeroByteFile = join(scratch, "zero-byte.excalidraw");
  writeFileSync(zeroByteFile, "");

  const REFUSED = [
    { name: "missing input file", args: [join(scratch, "nope.excalidraw")], status: 1, error: "DocumentError", says: "cannot read" },
    { name: "unparseable input", args: [badJson], status: 1, error: "DocumentError", says: "not valid JSON" },
    { name: "element-less input", args: [empty], status: 1, error: "DocumentError", says: "has no elements" },
    { name: "foreign JSON input", args: [foreignJson], status: 1, error: "DocumentError", says: "not an Excalidraw document" },
    { name: "zero-byte input", args: [zeroByteFile], status: 1, error: "DocumentError", says: "empty file" },
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

// ---- 4. every reported path is absolute and names the file written ----
//
// A relative `--out` — and the default, which is the input file's directory —
// resolves against the process cwd, so a run from a scratchpad drops its files
// there while printing a line identical to the run from the repo root. All
// three success lines (whole-canvas SVG, per-frame PNG, frameless PNG) must
// name the resolved path. The scratch cwd is realpath'd: mkdtemp can hand back
// a symlink (/var on macOS) and the child resolves against the real one.
{
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "render-cli-abs-")));
  copyFileSync(orderFixture, join(cwd, "band.excalidraw"));
  // no frames, so the frameless whole-canvas PNG line gets exercised too
  writeFileSync(join(cwd, "plain.excalidraw"), JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [{ id: "only", type: "rectangle", x: 0, y: 0, width: 120, height: 80 }],
    appState: { viewBackgroundColor: "#ffffff" },
  }));

  const at = (...args) =>
    spawnSync(process.execPath, [renderJs, ...args], { encoding: "utf8", cwd });
  // every success line is `<path>  <detail>`; the path is the leading field
  const reported = (stdout) =>
    stdout.trim().split("\n").filter(Boolean).map((l) => l.split("  ")[0]);

  const rel = at("band.excalidraw", "--out", "rel-out", "--scale", "1");
  check("relative --out render exits 0", rel.status === 0, rel.stderr.trim());
  const relPaths = reported(rel.stdout);
  check("relative --out reports the whole-canvas SVG and one line per frame",
    relPaths.length === 4, relPaths.join(", "));
  check("every relative --out path is absolute",
    relPaths.length > 0 && relPaths.every((p) => isAbsolute(p)), relPaths.join(", "));
  // absolute alone could still name somewhere else — the reported path must be
  // the file this run wrote, under the cwd it ran from
  check("every relative --out path names a file under the run's cwd",
    relPaths.every((p) => p.startsWith(join(cwd, "rel-out") + sep) && existsSync(p)),
    relPaths.join(", "));

  const def = at("plain.excalidraw", "--scale", "1");
  check("default --out render exits 0", def.status === 0, def.stderr.trim());
  const defPaths = reported(def.stdout);
  check("the default --out reports the absolute SVG and frameless PNG it wrote",
    defPaths.length === 2 &&
      defPaths[0] === join(cwd, "plain.svg") && defPaths[1] === join(cwd, "plain.png") &&
      defPaths.every((p) => existsSync(p)),
    `${defPaths.join(", ")} | ${def.stdout.trim()}`);

  const absDir = realpathSync(mkdtempSync(join(tmpdir(), "render-cli-abs-out-")));
  const abs = at("band.excalidraw", "--out", absDir, "--no-frames", "--scale", "1");
  check("absolute --out render exits 0", abs.status === 0, abs.stderr.trim());
  const absPaths = reported(abs.stdout);
  check("an absolute --out reports the absolute path it wrote",
    absPaths.length === 1 && absPaths[0] === join(absDir, "band.svg") && existsSync(absPaths[0]),
    absPaths.join(", "));
}

// ---- 5. --preset frames the export to a surface without scaling content ----
{
  const dir = mkdtempSync(join(tmpdir(), "render-cli-preset-"));
  const plain = render(example, "--out", dir, "--no-frames", "--scale", "1");
  check("an unpresetted render still exits 0", plain.status === 0, plain.stderr.trim());
  const before = readFileSync(join(dir, "example.svg"), "utf8");
  const rootAttrs = (svg) => {
    const m = svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"/);
    return m && { viewBox: m[1].split(" ").map(Number), width: Number(m[2]), height: Number(m[3]) };
  };
  const plainRoot = rootAttrs(before);

  const shot = mkdtempSync(join(tmpdir(), "render-cli-preset-16x9-"));
  const framed = render(example, "--out", shot, "--no-frames", "--scale", "1", "--preset", "slide-16x9");
  check("--preset slide-16x9 exits 0", framed.status === 0, framed.stderr.trim());
  const after = readFileSync(join(shot, "example.svg"), "utf8");
  const framedRoot = rootAttrs(after);
  check("the framed export comes out at the preset's aspect ratio",
    framedRoot && Math.abs(framedRoot.width / framedRoot.height - 16 / 9) < 1e-6,
    framedRoot && `${framedRoot.width}x${framedRoot.height}`);
  // framing, never scaling: the picture keeps its own pixels and the canvas
  // grows around it, centred
  check("--preset never shrinks the picture below its natural size",
    framedRoot.width >= plainRoot.width - 1e-6 && framedRoot.height >= plainRoot.height - 1e-6,
    `${framedRoot.width}x${framedRoot.height} vs ${plainRoot.width}x${plainRoot.height}`);
  check("the framed root maps its viewBox one-to-one, so nothing is scaled",
    framedRoot.viewBox[0] === 0 && framedRoot.viewBox[1] === 0 &&
      Math.abs(framedRoot.viewBox[2] - framedRoot.width) < 1e-6 &&
      Math.abs(framedRoot.viewBox[3] - framedRoot.height) < 1e-6,
    framedRoot.viewBox.join(" "));
  // the letterbox is canvas, not transparency: the new root paints it
  const bg = after.match(/^<svg[^>]*><rect x="0" y="0" width="([\d.]+)" height="([\d.]+)" fill="([^"]*)"><\/rect>/);
  check("the framed root paints the whole canvas",
    bg && Number(bg[1]) === framedRoot.width && Number(bg[2]) === framedRoot.height,
    bg ? bg.slice(1).join(", ") : "no background rect matched");
  // the export is nested, not rewritten: Excalidraw's own markup passes through
  // verbatim apart from the x/y that offsets it
  const body = before.slice(before.indexOf(">") + 1);
  const offset = after.match(/<svg x="([-\d.]+)" y="([-\d.]+)" version=/);
  check("--preset passes the original export through untouched, offset to centre",
    after.includes(body) && offset &&
      Math.abs(Number(offset[1]) * 2 - (framedRoot.width - plainRoot.width)) < 1e-3 &&
      Math.abs(Number(offset[2]) * 2 - (framedRoot.height - plainRoot.height)) < 1e-3,
    offset ? offset.slice(1).join(", ") : "no offset inner svg");

  check("--preset fit is the no-op the default is",
    (() => {
      const d = mkdtempSync(join(tmpdir(), "render-cli-preset-fit-"));
      const r = render(example, "--out", d, "--no-frames", "--scale", "1", "--preset", "fit");
      return r.status === 0 && readFileSync(join(d, "example.svg"), "utf8") === before;
    })());

  const bad = render(example, "--out", dir, "--preset", "slide-4x3");
  check("an unknown --preset exits 2 with a UsageError",
    bad.status === 2 && /UsageError/.test(bad.stderr) && /slide-16x9/.test(bad.stderr),
    bad.stderr.trim().split("\n")[0]);

  // the dark theme is a filter on the export's root, so a letterbox painted
  // outside it stays light — a dark picture in a white border
  const dark = mkdtempSync(join(tmpdir(), "render-cli-preset-dark-"));
  const darkRun = render(example, "--out", dark, "--no-frames", "--scale", "1", "--dark", "--preset", "slide-16x9");
  check("--dark --preset exits 0", darkRun.status === 0, darkRun.stderr.trim());
  const darkSvg = readFileSync(join(dark, "example.svg"), "utf8");
  const innerFilter = darkSvg.match(/<svg x="[-\d.]+" y="[-\d.]+"[^>]*filter="([^"]*)"/);
  const outerRect = darkSvg.match(/^<svg[^>]*><rect[^>]*fill="[^"]*"([^>]*)>/);
  check("the dark letterbox carries the export's own filter, so it darkens with the picture",
    innerFilter && outerRect && outerRect[1].includes(`filter="${innerFilter[1]}"`),
    `${innerFilter?.[1]} vs ${outerRect?.[1]}`);
  check("a light --preset render carries no filter at all",
    !/^<svg[^>]*><rect[^>]*filter=/.test(after));

  // frames are exports too, and a slide deck wants each panel at slide shape
  const frames = mkdtempSync(join(tmpdir(), "render-cli-preset-frames-"));
  const withFrames = render(orderFixture, "--out", frames, "--scale", "1", "--preset", "social-og");
  check("--preset reaches the per-frame PNGs", withFrames.status === 0 &&
    readdirSync(frames).some((f) => f.endsWith(".png")), withFrames.stderr.trim());
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nrender CLI behaves");
process.exit(fail.length ? 1 : 0);
