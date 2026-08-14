#!/usr/bin/env node
/**
 * Mechanical gate, CLI face. The rules live in tools/verify.js so the authoring
 * API can run them in-process before writing; this wrapper maps the shared
 * loader's file-level refusals (tools/document.js) to its code contract and
 * adds the output.
 *
 * Usage: node tools/check.js [--json] [--] diagram.excalidraw [more.excalidraw ...]
 *
 * Every file is checked and reported; the exit code is the worst one seen, so a
 * clean run of many files still exits 0 and one bad file still fails the batch.
 * `--json` prints one document covering every file instead, for pre-commit hooks
 * and CI aggregation — the exit codes are the same either way.
 *
 * Contrast is scored against both themes on every run — each low-contrast
 * problem carries the theme it failed under. Render tools keep their dark
 * flags; that is output selection, not verification.
 */
import { CHECK_FLAGS, parseFlags } from "./cli-flags.js";
import { readExcalidrawDocument } from "./document.js";
import { DocumentError, UsageError } from "./errors.js";
import { verifyDocument } from "./verify.js";

const USAGE = "usage: check.js [--json] [--] <file.excalidraw> [more.excalidraw ...]";

let inputs, json;
try {
  const parsed = parseFlags(process.argv.slice(2), { ...CHECK_FLAGS, usage: USAGE });
  inputs = parsed.positionals;
  json = Boolean(parsed.flags.json);
  if (inputs.length === 0) throw new UsageError("no input file given", { where: "input", next: USAGE });
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  console.error(`UsageError: ${err.message}`);
  process.exit(2);
}

/**
 * Read, parse and verify one file. `code` is the exit code this file alone would
 * produce: 2 for an input that cannot be read at all, 1 for a document the gate
 * rejects, 0 for a clean one.
 *
 * `error` is `{ code, message }` — a stable kebab-case code in its own
 * namespace, distinct from the element-level problem codes, for a file that
 * never reached the rules.
 */
function inspect(file) {
  let data;
  try {
    data = readExcalidrawDocument(file);
  } catch (err) {
    if (!(err instanceof DocumentError)) throw err;
    // tests/problem-codes.js statically requires a literal code at every error
    // site in this file, so err.kind is switched into one rather than passed
    // through — a computed code would be invisible to that scan.
    switch (err.kind) {
      case "unreadable":
        return { file, ok: false, code: 2, error: { code: "unreadable", message: err.what } };
      case "empty-file":
        return { file, ok: false, code: 1, error: { code: "empty-file", message: err.what } };
      case "invalid-json":
        return { file, ok: false, code: 1, error: { code: "invalid-json", message: err.what } };
      case "not-excalidraw":
        return { file, ok: false, code: 1, error: { code: "not-excalidraw", message: err.what } };
      default:
        // a kind this contract has no code for is a programming error, not a
        // file to mislabel — let it crash loudly like any other unexpected throw
        throw err;
    }
  }
  // The rules name a malformed document rather than throwing on it, but a batch
  // owes every other file its report whatever this one turns out to contain.
  let result;
  try {
    result = verifyDocument(data);
  } catch (err) {
    return { file, ok: false, code: 1, error: { code: "check-crashed", message: `cannot be checked — ${err.name}: ${err.message}` } };
  }
  const { problems, stats } = result;
  return { file, ok: problems.length === 0, code: problems.length ? 1 : 0, problems, stats };
}

/** One file's human report: summary on stdout, defects on stderr. */
function report(r) {
  if (r.error) {
    console.error(`${r.file}: ${r.error.message}`);
    return;
  }
  console.log(
    `${r.file}: ${r.stats.elements} elements, ${r.stats.frames} frames, ` +
      `${r.stats.texts} text` +
      (r.stats.outsideAll ? `, ${r.stats.outsideAll} outside every frame` : ""),
  );
  if (r.problems.length) {
    console.error(`\n${r.problems.length} problem(s):`);
    r.problems.forEach((p) => console.error("  " + p.message));
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
