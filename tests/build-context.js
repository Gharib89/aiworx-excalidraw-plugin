#!/usr/bin/env node
/**
 * Guards the published build-context inventory against the factory that builds
 * the context.
 *
 * The `build` callback receives one object, and a generator author reads its
 * whole surface from skills/excalidraw-diagram/reference/authoring.md — the
 * shipped skill travels without this repo, so a member the reference omits is a
 * member nobody outside the checkout can find. The invariants:
 *
 *   1. every member the factory passes appears in the inventory table, so a new
 *      helper cannot land undocumented;
 *   2. no table row names a member the factory does not pass, so the inventory
 *      cannot promise a helper that was renamed or dropped;
 *   3. every entry of the factory literal yields a member name. Rules 1-2 read
 *      the factory with a regex, and a spread (`...extras`) or computed key
 *      would be invisible to it *and* absent from the table — a silent pass in
 *      both directions. Counting entries against matched names closes that hole.
 *
 * Exits non-zero on any mismatch, naming the members on each side.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const list = (names) => [...names].sort().join(", ");

// The context is one object literal: `const buildContext = (ex, files) => ({ … });`
const author = read("tools/author.js");
const literal = author.match(/const\s+buildContext\s*=\s*\([^)]*\)\s*=>\s*\(\{([\s\S]*?)\n\s*\}\);/);

if (literal === null) {
  check("tools/author.js declares the buildContext object literal", false);
  console.log("\n1 FAILED: the factory shape this suite reads has moved — update the pattern");
  process.exit(1);
}

// One entry per member, split on the literal's own commas — the ones outside any
// nested call or bracket, so `image: makeImage(ex, files)` stays one entry. Line
// counting would miss a second member sharing a line, which is the shape a new
// helper is most likely to arrive in.
const source = literal[1].replace(/^\s*\/\/.*$/gm, "");
const entries = [];
let depth = 0;
let entry = "";
for (const ch of source) {
  if ("([{".includes(ch)) depth += 1;
  else if (")]}".includes(ch)) depth -= 1;
  if (ch === "," && depth === 0) {
    entries.push(entry);
    entry = "";
  } else entry += ch;
}
if (entry.trim()) entries.push(entry);

// `measure: ex.measureText` and shorthand `stack` both name their member first.
const named = entries.filter((e) => e.trim());
const members = named.flatMap((e) => e.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/)?.slice(1, 2) ?? []);

// Invariant 3 — an entry the regex cannot read is a member the table can omit.
check(
  "every buildContext entry names a literal member",
  members.length === named.length,
  `${members.length} literal of ${named.length} entries`,
);

const reference = read("skills/excalidraw-diagram/reference/authoring.md");
const HEADING = "The build context";

/**
 * Names in the first column of the inventory table — `| `member` | …`, the
 * shape that section's table uses. Prose and the register table elsewhere in
 * the file are outside the section and never scanned.
 */
const section = reference.split(/^## /m).find((s) => s.startsWith(`${HEADING}\n`));
const listed =
  section === undefined
    ? null
    : new Set([...section.matchAll(/^\|\s*`([A-Za-z_$][\w$]*)`[^|]*\|/gm)].map((m) => m[1]));

if (listed === null) {
  check(`the reference has a "${HEADING}" section`, false);
} else {
  const undocumented = members.filter((m) => !listed.has(m));
  check("every build-context member is in the inventory", undocumented.length === 0, list(undocumented));

  const phantom = [...listed].filter((m) => !members.includes(m));
  check("no inventory row names a member the context does not pass", phantom.length === 0, list(phantom));
}

console.log(
  fail.length
    ? `\n${fail.length} FAILED: ${fail.join(", ")}`
    : `\nthe inventory matches the factory — ${members.length} build-context members`,
);
process.exit(fail.length ? 1 : 0);
