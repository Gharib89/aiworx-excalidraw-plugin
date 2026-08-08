#!/usr/bin/env node
/**
 * Proves the claim `test:fast` is built on: it needs no Chrome.
 *
 * Every suite named by `test:fast` is re-run here with CHROME_PATH pointed at
 * a path that cannot exist. tools/browser.js looks nowhere else once
 * CHROME_PATH is set, so any suite that *depends on a working Chrome* fails —
 * which is the property the fast target's speed rests on. (A suite that merely
 * imports tools/browser.js still passes, correctly: an import costs nothing.)
 *
 * It cannot be asserted statically: importing tools/browser.js is not the same
 * as launching Chrome (tests/error-classes.js imports it precisely to assert
 * its error classes), so an import-graph walk reports false positives.
 *
 * This suite belongs to `test:browser`, not `test:fast` — running it there
 * would double the fast target's runtime, which is the whole point of the
 * split. tests/test-targets.js asserts it stays on the browser side.
 *
 * Exits non-zero if any fast suite needs a browser.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
const fastSteps = (scripts["test:fast"] ?? "")
  .split("&&")
  .map((step) => step.trim())
  .filter(Boolean);
const fastTargets = fastSteps
  .map((step) => step.match(/^node\s+(\S+)$/))
  .filter(Boolean)
  .map((m) => m[1]);

check("test:fast names suites to prove", fastTargets.length > 0);
// Fail closed: a step this suite cannot re-run (an env prefix, a flag, an
// `npm run`) would otherwise be skipped in silence and still report green.
check(
  "every test:fast step is a plain `node <file>` this proof can re-run",
  fastTargets.length === fastSteps.length,
  fastSteps.filter((s) => !/^node\s+\S+$/.test(s)).join(", "),
);

// A path no filesystem hands back an executable for, on any of the three OSes.
const NO_CHROME = join(root, "tools", "no-such-chrome-executable");

for (const target of fastTargets) {
  const r = spawnSync(process.execPath, [join(root, target)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHROME_PATH: NO_CHROME },
  });
  const detail = r.status === 0 ? "" : (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" / ");
  check(`${target} passes with no Chrome`, r.status === 0, detail);
}

console.log(
  fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\ntest:fast needs no Chrome",
);
process.exit(fail.length ? 1 : 0);
