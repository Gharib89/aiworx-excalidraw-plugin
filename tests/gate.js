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
  { name: "clean", exit: 0, expect: "no mechanical defects" },
  { name: "duplicate-id", exit: 1, expect: "duplicate id dup" },
  { name: "frames-overlap", exit: 1, expect: "frames overlap" },
  { name: "missing-container", exit: 1, expect: "references missing container ghost" },
  { name: "text-overflows-container", exit: 1, expect: "text overflows container" },
  { name: "missing-frame", exit: 1, expect: "references missing frame ghost" },
  { name: "escapes-frame", exit: 1, expect: "escapes frame" },
  { name: "rotated-escapes-frame", exit: 1, expect: "escapes frame" },
  { name: "unbound-over-frame", exit: 1, expect: "without being bound to it" },
  { name: "arrow-binding-missing", exit: 1, expect: "points at missing element ghost" },
  { name: "empty", exit: 1, expect: "empty file" },
  { name: "invalid-json", exit: 1, expect: "not valid JSON" },
  { name: "foreign-json", exit: 1, expect: "not an Excalidraw document" },
  { name: "does-not-exist", exit: 2, expect: "cannot read" },
  { name: "degenerate-zero-size", exit: 1, expect: "zero size" },
  { name: "degenerate-non-finite", exit: 1, expect: "non-finite geometry" },
  { name: "unknown-type", exit: 1, expect: 'unknown element type "widget"' },
  { name: "free-texts-overlap", exit: 1, expect: "free texts overlap" },
  { name: "arrow-crosses-shape", exit: 1, expect: "crosses rectangle r1" },
  { name: "arrowhead-inside-target", exit: 1, expect: "lands inside its target" },
  { name: "off-canvas-stray", exit: 1, expect: "off-canvas stray" },
  { name: "low-contrast-text", exit: 1, expect: "needs 4.5:1" },
  { name: "text-over-image", exit: 1, expect: 'text "over the screenshot" sits over image i1' },
  { name: "foreign-font", exit: 1, expect: "outside the house pair" },
  { name: "image-missing-bytes", exit: 1, expect: "missing from the files dictionary" },
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
