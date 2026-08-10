#!/usr/bin/env node
/**
 * Round-trip a hand-edited .excalidraw file back through the pipeline: text
 * metrics are recomputed with the real fonts, bindings and frame membership are
 * repaired, the gate runs, and the file plus its SVG are rewritten in place.
 * CLI face of reviseDiagram in tools/author.js.
 *
 * Usage:
 *   node tools/revise.js [--no-svg] [--] diagram.excalidraw
 *
 * `--` ends the flags: the next argument is the file even if it starts with a
 * dash. Any other dash-prefixed argument is rejected as a typo rather than read
 * as a file name.
 *
 * Exit codes match the other CLIs: 2 for an invocation that never named a file
 * to revise, 1 for a document the pipeline refuses — unparseable, foreign, or
 * failing the gate — with nothing written in either case.
 */
import { reviseDiagram } from "./author.js";
import { NamedError, UsageError } from "./errors.js";

const USAGE = "usage: revise.js [--no-svg] [--] <file.excalidraw>";

try {
  const argv = process.argv.slice(2);
  const positional = [];
  let svg = true;
  let literal = false; // everything after -- is a path, even if it looks like a flag
  // Any unrecognised dash-prefixed argument is a typo, not a path: `-no-svg` read
  // as a file name turns a mistyped flag into a confusing "cannot read", or, with
  // a real file named too, gets blamed on the file count instead of itself. A path
  // that genuinely starts with a dash goes after `--`.
  for (const a of argv) {
    if (literal || !a.startsWith("-")) {
      positional.push(a);
    } else if (a === "--") {
      literal = true;
    } else if (a === "--no-svg") {
      svg = false;
    } else {
      throw new UsageError("unknown flag", { where: a, next: USAGE });
    }
  }
  if (positional.length === 0) throw new UsageError("no input file given", { where: "input", next: USAGE });
  if (positional.length > 1) {
    throw new UsageError(`one file at a time, got ${positional.length}`, { where: "input", next: USAGE });
  }

  await reviseDiagram({ file: positional[0], svg });
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`UsageError: ${err.message}`);
    process.exit(2);
  }
  // One branch for every named error: the document and gate refusals this CLI
  // owns, and whatever the pipeline beneath raises — a stale bundle, no Chrome,
  // an uninstalled checkout. A stack trace is for a bug in this code alone.
  if (err instanceof NamedError) {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
