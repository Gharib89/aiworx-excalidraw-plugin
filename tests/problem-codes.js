#!/usr/bin/env node
/**
 * Guards the published problem-code registry against the code that emits the
 * codes.
 *
 * The gate's problem codes are a public, append-only contract, so the contract
 * has to be readable without reading tools/verify.js. That is
 * skills/excalidraw-diagram/reference/problem-codes.md — and a hand-written
 * registry rots the first time a rule lands without it. Four invariants keep the
 * two in step:
 *
 *   1. every code tools/verify.js emits is listed `live` in the element-level
 *      section, and
 *   2. every code tools/check.js emits is listed `live` in the file-level one —
 *      a new rule that skips the registry fails here, which is the only thing
 *      standing between "public contract" and "read the source";
 *   3. no `live` row names a code nothing emits, so the registry cannot promise
 *      a code that was quietly dropped;
 *   4. no `deprecated` row is still emitted — deprecation is how a rename ships
 *      under the append-only rule, and it only means anything once the old code
 *      has actually stopped coming out.
 *
 * Exits non-zero on any mismatch, naming the codes on each side.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// The element-level codes all reach the report through verify.js's `note`
// helper; the file-level ones are the `error: { code }` a file that never
// reached the rules carries instead of a problem list.
const emitted = {
  element: new Set(
    [...read("tools/verify.js").matchAll(/\bnote\(\s*"([a-z][a-z-]*)"/g)].map((m) => m[1]),
  ),
  file: new Set(
    [...read("tools/check.js").matchAll(/error:\s*\{\s*code:\s*"([a-z][a-z-]*)"/g)].map((m) => m[1]),
  ),
};

const registry = read("skills/excalidraw-diagram/reference/problem-codes.md");

/**
 * Rows of one registry table, keyed by the `##` heading above them. A row is
 * `| `code` | live-or-deprecated | …`, which is the shape the doc's own tables
 * use — anything else in the file (prose, field lists) is ignored.
 */
function rows(headingMatch) {
  const section = registry
    .split(/^## /m)
    .find((s) => headingMatch.test(s.split("\n")[0]));
  if (!section) return null;
  return [...section.matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|\s*(live|deprecated)\s*\|/gm)].map(
    (m) => ({ code: m[1], status: m[2] }),
  );
}

const documented = {
  element: rows(/element/i),
  file: rows(/file/i),
};

const failures = [];
const report = (msg, codes) => failures.push(`${msg}: ${[...codes].sort().join(", ")}`);

for (const level of ["element", "file"]) {
  const listed = documented[level];
  if (listed === null) {
    failures.push(`registry has no ${level}-level section`);
    continue;
  }
  const live = new Set(listed.filter((r) => r.status === "live").map((r) => r.code));
  const deprecated = new Set(listed.filter((r) => r.status === "deprecated").map((r) => r.code));

  const unlisted = [...emitted[level]].filter((c) => !live.has(c));
  if (unlisted.length) report(`${level}-level codes emitted but not listed live`, unlisted);

  const phantom = [...live].filter((c) => !emitted[level].has(c));
  if (phantom.length) report(`${level}-level codes listed live but never emitted`, phantom);

  const undead = [...deprecated].filter((c) => emitted[level].has(c));
  if (undead.length) report(`${level}-level codes marked deprecated but still emitted`, undead);
}

if (failures.length) {
  console.error("problem-code registry out of sync with the gate:");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

const total = emitted.element.size + emitted.file.size;
console.log(`problem-codes: ${total} codes documented and emitted (registry in sync)`);
