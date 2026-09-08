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
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

/** Every band under examples/, as `generator -> artifact` relative to examples/. */
const BANDS = [
  ["gen-example.js", "example"],
  ["plugin-tour/gen-plugin-tour.js", "plugin-tour/plugin-tour"],
  ["triage-graph/gen-triage-graph.js", "triage-graph/triage-graph"],
];

/**
 * A checkout the generators can write into. `tools` and `brand` are linked, not
 * copied, so the run exercises the real modules; "junction" is the one directory
 * link Windows makes without elevation and is ignored on POSIX.
 */
function scratchCheckout(tag) {
  const checkout = mkdtempSync(join(tmpdir(), `${tag}-`));
  for (const dir of ["tools", "brand"]) symlinkSync(join(root, dir), join(checkout, dir), "junction");
  // package.json carries `"type": "module"`. Without it the copied generators
  // resolve down a different path than a real checkout takes.
  copyFileSync(join(root, "package.json"), join(checkout, "package.json"));
  cpSync(join(root, "examples"), join(checkout, "examples"), { recursive: true });
  return checkout;
}

const run = (checkout, script, args = []) => spawnSync(process.execPath, [script, ...args], {
  cwd: checkout, encoding: "utf8",
});

// ---- 1. every band comes back byte-identical ----
const regenerated = scratchCheckout("band-bytes");
console.log(`checkout: ${regenerated}`);

for (const [generator, artifact] of BANDS) {
  const done = run(regenerated, join("examples", generator), [regenerated]);
  check(`${artifact}: the generator runs clean`, done.status === 0,
    done.status === 0 ? undefined : (done.stderr || done.stdout || "").trim().split("\n").slice(-4).join(" / "));
  if (done.status !== 0) continue;

  for (const ext of [".excalidraw", ".svg"]) {
    const before = readFileSync(join(root, "examples", artifact + ext));
    const after = readFileSync(join(regenerated, "examples", artifact + ext));
    check(`${artifact}${ext}: regenerates byte-identical`, before.equals(after),
      before.equals(after) ? `${before.length} bytes`
        : `${before.length} vs ${after.length} bytes. Run the generator and commit the reflow, or a change moved the picture`);
  }
}

// ---- 2. two independent regenerations render to identical PNGs ----
// One band is enough: the claim is about the seed, which every band shares.
// triage-graph is the cheapest: two frames and no image payload.
{
  const [, artifact] = BANDS[2];
  const second = scratchCheckout("band-bytes-2");
  const again = run(second, join("examples", BANDS[2][0]), [second]);
  check("triage-graph: the second regeneration runs clean", again.status === 0,
    again.status === 0 ? undefined : (again.stderr || again.stdout || "").trim().split("\n").slice(-4).join(" / "));

  if (again.status === 0) {
    const frames = [regenerated, second].map((checkout, i) => {
      const out = join(checkout, `frames-${i}`);
      mkdirSync(out, { recursive: true });
      const render = run(checkout, join(root, "tools", "render.js"),
        [join(checkout, "examples", artifact + ".excalidraw"), "--out", out]);
      if (render.status !== 0) {
        check(`triage-graph: render ${i} runs clean`, false,
          (render.stderr || render.stdout || "").trim().split("\n").slice(-4).join(" / "));
        return null;
      }
      return { out, names: readdirSync(out).filter((f) => f.endsWith(".png")).sort() };
    });

    if (frames.every(Boolean)) {
      const [a, b] = frames;
      check("triage-graph: both regenerations export the same frames",
        a.names.length > 0 && a.names.join() === b.names.join(),
        `${a.names.length} frame(s): ${a.names.join(", ")}`);
      for (const name of a.names) {
        const pa = readFileSync(join(a.out, name));
        const pb = readFileSync(join(b.out, name));
        check(`triage-graph: ${name} is byte-identical across regenerations`, pa.equals(pb),
          pa.equals(pb) ? `${pa.length} bytes` : `${pa.length} vs ${pb.length} bytes`);
      }
    }
  }
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nevery band regenerates byte for byte");
process.exit(fail.length ? 1 : 0);
