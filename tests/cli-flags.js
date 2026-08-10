#!/usr/bin/env node
/**
 * Holds `tools/cli-flags.js` to the CLIs it describes. That module is what
 * `tests/drawn-commands.js` judges a band's drawn `--flag` against, so a stale
 * entry there turns the drawn-command guard into a guard for the wrong thing:
 * a renamed flag would stay green, and a flag the CLIs never took would pass.
 *
 * Checked at the seam — what each CLI does with the flag on its own argv — so
 * the declaration is proved by behavior rather than by matching source text:
 *
 *   1. every declared flag is accepted: the run fails for the missing input,
 *      never for the flag
 *   2. a flag no CLI declares is rejected as unknown
 *
 * Chrome-free: every run here stops in argument parsing, before a browser.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLAGS_BY_SCRIPT } from "../tools/cli-flags.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

/**
 * Both streams of `node tools/<script> <args…>`, run with no input file. Joined
 * rather than kept apart: a CLI's own choice of stream for a usage error is not
 * what these checks are about.
 */
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [join("tools", script), ...args], {
    cwd: root, encoding: "utf8",
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

// ---- 1. every declared flag is one its CLI accepts ----
{
  // No input file is named, so an accepted flag lands on the usage error for the
  // missing file and a rejected one says "unknown flag". A value flag given no
  // value says "needs a value" — accepted too, and the value is the CLI's own
  // business. Naming the flag alone keeps this Chrome-free for every CLI.
  const rejected = [];
  for (const [script, flags] of Object.entries(FLAGS_BY_SCRIPT)) {
    for (const flag of flags) {
      const out = run(script, `--${flag}`);
      if (out.includes("unknown flag")) rejected.push(`${script} --${flag}`);
    }
  }
  check("every flag tools/cli-flags.js declares is accepted by its CLI",
    rejected.length === 0, rejected.join(", ") || "all declared flags accepted");
}

// ---- 2. a flag no CLI declares is rejected ----
{
  // The other half: without this, a declaration listing flags no CLI has would
  // still pass check 1 for the ones that exist, and the drawn-command guard
  // would wave a made-up flag through.
  const accepted = [];
  for (const script of Object.keys(FLAGS_BY_SCRIPT)) {
    if (!run(script, "--no-such-flag").includes("unknown flag")) accepted.push(script);
  }
  check("a flag no CLI declares is rejected as unknown",
    accepted.length === 0, accepted.join(", ") || `${Object.keys(FLAGS_BY_SCRIPT).length} CLIs reject it`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
