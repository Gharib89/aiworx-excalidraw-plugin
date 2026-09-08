#!/usr/bin/env node
/**
 * Every committed band regenerates byte for byte (#227).
 *
 * This is the check three recent briefs asked for and could not have: with the
 * bytes stable, a diff on a band means geometry actually moved, so "did my
 * change reach any picture it should not have?" is answerable from
 * `git status` instead of a throwaway normalising script.
 *
 * Two claims, and the difference between them is the whole design:
 *
 *   1. **Two runs agree.** Each band is generated into two independent
 *      checkouts and the pair compared. This is determinism itself, it holds on
 *      any machine, and every band carries it.
 *   2. **A run matches what is committed.** This also catches the stale
 *      artifact: a generator edited without re-running it. It is a claim about
 *      the machine that made the commit, so it is only as portable as the
 *      measurements underneath it. What made it unportable was a band drawing a
 *      character the vendored fonts carry no glyph for, measured in the
 *      machine's own font; `tests/glyph-coverage.js` now refuses that on every
 *      fast run, so every band carries this claim (#228).
 *
 * The third claim is the one the seed exists for: two independent regenerations
 * render to identical PNGs. `seed` drives Rough.js jitter, so before this change
 * the same geometry rasterised differently every run.
 *
 * Both byte claims extend to a band's committed `<slug>-dark.svg`, which no
 * generator writes: it is `tools/render.js --dark` output, so the suite runs
 * that CLI rather than reaching into `exportSvg`, and the claim stays one a
 * reader can reproduce by hand. A band with no such sibling costs no Chrome
 * time (#233).
 *
 * It regenerates **out of tree** (a temp checkout that symlinks `tools/` and
 * `brand/` and copies `examples/`) for two reasons: CI asserts verification
 * never dirties a tracked file, and a generator writes next to its own script,
 * so copying the script is what moves the write somewhere else without changing
 * the generators' contract. `tests/example-paths.js` is the precedent.
 *
 * `test:browser` only, so this runs on Linux alone. Text measurement settles
 * per platform, so a macOS or Windows leg would hold a Linux-generated commit
 * against its own metrics and fail claim 2 for a reason that has nothing to do
 * with determinism. The junction link below is for the shared helper's sake,
 * not a per-OS claim this suite makes.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bands, linkPluginRoot } from "./lib/examples.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const BANDS = bands(root);

/** A checkout the generators can write into, holding a copy of every band. */
function scratchCheckout(tag) {
  const checkout = linkPluginRoot(root, mkdtempSync(join(tmpdir(), `${tag}-`)));
  cpSync(join(root, "examples"), join(checkout, "examples"), { recursive: true });
  return checkout;
}

const run = (checkout, script, args = []) => spawnSync(process.execPath, [script, ...args], {
  cwd: checkout, encoding: "utf8",
});

const why = (r) => (r.stderr || r.stdout || "").trim().split("\n").slice(-4).join(" / ");

/**
 * Where two artifacts first disagree, with the text either side of the split.
 * A byte count alone says nothing about which value moved, and this suite's
 * whole purpose is answering that from a log rather than a normalising script.
 *
 * The scan walks the buffers, so the offset is the byte the file actually
 * disagrees at; a band drawing ✓ or ✗ would put a UTF-16 index several
 * characters off it. The window either side is decoded for reading, and may
 * open mid-codepoint, which shows up as a replacement character.
 */
function firstDifference([nameA, a], [nameB, b]) {
  let i = 0;
  const end = Math.min(a.length, b.length);
  while (i < end && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  const window = (buf) => JSON.stringify(buf.subarray(from, i + 60).toString("utf8"));
  return `at byte ${i}\n      ${nameA}: …${window(a)}\n      ${nameB}: …${window(b)}`;
}

/**
 * The two byte claims, over a pair of regenerations of one committed artifact:
 * the pair agrees, and it is what the tree holds at `name`.
 */
function holdToBytes(name, a, b) {
  const agree = a.equals(b);
  check(`${name}: two runs in a row agree`, agree,
    agree ? `${a.length} bytes`
      : `${a.length} vs ${b.length} bytes, ${firstDifference(["run 1", a], ["run 2", b])}`);

  const committed = readFileSync(join(root, name));
  const matches = committed.equals(a);
  check(`${name}: matches the committed bytes`, matches,
    matches ? `${committed.length} bytes`
      : `${committed.length} vs ${a.length} bytes, ${firstDifference(["committed", committed], ["regenerated", a])}`);
}

// ---- every band: two runs agree, and the run matches what is committed ----
const [first, second] = ["band-bytes-1", "band-bytes-2"].map(scratchCheckout);
console.log(`checkouts: ${first}, ${second}`);

// The walk is what enrols a band, so a walk that found nothing would report
// every check below green by having none to run.
check("the walk finds every committed band", BANDS.length > 0,
  BANDS.map((b) => b.artifact).join(", "));

// Same reasoning one level down: a renamed or deleted `<slug>-dark.svg` turns
// every `dark` false, and the loop below would skip its way to a green run.
const DARK = BANDS.filter((b) => b.dark);
check("the walk finds every committed dark render", DARK.length > 0,
  DARK.map((b) => `${b.artifact}-dark.svg`).join(", "));

for (const { generator, artifact, dark } of BANDS) {
  const runs = [first, second].map((checkout) => run(checkout, generator, [checkout]));
  const clean = runs.every((r) => r.status === 0);
  check(`${artifact}: the generator runs clean twice`, clean, clean ? undefined : why(runs.find((r) => r.status !== 0)));
  if (!clean) continue;

  for (const ext of [".excalidraw", ".svg"]) {
    const [a, b] = [first, second].map((checkout) => readFileSync(join(checkout, artifact + ext)));
    holdToBytes(artifact + ext, a, b);
  }

  // The dark sibling is the same two claims over a different producer: the
  // regenerated `.excalidraw` put back through `render.js --dark`, once per
  // checkout. `--no-frames` keeps it off the frame PNGs nothing here compares.
  if (!dark) continue;
  const renders = [first, second].map((checkout, i) => {
    const out = join(checkout, "dark", dirname(artifact));
    mkdirSync(out, { recursive: true });
    const render = run(checkout, join(root, "tools", "render.js"),
      [join(checkout, artifact + ".excalidraw"), "--dark", "--no-frames", "--out", out]);
    if (render.status !== 0) {
      check(`${artifact}-dark.svg: dark render ${i} runs clean`, false, why(render));
      return null;
    }
    return readFileSync(join(out, `${basename(artifact)}.svg`));
  });
  if (renders.every(Boolean)) holdToBytes(`${artifact}-dark.svg`, ...renders);
}

// ---- the smallest band: two regenerations render to identical PNGs ----
// One band carries the claim, because the seed it rests on is one derivation
// every band shares. Render the smallest, so proving it costs the least.
if (BANDS.length) {
  const smallest = BANDS.reduce((a, b) =>
    statSync(join(root, a.artifact + ".excalidraw")).size
      <= statSync(join(root, b.artifact + ".excalidraw")).size ? a : b);
  const name = basename(smallest.artifact);

  const frames = [first, second].map((checkout, i) => {
    const out = join(checkout, `frames-${i}`);
    mkdirSync(out, { recursive: true });
    const render = run(checkout, join(root, "tools", "render.js"),
      [join(checkout, smallest.artifact + ".excalidraw"), "--out", out]);
    if (render.status !== 0) {
      check(`${name}: render ${i} runs clean`, false, why(render));
      return null;
    }
    return { out, pngs: readdirSync(out).filter((f) => f.endsWith(".png")).sort() };
  });

  if (frames.every(Boolean)) {
    const [a, b] = frames;
    check(`${name}: both regenerations export the same frames`,
      a.pngs.length > 0 && a.pngs.join() === b.pngs.join(),
      `${a.pngs.length} frame(s): ${a.pngs.join(", ")}`);
    for (const png of a.pngs) {
      const pa = readFileSync(join(a.out, png));
      const pb = readFileSync(join(b.out, png));
      check(`${name}: ${png} is byte-identical across regenerations`, pa.equals(pb),
        pa.equals(pb) ? `${pa.length} bytes` : `${pa.length} vs ${pb.length} bytes`);
    }
  }
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nevery band regenerates byte for byte");
process.exit(fail.length ? 1 : 0);
