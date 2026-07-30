#!/usr/bin/env node
/**
 * Contract suite for the revise CLI (tools/revise.js).
 *
 * Two halves:
 *   1. argument and input validation — a bad invocation exits 2 with a named
 *      UsageError, a file the pipeline cannot use exits 1 with a named
 *      DocumentError, so nothing is ever half-revised in silence
 *   2. one happy path — a hand-edited copy of the committed example fails the
 *      gate, the CLI revises it in place so the gate passes again, and the SVG
 *      is rewritten beside it unless --no-svg says otherwise
 *
 * Exits non-zero on any mismatch.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reviseJs = join(root, "tools/revise.js");
const checkJs = join(root, "tools/check.js");
const example = join(root, "examples/example.excalidraw");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const revise = (...args) =>
  spawnSync(process.execPath, [reviseJs, ...args], { encoding: "utf8" });
const gate = (file) =>
  spawnSync(process.execPath, [checkJs, file], { encoding: "utf8" });
const firstErrorLine = (r) =>
  r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120);

const badDir = mkdtempSync(join(tmpdir(), "revise-cli-bad-"));
const unparseable = join(badDir, "unparseable.excalidraw");
writeFileSync(unparseable, "{ not json");
const foreign = join(badDir, "foreign.excalidraw");
writeFileSync(foreign, JSON.stringify({ widgets: ["not", "a", "diagram"] }));

// ---- 1. validation: a bad invocation never reaches the browser ----

const INVALID = [
  { name: "missing input", args: [], code: 2, error: "UsageError" },
  { name: "unknown flag", args: [example, "--bogus"], code: 2, error: "UsageError" },
  { name: "extra positional", args: [example, example], code: 2, error: "UsageError" },
  { name: "missing file", args: [join(badDir, "absent.excalidraw")], code: 1, error: "DocumentError" },
  { name: "unparseable file", args: [unparseable], code: 1, error: "DocumentError" },
  { name: "foreign file", args: [foreign], code: 1, error: "DocumentError" },
];

for (const c of INVALID) {
  const r = revise(...c.args);
  check(`${c.name}: exits ${c.code}`, r.status === c.code, `got ${r.status}`);
  check(`${c.name}: names ${c.error}`, new RegExp(c.error).test(r.stderr), firstErrorLine(r));
}

// nothing was written next to the rejected inputs
check("a rejected input gets no SVG", !existsSync(join(badDir, "foreign.svg")));

// ---- 2. happy path: hand-edit, revise, the gate passes again ----

/** A copy of the example with its title dragged out of its frame — a real hand edit. */
function mangledCopy(dir) {
  const copy = join(dir, "example.excalidraw");
  copyFileSync(example, copy);
  const doc = JSON.parse(readFileSync(copy, "utf8"));
  doc.elements.find((e) => e.type === "text" && e.text === "two lanes").y += 700;
  writeFileSync(copy, JSON.stringify(doc, null, 2) + "\n");
  return copy;
}

{
  const dir = mkdtempSync(join(tmpdir(), "revise-cli-ok-"));
  const copy = mangledCopy(dir);
  const svg = join(dir, "example.svg");

  const before = gate(copy);
  check("the hand-edited copy fails the gate", before.status === 1, `exit ${before.status}`);

  const r = revise(copy);
  check("revise exits 0", r.status === 0, r.stderr.trim().split("\n").pop());
  check("revise reports both artifacts", r.stdout.includes(copy) && r.stdout.includes(svg),
    r.stdout.trim().split("\n").join(" | "));
  check("revise writes the SVG beside the file", existsSync(svg));
  const after = gate(copy);
  check("the revised file passes the gate", after.status === 0,
    (after.stdout + after.stderr).trim().split("\n").pop());
}

{
  const dir = mkdtempSync(join(tmpdir(), "revise-cli-nosvg-"));
  const copy = mangledCopy(dir);
  const r = revise(copy, "--no-svg");
  check("--no-svg exits 0", r.status === 0, r.stderr.trim().split("\n").pop());
  check("--no-svg writes no SVG", !existsSync(join(dir, "example.svg")));
  check("--no-svg still revises the file", gate(copy).status === 0);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nrevise CLI behaves");
process.exit(fail.length ? 1 : 0);
