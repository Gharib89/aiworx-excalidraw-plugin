/**
 * What each CLI accepts, named in one place, so a guard can read the inventory
 * without running a CLI: `check.js`, `revise.js` and `library.js` parse
 * `process.argv` at module top level, so importing one to ask what it takes would
 * execute the tool. `tests/drawn-commands.js` holds a band's drawn `--flag` to the flags of
 * the script it follows; `tests/cli-flags.js` holds this declaration to what the
 * CLIs really do with those flags, which is what keeps the two from drifting.
 *
 * The declarations are the parser's input, not a parallel statement: each CLI
 * hands its own `{ bool, value }` pair to `parseFlags` below, so "this flag
 * consumes the next argument" is data the parser enforces rather than a comment
 * beside a hand-rolled loop. Each CLI keeps its semantic validation — flag
 * combinations, numeric ranges, file counts — and its own exit-code tail.
 *
 * The flags are public surface. This module is not.
 */
import { UsageError } from "./errors.js";

/** check.js selects output only — verification takes no options. */
export const CHECK_FLAGS = { bool: new Set(["json"]), value: new Set() };
export const RENDER_FLAGS = {
  bool: new Set(["no-frames", "dark"]),
  value: new Set(["out", "scale", "frame", "padding", "background"]),
};
export const REVISE_FLAGS = { bool: new Set(["no-svg"]), value: new Set() };
/** library.js: `--download` consumes the next argument, the rest stand alone. */
export const LIBRARY_FLAGS = {
  bool: new Set(["json", "refresh", "stale"]),
  value: new Set(["download"]),
};

/**
 * Every flag a script accepts, keyed by the file name a drawn command names.
 * `--` is absent on purpose: it ends the flags rather than being one.
 */
export const FLAGS_BY_SCRIPT = Object.fromEntries(
  Object.entries({
    "check.js": CHECK_FLAGS,
    "render.js": RENDER_FLAGS,
    "revise.js": REVISE_FLAGS,
    "library.js": LIBRARY_FLAGS,
  }).map(([script, { bool, value }]) => [script, new Set([...bool, ...value])]),
);

/**
 * The one argv loop behind every CLI face. Splits `argv` into
 * `{ positionals, flags }` — bool flags land as `true`, value flags as the
 * argument they consumed — and throws UsageError for anything else, with the
 * caller's usage line as the next step.
 *
 * Any unrecognised dash-prefixed argument is a typo, not a path: `-json` read
 * as a file name turns a mistyped flag into a confusing "cannot read" — or,
 * worse, silently drops the flag when a real file is named too. A positional
 * that genuinely starts with a dash goes after `--`.
 */
export function parseFlags(argv, { bool, value, usage }) {
  const positionals = [];
  const flags = {};
  let literal = false; // everything after -- is positional, even if it looks like a flag
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (literal || !a.startsWith("-")) {
      positionals.push(a);
      continue;
    }
    if (a === "--") {
      literal = true;
      continue;
    }
    if (!a.startsWith("--")) throw new UsageError("unknown flag", { where: a, next: usage });
    const name = a.slice(2);
    if (bool.has(name)) {
      flags[name] = true;
    } else if (value.has(name)) {
      const v = argv[++i];
      if (v === undefined) {
        throw new UsageError("needs a value", { where: `--${name}`, next: usage });
      }
      // A dash-prefixed token is a flag under the same rule, never this flag's
      // value: `--out -dark` must not create a directory named "-dark". Name the
      // token — a value *was* given, so a bare "needs a value" reads as a lie.
      if (v.startsWith("-")) {
        throw new UsageError(`needs a value, got ${v}`, { where: `--${name}`, next: usage });
      }
      flags[name] = v;
    } else {
      throw new UsageError("unknown flag", { where: `--${name}`, next: usage });
    }
  }
  return { positionals, flags };
}
