#!/usr/bin/env node
/**
 * Round-trip a hand-edited .excalidraw file back through the pipeline: text
 * metrics are recomputed with the real fonts, bindings and frame membership are
 * repaired, the gate runs, and the file plus its SVG are rewritten in place.
 * CLI face of reviseDiagram in tools/author.js.
 *
 * Usage:
 *   node tools/revise.js diagram.excalidraw [--no-svg]
 *
 * Exit codes match the other CLIs: 2 for an invocation that never named a file
 * to revise, 1 for a document the pipeline refuses — unparseable, foreign, or
 * failing the gate — with nothing written in either case.
 */
import { reviseDiagram, DocumentError, GateError } from "./author.js";
import { UsageError } from "./errors.js";

const USAGE = "usage: revise.js <file.excalidraw> [--no-svg]";

try {
  const argv = process.argv.slice(2);
  const positional = [];
  let svg = true;
  for (const a of argv) {
    if (!a.startsWith("--")) {
      positional.push(a);
    } else if (a === "--no-svg") {
      svg = false;
    } else {
      throw new UsageError(`unknown flag ${a}\n${USAGE}`);
    }
  }
  if (positional.length === 0) throw new UsageError(USAGE);
  if (positional.length > 1) {
    throw new UsageError(`one file at a time, got ${positional.length}\n${USAGE}`);
  }

  await reviseDiagram({ file: positional[0], svg });
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`UsageError: ${err.message}`);
    process.exit(2);
  }
  if (err instanceof DocumentError || err instanceof GateError) {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
