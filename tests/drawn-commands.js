#!/usr/bin/env node
/**
 * Guards the commands a committed band *draws*. Canvas text is documentation a
 * reader retypes, and it is the one kind this repo cannot fix by editing a file:
 * the string is baked into the committed `.excalidraw` and its SVG, so
 * correcting it means regenerating both. That is how the plugin tour went on
 * teaching `CLAUDE_PLUGIN_ROOT=<plugin> node gen-tour.js` for a release after
 * the shipped skill had moved on — a docs pass never reaches it. Four checks,
 * after one that proves the walk below found anything at all:
 *
 *   1. no drawn invocation prefixes `CLAUDE_PLUGIN_ROOT` — reference/authoring.md
 *      leads with the argument form because it survives a `Bash(node:*)`
 *      allowlist, which an env-prefixed command line does not. That one variable
 *      stands in for the form: it is the only environment a generator here reads
 *   2. every script a drawn command names exists on disk
 *   3. the committed SVGs do not prefix it either — one generator run writes
 *      both files, so an SVG holding a string its diagram dropped is the
 *      readable sign of a partial regenerate
 *   4. every drawn `--flag` is one the CLI it follows accepts — flags are public
 *      surface, so a rename is allowed in a minor release, and the drawn text is
 *      never executed, so nothing else rejects the old name
 *
 * Every committed `.excalidraw` and `.svg` under `examples/` is walked, so the
 * next band this repo commits arrives under the guard with no edit here. The
 * deliberately-broken inputs under `tests/fixtures/` are out of the walk by
 * construction — they live under `tests/`, and their text is a defect on
 * purpose. A band that draws no command simply contributes no strings.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLAGS_BY_SCRIPT } from "../tools/cli-flags.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

/** Every committed `.excalidraw` and `.svg` under `dir`, at any depth. */
const artifacts = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? artifacts(`${dir}/${e.name}`)
      : /\.(excalidraw|svg)$/.test(e.name) ? [`${dir}/${e.name}`]
      : [],
  );

const committedArtifacts = artifacts("examples");
const diagrams = committedArtifacts.filter((f) => f.endsWith(".excalidraw"));
const svgs = committedArtifacts.filter((f) => f.endsWith(".svg"));

// `originalText` is the string as authored; `text` is the same string with any
// line break Excalidraw inserted to wrap it. A break landing mid-command would
// hide it from the guards below, so read what was typed and fall back.
const drawnIn = (file) =>
  JSON.parse(readFileSync(join(root, file), "utf8"))
    .elements.filter((e) => e.type === "text")
    .map((e) => e.originalText ?? e.text ?? "");

/** Each drawn string paired with the artifact it came from, so a failure locates itself. */
const drawn = diagrams.flatMap((file) => drawnIn(file).map((text) => ({ file, text })));

// ---- 0. the walk found the committed bands ----
{
  // Every check below is a filter over `drawn`: a walk that returned nothing
  // would report all of them green. The floor is the artifacts this repo commits
  // in pairs, so the count is not pinned — only that both kinds were found.
  check("the walk finds committed diagrams and SVGs",
    diagrams.length > 0 && svgs.length > 0,
    `${diagrams.length} diagram(s), ${svgs.length} SVG(s)`);
}

// ---- 1. no drawn invocation prefixes CLAUDE_PLUGIN_ROOT ----
{
  // The guard is the variable, not one spelling of a command line: nothing has a
  // reason to *draw* the name, and any `NAME=<value> node` shape would be fooled
  // by a quoted value containing a space. Named for the variable rather than for
  // the env-prefix form, so a failure says what was actually found.
  const prefixed = drawn.filter(({ text }) => text.includes("CLAUDE_PLUGIN_ROOT="));
  check("no drawn invocation prefixes CLAUDE_PLUGIN_ROOT", prefixed.length === 0,
    prefixed.map(({ file, text }) => `${file}: ${text}`).join(" | ")
      || `${drawn.length} strings clean`);
}

// ---- 2. every script a drawn command names exists ----
{
  // The operand of a drawn `node` only — elsewhere a band labels modules
  // (`author.js`, `verify.js + check.js`), which name no path and resolve
  // nowhere. Flags before the operand are skipped so `node --flag gen.js` stays
  // covered. A drawn relative path means one of two roots: the checkout, as the
  // `tools/…` steps use, or the band's own directory, where its generator runs.
  const missing = [];
  for (const { file, text } of drawn) {
    const bases = [root, join(root, dirname(file))];
    for (const [, script] of text.matchAll(/\bnode\s+(?:-\S+\s+)*(\S+\.m?js)\b/g)) {
      if (!bases.some((base) => existsSync(join(base, script)))) {
        missing.push(`${file}: ${script} (in "${text}")`);
      }
    }
  }
  check("every script a drawn command names exists",
    missing.length === 0, missing.join(" | ") || "all drawn scripts resolve");
}

// ---- 3. the committed SVGs do not prefix it either ----
{
  // An SVG is what a README or a PR preview shows, so a half-finished
  // regenerate keeps publishing the string the diagram no longer holds. Checking
  // the one variable, not the whole export: the two files agreeing in full is
  // the generator's job, and re-deriving an SVG here would need a browser.
  const prefixed = svgs.filter((f) => readFileSync(join(root, f), "utf8").includes("CLAUDE_PLUGIN_ROOT="));
  check("no committed SVG prefixes CLAUDE_PLUGIN_ROOT either",
    prefixed.length === 0, prefixed.join(", ") || `${svgs.length} SVG(s) clean`);
}

// ---- 4. every drawn flag belongs to the inventory of the CLI it follows ----
{
  // Flags are public surface, so a rename is allowed in a minor release — and a
  // band drawing the old name would go on teaching a command that exits 2, with
  // nothing red: drawn text is never executed, so the CLI's own unknown-flag
  // rejection never fires on it. The inventories come from tools/cli-flags.js,
  // which tests/cli-flags.js holds to what the CLIs really accept.
  const everyInventory = new Set(Object.values(FLAGS_BY_SCRIPT).flatMap((s) => [...s]));
  const unknown = [];
  for (const { file, text } of drawn) {
    // One pass in reading order, so each flag is judged against the script most
    // recently named before it. A flag with no script ahead of it — the tour's
    // "iterate with --frame N, --dark" caption — is held to the union of every
    // inventory instead: a renamed flag belongs to none of them either way, and
    // guessing an owner would blame the wrong CLI. A script this repo keeps no
    // inventory for (a generator) hands the rest of the string to the union too.
    // One drawn element is one scope: a string naming a CLI and then discussing
    // another CLI's flag reads as the first one's, so keep each drawn command,
    // and the prose about it, in its own element — which is how a band lays a
    // command and its caption out anyway.
    let script = null;
    for (const [token] of text.matchAll(/[\w-]+\.m?js|--[a-z][a-z\d-]*/g)) {
      if (!token.startsWith("--")) {
        script = FLAGS_BY_SCRIPT[token] ? token : null;
      } else if (!(script ? FLAGS_BY_SCRIPT[script] : everyInventory).has(token.slice(2))) {
        unknown.push(`${file}: ${token} after ${script ?? "no CLI"} (in "${text}")`);
      }
    }
  }
  check("every drawn flag belongs to the CLI it follows",
    unknown.length === 0, unknown.join(" | ") || "all drawn flags are real");
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
