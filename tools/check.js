#!/usr/bin/env node
/**
 * Mechanical gate, CLI face. The rules live in tools/verify.js so the authoring
 * API can run them in-process before writing; this wrapper adds the file-level
 * checks (readable, parseable, actually an Excalidraw document) and the output.
 *
 * Usage: node tools/check.js [--json] [--] diagram.excalidraw [more.excalidraw ...]
 *
 * Every file is checked and reported; the exit code is the worst one seen, so a
 * clean run of many files still exits 0 and one bad file still fails the batch.
 * `--json` prints one document covering every file instead, for pre-commit hooks
 * and CI aggregation — the exit codes are the same either way.
 */
import { readFileSync } from "node:fs";
import { verifyDocument } from "./verify.js";

const USAGE = "usage: check.js [--json] [--] <file.excalidraw> [more.excalidraw ...]";

const inputs = [];
let json = false;
let literal = false; // everything after -- is a path, even if it looks like a flag
for (const arg of process.argv.slice(2)) {
  if (literal || !arg.startsWith("--")) inputs.push(arg);
  else if (arg === "--") literal = true;
  else if (arg === "--json") json = true;
  else {
    console.error(`unknown flag ${arg}\n${USAGE}`);
    process.exit(2);
  }
}
if (inputs.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

/**
 * Read, parse and verify one file. `code` is the exit code this file alone would
 * produce: 2 for an input that cannot be read at all, 1 for a document the gate
 * rejects, 0 for a clean one.
 */
function inspect(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    return { file, ok: false, code: 2, error: `cannot read — ${err.message}` };
  }
  if (raw.trim() === "") {
    return { file, ok: false, code: 1, error: "empty file — not an Excalidraw document" };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { file, ok: false, code: 1, error: `not valid JSON — ${err.message}` };
  }
  if (data?.type !== "excalidraw" || !Array.isArray(data.elements)) {
    return { file, ok: false, code: 1, error: `not an Excalidraw document (type ${JSON.stringify(data?.type)})` };
  }
  // The rules name a malformed document rather than throwing on it, but a batch
  // owes every other file its report whatever this one turns out to contain.
  let result;
  try {
    result = verifyDocument(data);
  } catch (err) {
    return { file, ok: false, code: 1, error: `cannot be checked — ${err.name}: ${err.message}` };
  }
  const { problems, stats } = result;
  return { file, ok: problems.length === 0, code: problems.length ? 1 : 0, problems, stats };
}

/** One file's human report: summary on stdout, defects on stderr. */
function report(r) {
  if (r.error) {
    console.error(`${r.file}: ${r.error}`);
    return;
  }
  console.log(
    `${r.file}: ${r.stats.elements} elements, ${r.stats.frames} frames, ` +
      `${r.stats.texts} text` +
      (r.stats.outsideAll ? `, ${r.stats.outsideAll} outside every frame` : ""),
  );
  if (r.problems.length) {
    console.error(`\n${r.problems.length} problem(s):`);
    r.problems.forEach((p) => console.error("  " + p));
    return;
  }
  console.log("clean — no mechanical defects");
}

const results = inputs.map(inspect);

if (json) {
  // one document, whatever the file count: a consumer parses the same shape for
  // one file as for fifty. stats is null for a file that never reached the rules.
  console.log(
    JSON.stringify(
      {
        ok: results.every((r) => r.ok),
        files: results.map(({ file, ok, error, problems = [], stats = null }) => ({
          file,
          ok,
          ...(error ? { error } : {}),
          problems,
          stats,
        })),
      },
      null,
      2,
    ),
  );
} else {
  results.forEach(report);
  // a single file's output stays exactly what it always was; the roll-up only
  // appears when there is more than one result to roll up
  if (results.length > 1) {
    const failed = results.filter((r) => !r.ok);
    const line = `\n${results.length} files checked, ${failed.length} failed` +
      (failed.length ? `: ${failed.map((r) => r.file).join(", ")}` : "");
    if (failed.length) console.error(line);
    else console.log(line);
  }
}

process.exit(Math.max(...results.map((r) => r.code)));
