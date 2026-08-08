#!/usr/bin/env node
/**
 * Guards the split between the two test targets in package.json.
 *
 * The split adds a fast path; it must never narrow the CI gate. Three static
 * invariants keep that true:
 *
 *   1. `test` is exactly `test:fast` then `test:browser`, so no suite can be
 *      dropped from the gate by editing one target alone.
 *   2. Every suite file in tests/ runs in exactly one target — a new suite that
 *      is never wired in fails here instead of silently never running.
 *   3. `test:browser` still runs tests/chromeless.js, the empirical proof that
 *      `test:fast` needs no Chrome. That proof cannot live in `test:fast`
 *      itself (it re-runs the whole target, which would double its runtime),
 *      so nothing but this assertion stops it from being quietly dropped.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
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

/** The `node <file>` targets a script chain runs, in order. */
const nodeTargets = (script) =>
  (script ?? "")
    .split("&&")
    .map((step) => step.trim().match(/^node\s+(\S+)$/))
    .filter(Boolean)
    .map((m) => m[1]);

const fastTargets = nodeTargets(scripts["test:fast"]);
const browserTargets = nodeTargets(scripts["test:browser"]);

// ---- 1. `test` composes the two targets, in order, and adds nothing ----
{
  check(
    "npm test is exactly test:fast then test:browser",
    scripts.test === "npm run test:fast && npm run test:browser",
    scripts.test,
  );
  check("test:fast runs suites", fastTargets.length > 0);
  check("test:browser runs suites", browserTargets.length > 0);
}

// ---- 2. every suite in tests/ runs in exactly one target ----
{
  const suites = readdirSync(join(root, "tests"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `tests/${f}`)
    .sort();

  const missing = suites.filter(
    (s) => !fastTargets.includes(s) && !browserTargets.includes(s),
  );
  check("every tests/*.js suite is wired into a target", missing.length === 0, missing.join(", "));

  const both = suites.filter((s) => fastTargets.includes(s) && browserTargets.includes(s));
  check("no suite runs in both targets", both.length === 0, both.join(", "));

  const ghosts = [...fastTargets, ...browserTargets].filter((t) => !existsSync(join(root, t)));
  check("every target names a file that exists", ghosts.length === 0, ghosts.join(", "));
}

// ---- 3. the chromeless proof still runs, and runs on the browser side ----
{
  check(
    "test:browser proves test:fast needs no Chrome",
    browserTargets.includes("tests/chromeless.js"),
    browserTargets.join(" "),
  );
  check(
    "the chromeless proof stays out of test:fast",
    !fastTargets.includes("tests/chromeless.js"),
  );
}

console.log(
  fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\ntest targets stay split",
);
process.exit(fail.length ? 1 : 0);
