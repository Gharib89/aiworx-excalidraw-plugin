#!/usr/bin/env node
/**
 * Guards the commands a committed band *draws*. Canvas text is documentation a
 * reader retypes, and it is the one kind this repo cannot fix by editing a file:
 * the string is baked into the committed `.excalidraw` and its SVG, so
 * correcting it means regenerating both. That is how the plugin tour went on
 * teaching `CLAUDE_PLUGIN_ROOT=<plugin> node gen-tour.js` for a release after
 * the shipped skill had moved on — a docs pass never reaches it. Three checks:
 *
 *   1. no drawn invocation prefixes `CLAUDE_PLUGIN_ROOT` — reference/authoring.md
 *      leads with the argument form because it survives a `Bash(node:*)`
 *      allowlist, which an env-prefixed command line does not. That one variable
 *      stands in for the form: it is the only environment a generator here reads
 *   2. every script a drawn command names exists on disk
 *   3. the committed SVG does not prefix it either — one generator run writes
 *      both files, so the SVG holding a string the diagram dropped is the
 *      readable sign of a partial regenerate
 *
 * Only the plugin tour draws commands; `examples/example.excalidraw` draws none.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const DIAGRAM = "examples/plugin-tour/plugin-tour.excalidraw";
const SVG = "examples/plugin-tour/plugin-tour.svg";

const drawn = JSON.parse(readFileSync(join(root, DIAGRAM), "utf8"))
  .elements.filter((e) => e.type === "text")
  .map((e) => e.text ?? "");

// ---- 1. no drawn invocation prefixes CLAUDE_PLUGIN_ROOT ----
{
  // The guard is the variable, not one spelling of a command line: nothing has a
  // reason to *draw* the name, and any `NAME=<value> node` shape would be fooled
  // by a quoted value containing a space. Named for the variable rather than for
  // the env-prefix form, so a failure says what was actually found.
  const prefixed = drawn.filter((t) => t.includes("CLAUDE_PLUGIN_ROOT="));
  check("no drawn invocation prefixes CLAUDE_PLUGIN_ROOT",
    prefixed.length === 0, prefixed.join(" | ") || `${drawn.length} strings clean`);
}

// ---- 2. every script a drawn command names exists ----
{
  // The operand of a drawn `node` only — elsewhere the band labels modules
  // (`author.js`, `verify.js + check.js`), which name no path and resolve
  // nowhere. Flags before the operand are skipped so `node --flag gen.js` stays
  // covered. A drawn relative path means one of two roots: the checkout, as the
  // `tools/…` steps use, or the example's own directory, where its generator runs.
  const bases = [root, join(root, dirname(DIAGRAM))];
  const missing = [];
  for (const text of drawn) {
    for (const [, script] of text.matchAll(/\bnode\s+(?:-\S+\s+)*(\S+\.m?js)\b/g)) {
      if (!bases.some((base) => existsSync(join(base, script)))) {
        missing.push(`${script} (in "${text}")`);
      }
    }
  }
  check("every script a drawn command names exists",
    missing.length === 0, missing.join(" | ") || "all drawn scripts resolve");
}

// ---- 3. the committed SVG does not prefix it either ----
{
  // The SVG is what a README or a PR preview shows, so a half-finished
  // regenerate keeps publishing the string the diagram no longer holds. Checking
  // the one variable, not the whole export: the two files agreeing in full is
  // the generator's job, and re-deriving the SVG here would need a browser.
  const svg = readFileSync(join(root, SVG), "utf8");
  check("the committed SVG does not prefix CLAUDE_PLUGIN_ROOT either",
    !svg.includes("CLAUDE_PLUGIN_ROOT="), SVG);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
