#!/usr/bin/env node
/**
 * Unit suite for parseFlags, the one argv loop behind all four CLI faces.
 * `tests/cli-flags.js` proves each CLI still honors its declared flags at the
 * spawn seam; this file proves the parser's own contract once, at the function
 * seam — the rules every CLI now inherits instead of hand-rolling:
 *
 *   - positionals pass through, flags land keyed by name
 *   - `--` ends the flags; everything after is positional however it looks
 *   - any unrecognised dash-prefixed argument is a typo, not a path
 *   - a value flag consumes exactly the next argument — and never a
 *     dash-prefixed one, so `--out -dark` cannot become a directory (the
 *     value-swallow guard, ADR-0001's one recorded near-miss)
 *
 * Chrome-free: pure function, no spawn, no browser.
 */
import { parseFlags } from "../tools/cli-flags.js";
import { UsageError } from "../tools/errors.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const USAGE = "usage: test.js [--flag] [--val V] [--] <file>";
const spec = { bool: new Set(["flag"]), value: new Set(["val"]), usage: USAGE };

/** Run parseFlags and hand back either the result or the thrown error. */
const parse = (...argv) => {
  try {
    return { result: parseFlags(argv, spec) };
  } catch (err) {
    return { err };
  }
};

// ---- the happy paths ----
{
  const { result } = parse("a.excalidraw", "--flag", "--val", "x", "b.excalidraw");
  check("positionals and flags separate cleanly",
    result?.positionals.join(",") === "a.excalidraw,b.excalidraw" &&
      result.flags.flag === true && result.flags.val === "x",
    JSON.stringify(result));

  const bare = parse().result;
  check("an empty argv parses to nothing", bare.positionals.length === 0 && Object.keys(bare.flags).length === 0);

  const empty = parse("").result;
  check("an empty-string argument is a positional", empty.positionals.join(",") === "");
}

// ---- `--` ends the flags ----
{
  const { result } = parse("--flag", "--", "--val", "-x", "--");
  check("everything after -- is positional, even flag lookalikes",
    result?.positionals.join(",") === "--val,-x,--" && result.flags.flag === true,
    JSON.stringify(result));
}

// ---- rejections: every one a UsageError carrying the usage line ----
{
  const unknown = parse("--bogus").err;
  check("an unknown --flag is a UsageError naming it",
    unknown instanceof UsageError && unknown.where === "--bogus" && unknown.what === "unknown flag",
    String(unknown));

  const single = parse("-flag").err;
  check("a single-dash token is a typo, not a path",
    single instanceof UsageError && single.where === "-flag" && single.what === "unknown flag",
    String(single));

  const dash = parse("-").err;
  check("a bare dash is rejected too", dash instanceof UsageError && dash.where === "-", String(dash));

  const missing = parse("--val").err;
  check("a value flag at the end asks for its value",
    missing instanceof UsageError && missing.where === "--val" && missing.what === "needs a value",
    String(missing));

  // The value-swallow guard: a dash-prefixed token is a flag under the same
  // rule, never this flag's value — and the token is named, because a value
  // *was* given and a bare "needs a value" would read as a lie.
  const swallowed = parse("--val", "--flag").err;
  check("a value flag will not swallow the next flag",
    swallowed instanceof UsageError && swallowed.where === "--val" &&
      swallowed.what === "needs a value, got --flag",
    String(swallowed));

  check("every rejection carries the usage line as its next step",
    [unknown, single, missing, swallowed].every((e) => e?.next === USAGE));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
