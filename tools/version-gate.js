#!/usr/bin/env node
/**
 * Refuses a change to plugin content that ships under a version an install
 * already has.
 *
 * An installed plugin is a cached copy; Claude Code refreshes it when the
 * marketplace's version moves. Merge a new skill or tool under the old version
 * and no install ever sees it — the session keeps loading stale skill text
 * against newer expectations, which is the failure this repo used to document
 * instead of prevent.
 *
 * Reads the two inputs out of git and hands them to the pure decision logic in
 * tools/plugin-version.js:
 *
 *   - the paths that changed since the merge base with the base ref
 *   - each ref's `.claude-plugin/plugin.json` and `package.json` version
 *
 * Usage:
 *   node tools/version-gate.js --base <ref>          # ref: origin/main, a SHA, …
 *   node tools/version-gate.js --base <ref> --head <ref>
 *
 * `--head` defaults to the working tree — uncommitted edits and untracked files
 * included — so the same command answers "would CI pass?" locally and judges an
 * exact commit in CI, where both SHAs are named.
 *
 * Exit codes: 0 the change may merge, 1 it may not (each reason printed), 2 the
 * gate could not run — a ref that does not resolve, a manifest git cannot read.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION_GATE_FLAGS, parseFlags } from "./cli-flags.js";
import { UsageError } from "./errors.js";
import { PACKAGE_MANIFEST, PLUGIN_MANIFEST, checkVersionBump } from "./plugin-version.js";

const USAGE = "usage: version-gate.js --base <ref> [--head <ref>]";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `git …` in the repo root, or a UsageError naming the command that failed. */
function git(...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    throw new UsageError((r.stderr || "git failed").trim(), {
      where: `git ${args.join(" ")}`,
      next: USAGE,
    });
  }
  return r.stdout;
}

/** A manifest's `version` at `ref`, or from the working tree when ref is null. */
function versionAt(ref, path) {
  const raw = ref === null ? readFileSync(join(root, path), "utf8") : git("show", `${ref}:${path}`);
  try {
    return JSON.parse(raw).version;
  } catch {
    throw new UsageError(`${path} is not parseable JSON`, {
      where: ref ?? "working tree",
      next: USAGE,
    });
  }
}

try {
  const { positionals, flags } = parseFlags(process.argv.slice(2), {
    ...VERSION_GATE_FLAGS,
    usage: USAGE,
  });
  if (positionals.length) {
    throw new UsageError(`unexpected argument ${positionals[0]}`, { where: "input", next: USAGE });
  }
  if (!flags.base) throw new UsageError("no base ref given", { where: "--base", next: USAGE });

  // The merge base, not the base ref's tip: a PR is judged on what it changed,
  // not on what the base branch moved on underneath it. `head ?? "HEAD"` keeps
  // the diff and the head version reading the same point when --head is given,
  // and the working tree when it is not.
  const head = flags.head ?? null;
  const mergeBase = git("merge-base", flags.base, head ?? "HEAD").trim();
  const lines = (out) =>
    out
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

  const changedPaths = lines(git("diff", "--name-only", mergeBase, ...(head ? [head] : [])));
  if (!head) {
    // Working-tree mode answers "would CI pass?", and a brand-new skill file is
    // still untracked when it is asked. `git diff` cannot see those, so a local
    // run without this would wave through exactly the change the gate exists
    // for. Ignored files stay out — they never reach an install.
    changedPaths.push(...lines(git("ls-files", "--others", "--exclude-standard")));
  }

  const result = checkVersionBump({
    changedPaths,
    base: {
      plugin: versionAt(mergeBase, PLUGIN_MANIFEST),
      pkg: versionAt(mergeBase, PACKAGE_MANIFEST),
    },
    head: { plugin: versionAt(head, PLUGIN_MANIFEST), pkg: versionAt(head, PACKAGE_MANIFEST) },
  });

  console.log(`base ${mergeBase.slice(0, 8)} · ${changedPaths.length} file(s) changed`);
  console.log(
    result.bumpRequired
      ? `plugin content changed (${result.gated.length} file(s)) — a version bump is required`
      : "no plugin content changed — no version bump required",
  );
  for (const problem of result.problems) console.error(`\nversion gate: ${problem}`);
  console.log(result.ok ? "\nPASS  version gate" : `\nFAIL  version gate`);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`UsageError: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
