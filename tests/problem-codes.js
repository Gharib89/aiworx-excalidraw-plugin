#!/usr/bin/env node
/**
 * Guards the published problem-code registry against the code that emits the
 * codes.
 *
 * The gate's problem codes are a public, append-only contract, so the contract
 * has to be readable without reading tools/verify.js. That is
 * skills/excalidraw-diagram/reference/problem-codes.md — and a hand-written
 * registry rots the first time a rule lands without it. The invariants:
 *
 *   1. every code tools/verify.js emits appears in the element-level section, and
 *      every code tools/check.js emits appears in the file-level one — a new rule
 *      that skips the registry fails here, which is the only thing standing
 *      between "public contract" and "read the source". `deprecated` counts as
 *      listed: under add-new-plus-deprecate the old code keeps coming out beside
 *      its replacement while consumers migrate, so forbidding that overlap would
 *      forbid the only migration path the append-only rule allows;
 *   2. no `live` row names a code nothing emits, so the registry cannot promise
 *      a code that was quietly dropped. A code that has finished retiring moves
 *      to `deprecated` and stays listed for good — the name is never reused;
 *   3. every emission site yields a literal code. Rules 1-2 read the sources with
 *      a regex, and a computed code (`note(code, …)`) would be invisible to it
 *      *and* absent from the registry — a silent pass in both directions.
 *      Counting call sites against literal matches is what closes that hole.
 *
 * Exits non-zero on any mismatch, naming the codes on each side.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const count = (src, re) => (src.match(re) ?? []).length;

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// The element-level codes all reach the report through verify.js's `note`
// helper; the file-level ones are the `error: { code }` a file that never
// reached the rules carries instead of a problem list.
const verify = read("tools/verify.js");
const checkCli = read("tools/check.js");
const literal = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

const NOTE_CALL = /\bnote\(/g;
const NOTE_CODE = /\bnote\(\s*"([a-z][a-z-]*)"/g;
const ERROR_SITE = /error:\s*\{/g;
const ERROR_CODE = /error:\s*\{\s*code:\s*"([a-z][a-z-]*)"/g;

const emitted = {
  element: new Set(literal(verify, NOTE_CODE)),
  file: new Set(literal(checkCli, ERROR_CODE)),
};

// Invariant 3 — every site the regexes below scan must carry a literal code.
// A site the regex cannot read is a code the registry can silently omit.
check(
  "every verify.js note() names a literal code",
  count(verify, NOTE_CALL) === count(verify, NOTE_CODE),
  `${count(verify, NOTE_CODE)} literal of ${count(verify, NOTE_CALL)} call sites`,
);
check(
  "every check.js error object names a literal code",
  count(checkCli, ERROR_SITE) === count(checkCli, ERROR_CODE),
  `${count(checkCli, ERROR_CODE)} literal of ${count(checkCli, ERROR_SITE)} sites`,
);

const registry = read("skills/excalidraw-diagram/reference/problem-codes.md");

/**
 * Rows of one registry table, keyed by its exact `##` heading. A row is
 * `| `code` | live-or-deprecated | …`, the shape the doc's own tables use —
 * anything else in the file (prose, the field reference) is ignored.
 */
function rows(heading) {
  const section = registry.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
  if (section === undefined) return null;
  return [...section.matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|\s*(live|deprecated)\s*\|/gm)].map(
    (m) => ({ code: m[1], status: m[2] }),
  );
}

const SECTIONS = { element: "Element-level codes", file: "File-level codes" };

for (const [level, heading] of Object.entries(SECTIONS)) {
  const listed = rows(heading);
  if (listed === null) {
    check(`the registry has a "${heading}" section`, false);
    continue;
  }
  const live = new Set(listed.filter((r) => r.status === "live").map((r) => r.code));
  const known = new Set(listed.map((r) => r.code));
  const list = (codes) => codes.sort().join(", ");

  const unlisted = [...emitted[level]].filter((c) => !known.has(c));
  check(`every ${level}-level code emitted is in the registry`, unlisted.length === 0, list(unlisted));

  const phantom = [...live].filter((c) => !emitted[level].has(c));
  check(`no ${level}-level code is listed live but never emitted`, phantom.length === 0, list(phantom));
}

console.log(
  fail.length
    ? `\n${fail.length} FAILED: ${fail.join(", ")}`
    : `\nthe registry matches the gate — ${emitted.element.size} element-level and ${emitted.file.size} file-level codes`,
);
process.exit(fail.length ? 1 : 0);
