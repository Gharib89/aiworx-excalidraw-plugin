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
import { REVISE_FLAGS, parseFlags } from "./cli-flags.js";
import { NamedError, UsageError } from "./errors.js";

const USAGE = "usage: revise.js [--no-svg] [--] <file.excalidraw>";

try {
  const { positionals, flags } = parseFlags(process.argv.slice(2), { ...REVISE_FLAGS, usage: USAGE });
  if (positionals.length === 0) throw new UsageError("no input file given", { where: "input", next: USAGE });
  if (positionals.length > 1) {
    throw new UsageError(`one file at a time, got ${positionals.length}`, { where: "input", next: USAGE });
  }

  await reviseDiagram({ file: positionals[0], svg: !flags["no-svg"] });
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
