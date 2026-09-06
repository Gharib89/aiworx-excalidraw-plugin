#!/usr/bin/env node
/**
 * Guards the split between the two test targets in package.json.
 *
 * The split adds a fast path; it must never narrow the CI gate. Three static
 * invariants keep that true:
 *
 *   1. `test` is exactly `test:fast` then `test:browser`, so the chain cannot
 *      grow a third target that CI never learns about.
 *   2. The two targets together run *exactly* the gate's steps — every suite
 *      file in tests/ plus the handful that live elsewhere, each exactly once.
 *      A suite that is never wired in, wired into both, misspelled, or quietly
 *      deleted from one target all fail here, which is the only thing standing
 *      between the split and a narrower gate.
 *   3. `test:browser` still runs tests/chromeless.js, the empirical proof that
 *      `test:fast` needs no Chrome. That proof cannot live in `test:fast`
 *      itself (it re-runs the whole target, which would double its runtime),
 *      so nothing but this assertion stops it from being quietly dropped.
 *   4. `test:os` — the subset the macOS/Windows CI legs run — names only steps
 *      the gate already has, and keeps every suite whose claim is per-OS.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;

const RUNNER = "node tests/lib/parallel.js";

/**
 * Every gate step a script chain runs, in order. A `&&` chain is one step per
 * link; a link that hands its steps to the parallel runner contributes each
 * quoted argument instead, so the runner is transparent to every check below.
 */
const steps = (script) =>
  (script ?? "")
    .split("&&")
    .map((step) => step.trim())
    .filter(Boolean)
    .flatMap((step) =>
      step.startsWith(`${RUNNER} `)
        ? [...step.slice(RUNNER.length).matchAll(/"([^"]+)"/g)].map((m) => m[1])
        : [step],
    );

const fastSteps = steps(scripts["test:fast"]);
const browserSteps = steps(scripts["test:browser"]);
const osSteps = steps(scripts["test:os"]);

// Gate steps that are not suite files under tests/. Kept explicit so dropping
// one — the hole a tests/-only scan would never see — fails here.
const NON_SUITE_STEPS = ["node tools/palette.js", "npm run smoke"];

// ---- 1. `test` composes the two targets, in order, and adds nothing ----
{
  check(
    "npm test is exactly test:fast then test:browser",
    scripts.test === "npm run test:fast && npm run test:browser",
    scripts.test,
  );
  check("test:fast runs steps", fastSteps.length > 0);
  check("test:browser runs steps", browserSteps.length > 0);
}

// ---- 2. the two targets run exactly the gate's steps, each exactly once ----
{
  const expected = readdirSync(join(root, "tests"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `node tests/${f}`)
    .concat(NON_SUITE_STEPS)
    .sort();
  const actual = [...fastSteps, ...browserSteps].sort();

  const missing = expected.filter((s) => !actual.includes(s));
  const extra = actual.filter((s) => !expected.includes(s));
  const duplicated = actual.filter((s, i) => actual.indexOf(s) !== i);

  check("no gate step is missing from the targets", missing.length === 0, missing.join(", "));
  check("no target runs a step the gate does not have", extra.length === 0, extra.join(", "));
  check("no step runs twice", duplicated.length === 0, duplicated.join(", "));
}

// ---- 3. the chromeless proof still runs, and runs on the browser side ----
{
  check(
    "test:browser proves test:fast needs no Chrome",
    browserSteps.includes("node tests/chromeless.js"),
    browserSteps.join(" && "),
  );
  check(
    "the chromeless proof stays out of test:fast",
    !fastSteps.includes("node tests/chromeless.js"),
  );
}

// ---- 4. the per-OS subset is a subset: every step it names, the gate runs ----
// `test:os` is what the macOS/Windows CI legs run instead of the full suite. A
// step only it names would be a suite CI's Linux leg never sees; a misspelled
// one would silently run nothing.
{
  const gateSteps = [...fastSteps, ...browserSteps];
  const unknown = osSteps.filter((s) => s !== "npm run test:fast" && !gateSteps.includes(s));
  check("every test:os step is a gate step", unknown.length === 0, unknown.join(", "));
  // The suites whose claims are per-OS — Chrome discovery (the "chrome"
  // channel, CHROME_PATH) and path handling (junctions, file-URL specifiers).
  // Pinned by name: dropping any one of them from test:os is a narrower matrix.
  const OS_CLAIM_STEPS = [
    "npm run test:fast",
    "node tests/chromeless.js",
    "node tests/pipeline-errors.js",
    "node tests/example-paths.js",
    "npm run smoke",
  ];
  const dropped = OS_CLAIM_STEPS.filter((s) => !osSteps.includes(s));
  check("test:os keeps every per-OS suite", dropped.length === 0, dropped.join(", "));
}

console.log(
  fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\ntest targets stay split",
);
process.exit(fail.length ? 1 : 0);
