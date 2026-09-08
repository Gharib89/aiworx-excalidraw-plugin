#!/usr/bin/env node
/**
 * Every committed band regenerates byte for byte (#227).
 *
 * This is the check three recent briefs asked for and could not have: with the
 * bytes stable, a diff on a band means geometry actually moved, so "did my
 * change reach any picture it should not have?" is answerable from
 * `git status` instead of a throwaway normalising script.
 *
 * It regenerates **out of tree** (a temp checkout that symlinks `tools/` and
 * `brand/` and copies `examples/`) for two reasons: CI asserts verification
 * never dirties a tracked file, and a generator writes next to its own script,
 * so copying the script is what moves the write somewhere else without changing
 * the generators' contract. `tests/example-paths.js` is the precedent.
 *
 * The last claim is the one the seed exists for: two independent regenerations
 * render to identical PNGs. `seed` drives Rough.js jitter, so before this change
 * the same geometry rasterised differently every run.
 *
 * `test:browser` only, so this runs on Linux alone. The bytes are a claim about
 * one machine's Chrome and its vendored fonts, not a cross-platform one: text
 * measurement settles per platform, so a macOS or Windows leg would compare a
 * Linux-generated commit against its own metrics and fail for a reason that has
 * nothing to do with determinism. The junction link below is for the shared
 * helper's sake, not a per-OS claim this suite makes.
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

/**
 * Where two artifacts first disagree, with the text either side of the split.
 * A byte count alone says nothing about which value moved, and this suite's
 * whole purpose is answering that from a log rather than a normalising script.
 */
function firstDifference(before, after) {
  const a = before.toString("utf8");
  const b = after.toString("utf8");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `at offset ${i}\n      committed: …${JSON.stringify(a.slice(from, i + 60))}`
    + `\n      regenerated: …${JSON.stringify(b.slice(from, i + 60))}`;
}

// ---- 1. every band comes back byte-identical ----
const regenerated = scratchCheckout("band-bytes");
console.log(`checkout: ${regenerated}`);

// The walk is what enrols a band, so a walk that found nothing would report
// every check below green by having none to run.
check("the walk finds every committed band", BANDS.length > 0,
  BANDS.map((b) => b.artifact).join(", "));

for (const { generator, artifact } of BANDS) {
  const done = run(regenerated, generator, [regenerated]);
  check(`${artifact}: the generator runs clean`, done.status === 0,
    done.status === 0 ? undefined : (done.stderr || done.stdout || "").trim().split("\n").slice(-4).join(" / "));
  if (done.status !== 0) continue;

  for (const ext of [".excalidraw", ".svg"]) {
    const before = readFileSync(join(root, artifact + ext));
    const after = readFileSync(join(regenerated, artifact + ext));
    check(`${artifact}${ext}: regenerates byte-identical`, before.equals(after),
      before.equals(after) ? `${before.length} bytes`
        : `${before.length} vs ${after.length} bytes, ${firstDifference(before, after)}`);
  }
}

// ---- 2. two independent regenerations render to identical PNGs ----
// One band carries the claim, because the seed it rests on is one derivation
// every band shares. Render the smallest, so proving it costs the least.
if (BANDS.length) {
  const smallest = BANDS.reduce((a, b) =>
    statSync(join(root, a.artifact + ".excalidraw")).size
      <= statSync(join(root, b.artifact + ".excalidraw")).size ? a : b);
  const name = basename(smallest.artifact);

  const second = scratchCheckout("band-bytes-2");
  const again = run(second, smallest.generator, [second]);
  check(`${name}: the second regeneration runs clean`, again.status === 0,
    again.status === 0 ? undefined : (again.stderr || again.stdout || "").trim().split("\n").slice(-4).join(" / "));

  if (again.status === 0) {
    // Part 1 held each regeneration against the committed bytes, which pins the
    // two to each other only through what is on disk. Two runs compared directly
    // is the claim itself, and it is the one that survives a stale commit.
    for (const ext of [".excalidraw", ".svg"]) {
      const first = readFileSync(join(regenerated, smallest.artifact + ext));
      const twice = readFileSync(join(second, smallest.artifact + ext));
      check(`${name}${ext}: two runs in a row agree`, first.equals(twice),
        first.equals(twice) ? `${first.length} bytes` : `${first.length} vs ${twice.length} bytes`);
    }

    const frames = [regenerated, second].map((checkout, i) => {
      const out = join(checkout, `frames-${i}`);
      mkdirSync(out, { recursive: true });
      const render = run(checkout, join(root, "tools", "render.js"),
        [join(checkout, smallest.artifact + ".excalidraw"), "--out", out]);
      if (render.status !== 0) {
        check(`${name}: render ${i} runs clean`, false,
          (render.stderr || render.stdout || "").trim().split("\n").slice(-4).join(" / "));
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
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nevery band regenerates byte for byte");
process.exit(fail.length ? 1 : 0);
