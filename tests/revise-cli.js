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

// A single-dash argument is a typo, never a path. The parser admitted anything
// that did not start with `--`, so `-no-svg` alone became a bogus file path and
// came back as "cannot read", while `-no-svg` after a real file was collected as
// a second positional and the error blamed the file count instead of the flag.
// check.js closed this in #76; this CLI now shares its vocabulary.
{
  const copy = join(badDir, "copy.excalidraw");
  copyFileSync(example, copy);
  const DASH = [
    { name: "single-dash flag after the file", args: [copy, "-no-svg"], arg: "-no-svg" },
    { name: "single-dash flag before the file", args: ["-no-svg", copy], arg: "-no-svg" },
    { name: "single-dash flag alone", args: ["-no-svg"], arg: "-no-svg" },
    { name: "bare dash", args: ["-"], arg: "-" },
  ];
  for (const c of DASH) {
    const r = revise(...c.args);
    check(`${c.name}: exits 2`, r.status === 2, `got ${r.status}`);
    check(`${c.name}: names the offending argument`,
      r.stderr.includes(`UsageError: unknown flag ${c.arg}`), firstErrorLine(r));
  }
  // the guard fires during parsing, so the file is never touched
  check("a rejected argument revises nothing", !existsSync(join(badDir, "copy.svg")));
}

// `--` is what makes the strict guard above tenable: a file whose name really
// does begin with a dash is still reachable. The child runs from the directory so
// the argument itself starts with a dash — an absolute path never would.
{
  const dir = mkdtempSync(join(tmpdir(), "revise-cli-literal-"));
  const dashed = join(dir, "-dashed.excalidraw");
  copyFileSync(example, dashed);
  // mangled the way the happy path below mangles its copy, so a file the CLI
  // never actually revised cannot pass the check by already being clean
  const doc = JSON.parse(readFileSync(dashed, "utf8"));
  doc.elements.find((e) => e.type === "text" && e.text === "two lanes").y += 700;
  writeFileSync(dashed, JSON.stringify(doc, null, 2) + "\n");
  check("the dash-named copy fails the gate first", gate(dashed).status === 1);
  const r = spawnSync(process.execPath, [reviseJs, "--no-svg", "--", "-dashed.excalidraw"],
    { encoding: "utf8", cwd: dir });
  check("-- admits a dash-named input", r.status === 0, firstErrorLine(r));
  check("-- revises the dash-named file", gate(dashed).status === 0);
}

// A failure raised beneath the authoring API — no browser, a stale bundle, a
// missing runtime dependency — is a named error too, and the CLI owes it the
// same treatment as its own: name and exit code, never a raw stack.
{
  const r = spawnSync(process.execPath, [reviseJs, example], {
    encoding: "utf8",
    env: { ...process.env, CHROME_PATH: join(badDir, "no-such-chrome") },
  });
  check("an unlaunchable browser exits 1", r.status === 1, `got ${r.status}`);
  check("an unlaunchable browser names ChromeLaunchError",
    /ChromeLaunchError:/.test(r.stderr), firstErrorLine(r));
  check("an unlaunchable browser prints no stack trace", !/^\s+at\s/m.test(r.stderr),
    r.stderr.trim().split("\n").slice(0, 2).join(" | "));
}

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
