#!/usr/bin/env node
/**
 * Fixture suite for the geometry gate (tools/check.js). Every other step trusts
 * the gate's exit code, so the gate itself is proven here: one clean file must
 * exit 0, and one planted-defect file per live rule must exit 1 *and* name the
 * defect in its output. A second section covers the batch face: many files in
 * one invocation, the combined exit code, and the --json report.
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
  // the app wraps bound text into the padded interior, not the container's box —
  // and for ellipse and diamond only the inscribed text area holds ink
  { name: "text-overflows-padding", exit: 1, expect: "text overflows container" },
  { name: "text-overflows-ellipse", exit: 1, expect: "text overflows container" },
  { name: "text-overflows-diamond", exit: 1, expect: "text overflows container" },
  // a shape clips its text, a line does not: the same width is a defect above
  // and correct rendering here
  { name: "arrow-label-wide", exit: 0, expect: "no mechanical defects" },
  { name: "missing-frame", exit: 1, expect: "references missing frame ghost" },
  { name: "escapes-frame", exit: 1, expect: "escapes frame" },
  { name: "rotated-escapes-frame", exit: 1, expect: "escapes frame" },
  { name: "unbound-over-frame", exit: 1, expect: "without being bound to it" },
  // overlap is judged on the rotated outline, not its axis-aligned box
  { name: "rotated-clear-of-frame", exit: 0, expect: "no mechanical defects" },
  { name: "arrow-binding-missing", exit: 1, expect: "points at missing element ghost" },
  { name: "empty", exit: 1, expect: "empty file" },
  { name: "invalid-json", exit: 1, expect: "not valid JSON" },
  { name: "foreign-json", exit: 1, expect: "not an Excalidraw document" },
  { name: "does-not-exist", exit: 2, expect: "cannot read" },
  { name: "degenerate-zero-size", exit: 1, expect: "zero size" },
  { name: "degenerate-non-finite", exit: 1, expect: "non-finite geometry" },
  { name: "unknown-type", exit: 1, expect: 'unknown element type "widget"' },
  { name: "free-texts-overlap", exit: 1, expect: "free texts overlap" },
  { name: "rotated-texts-overlap", exit: 1, expect: "free texts overlap" },
  { name: "rotated-texts-clear", exit: 0, expect: "no mechanical defects" },
  { name: "arrow-crosses-shape", exit: 1, expect: "crosses rectangle r1" },
  // a vertex inside the shape is still a pass-through; only a run that begins at
  // the arrow's tail or is still open at its head is binding hygiene
  { name: "arrow-vertex-inside-shape", exit: 1, expect: "crosses rectangle r1" },
  { name: "arrow-ends-inside-shape", exit: 0, expect: "no mechanical defects" },
  { name: "arrowhead-inside-target", exit: 1, expect: "lands inside its target" },
  { name: "off-canvas-stray", exit: 1, expect: "off-canvas stray" },
  { name: "low-contrast-text", exit: 1, expect: "needs 4.5:1" },
  { name: "text-over-image", exit: 1, expect: 'text "over the screenshot" sits over image i1' },
  { name: "foreign-font", exit: 1, expect: "outside the house pair" },
  { name: "image-missing-bytes", exit: 1, expect: "missing from the files dictionary" },
  { name: "malformed-element", exit: 1, expect: "element at index 1 is not an element object" },
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

// ---- many files at once, and the machine-readable report ----
//
// The single-file cases above are the compatibility contract: this section only
// adds what more than one argument, and --json, are supposed to do.
{
  const run = (...args) => spawnSync(process.execPath, [gate, ...args], { encoding: "utf8" });
  const CLEAN = fixture("clean");
  const DIRTY = fixture("duplicate-id");
  const ABSENT = fixture("does-not-exist");

  const EXAMPLE = join(root, "examples/example.excalidraw");
  const both = run(CLEAN, EXAMPLE);
  check("two clean files exit 0", both.status === 0, `exit ${both.status}`);
  check("two clean files each get a summary",
    both.stdout.includes(CLEAN) && both.stdout.includes(EXAMPLE) &&
      /2 files checked, 0 failed/.test(both.stdout),
    both.stdout.trim().split("\n").pop());

  const mixed = run(CLEAN, DIRTY);
  check("one bad file fails the batch", mixed.status === 1, `exit ${mixed.status}`);
  check("the failing file's defect is named", mixed.stderr.includes("duplicate id dup"),
    mixed.stderr.trim().split("\n").filter(Boolean).slice(0, 2).join(" | "));
  check("the clean file is still reported", mixed.stdout.includes("clean — no mechanical defects"));
  check("the roll-up names which file failed",
    /1 failed: /.test(mixed.stderr) && mixed.stderr.includes(DIRTY),
    mixed.stderr.trim().split("\n").pop());

  const unreadable = run(CLEAN, ABSENT);
  check("an unreadable input outranks a mere defect", unreadable.status === 2, `exit ${unreadable.status}`);

  // A document the rules cannot even walk must not take the batch down with it:
  // every other file is still owed its report.
  const hostile = run(fixture("malformed-element"), CLEAN);
  check("a malformed document does not abort the batch",
    hostile.status === 1 && hostile.stdout.includes("clean — no mechanical defects"),
    `exit ${hostile.status}: ${hostile.stdout.trim().split("\n").pop()}`);

  // A path can start with -- ; the conventional end-of-options marker is how you
  // say so, and it is not itself an input.
  const marker = run("--", CLEAN);
  check("-- ends the options", marker.status === 0 && marker.stdout.includes(CLEAN), `exit ${marker.status}`);
  const markerJson = run("--json", "--", CLEAN);
  check("-- composes with a flag before it",
    markerJson.status === 0 && JSON.parse(markerJson.stdout).files.length === 1, `exit ${markerJson.status}`);

  // --json: one document, exit codes unchanged
  const j = run(CLEAN, DIRTY, ABSENT, "--json");
  check("--json keeps the worst exit code", j.status === 2, `exit ${j.status}`);
  let doc = null;
  try {
    doc = JSON.parse(j.stdout);
  } catch (err) {
    doc = null;
  }
  check("--json prints one parseable document and nothing else", doc !== null,
    doc ? "" : j.stdout.trim().slice(0, 120));
  if (doc) {
    check("--json covers every file in order",
      doc.files?.length === 3 && doc.files.map((f) => f.file).join("|") === [CLEAN, DIRTY, ABSENT].join("|"),
      JSON.stringify(doc.files?.map((f) => f.ok)));
    check("--json reports ok false for the batch", doc.ok === false);
    check("--json carries per-file problems and stats",
      doc.files[0].ok === true && doc.files[0].problems.length === 0 &&
        doc.files[0].stats.elements > 0 &&
        doc.files[1].problems.some((p) => p.includes("duplicate id dup")),
      JSON.stringify(doc.files[1].problems));
    check("--json names the read failure and nulls its stats",
      /cannot read/.test(doc.files[2].error ?? "") && doc.files[2].stats === null,
      JSON.stringify(doc.files[2]));
  }

  const jClean = run(CLEAN, "--json");
  check("--json on a clean file exits 0 with ok true",
    jClean.status === 0 && JSON.parse(jClean.stdout).ok === true, `exit ${jClean.status}`);

  const bogus = run(CLEAN, "--bogus");
  check("an unknown flag is a usage error", bogus.status === 2 && /unknown flag --bogus/.test(bogus.stderr),
    `exit ${bogus.status}: ${bogus.stderr.trim().split("\n")[0]}`);
  const noArgs = run();
  check("no input is a usage error", noArgs.status === 2 && /usage: check\.js/.test(noArgs.stderr),
    `exit ${noArgs.status}`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall gate fixtures behave");
process.exit(fail.length ? 1 : 0);
