#!/usr/bin/env node
/**
 * Guards the published build-context inventory against the factory that builds
 * the context.
 *
 * The `build` callback receives one object, and a generator author reads its
 * whole surface from skills/excalidraw-diagram/reference/authoring.md — the
 * shipped skill travels without this repo, so a member the reference omits is a
 * member nobody outside the checkout can find. tools/author.js exports
 * `buildContext` precisely so this guard can read the real surface —
 * `Object.keys` on a constructed instance — instead of parsing source. Every
 * member is a lazy factory (a function, a bound closure, a plain value), so
 * calling it with empty stand-ins is construction-safe. The invariants:
 *
 *   1. every member the factory passes appears in the inventory table, so a new
 *      helper cannot land undocumented;
 *   2. no table row names a member the factory does not pass, so the inventory
 *      cannot promise a helper that was renamed or dropped.
 *
 * Exits non-zero on any mismatch, naming the members on each side.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext } from "../tools/author.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const list = (names) => [...names].sort().join(", ");

const members = Object.keys(buildContext({}, {}));

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
