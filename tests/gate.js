#!/usr/bin/env node
/**
 * Fixture suite for the geometry gate (tools/check.js). Every other step trusts
 * the gate's exit code, so the gate itself is proven here: one clean file must
 * exit 0, and one planted-defect file per live rule must exit 1 *and* name the
 * defect in its output.
 *
 * Exits non-zero on any mismatch, with the gate's actual output printed.
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "tools/check.js");
const fixture = (name) => join(root, "tests/fixtures", `${name}.excalidraw`);

const CASES = [
  { name: "clean", exit: 0, expect: "geometry clean" },
  { name: "duplicate-id", exit: 1, expect: "duplicate id dup" },
  { name: "frames-overlap", exit: 1, expect: "frames overlap" },
  { name: "missing-container", exit: 1, expect: "references missing container ghost" },
  { name: "text-overflows-container", exit: 1, expect: "text overflows container" },
  { name: "missing-frame", exit: 1, expect: "references missing frame ghost" },
  { name: "escapes-frame", exit: 1, expect: "escapes frame" },
  { name: "unbound-over-frame", exit: 1, expect: "without being bound to it" },
  { name: "arrow-binding-missing", exit: 1, expect: "points at missing element ghost" },
];

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

for (const c of CASES) {
  const r = spawnSync(process.execPath, [gate, fixture(c.name)], { encoding: "utf8" });
  const output = r.stdout + r.stderr;
  check(`${c.name}: exits ${c.exit}`, r.status === c.exit, `got ${r.status}`);
  check(`${c.name}: names the defect`, output.includes(c.expect),
    output.includes(c.expect) ? `"${c.expect}"` : `expected "${c.expect}" in:\n${output.trim()}`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall gate fixtures behave");
process.exit(fail.length ? 1 : 0);
