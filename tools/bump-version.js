#!/usr/bin/env node
/**
 * Moves the plugin version in the two places that must agree, plus the lockfile
 * that carries package.json's copy — so a contributor who touched plugin content
 * runs one command and passes `tools/version-gate.js`.
 *
 * Usage:
 *   node tools/bump-version.js            # patch
 *   node tools/bump-version.js minor
 *   node tools/bump-version.js major
 *
 * `npm version` owns package.json and package-lock.json — it is the only thing
 * that keeps the lockfile's two copies of the number in step. The plugin
 * manifest is edited as text rather than re-serialised, so the bump changes one
 * line instead of reformatting the file.
 *
 * Choosing the part stays a human judgment (minor for new capability, patch for
 * fixes and polish); this only does the arithmetic and the writing.
 *
 * Exit codes: 0 written, 2 a bad invocation or a manifest that cannot be moved.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BUMP_VERSION_FLAGS, parseFlags } from "./cli-flags.js";
import { UsageError } from "./errors.js";
import { PACKAGE_MANIFEST, PLUGIN_MANIFEST, nextVersion } from "./plugin-version.js";

const USAGE = "usage: bump-version.js [patch|minor|major]";
const PARTS = ["patch", "minor", "major"];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const { positionals } = parseFlags(process.argv.slice(2), { ...BUMP_VERSION_FLAGS, usage: USAGE });
  if (positionals.length > 1) {
    throw new UsageError(`one part at a time, got ${positionals.length}`, {
      where: "input",
      next: USAGE,
    });
  }
  const part = positionals[0] ?? "patch";
  if (!PARTS.includes(part)) {
    throw new UsageError(`unknown part ${part}`, { where: "input", next: USAGE });
  }

  const pkgPath = join(root, PACKAGE_MANIFEST);
  const pluginPath = join(root, PLUGIN_MANIFEST);
  const current = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  const next = nextVersion(current, part);
  if (!next) {
    throw new UsageError(`current version "${current}" is not a major.minor.patch semver`, {
      where: PACKAGE_MANIFEST,
      next: "fix it by hand, then re-run",
    });
  }

  // Both edits are prepared before either is written. `npm version` is a
  // subprocess and cannot be rolled back, so a plugin manifest that does not
  // carry the expected line has to stop the run *before* it — otherwise the
  // helper's own failure leaves the two manifests disagreeing, which is exactly
  // the state the gate refuses.
  //
  // Anchored on the current value so this can only ever move the version line,
  // never some other "version" the manifest might grow later.
  const before = readFileSync(pluginPath, "utf8");
  const after = before.replace(`"version": "${current}"`, `"version": "${next}"`);
  if (after === before) {
    throw new UsageError(`no "version": "${current}" line to move`, {
      where: PLUGIN_MANIFEST,
      next: `make it agree with ${PACKAGE_MANIFEST} ("${current}") first, then re-run`,
    });
  }

  const r = spawnSync("npm", ["version", "--no-git-tag-version", next], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32", // npm is a .cmd shim on Windows
  });
  if (r.status !== 0) {
    throw new UsageError((r.stderr || "npm version failed").trim(), {
      where: `npm version ${next}`,
      next: "resolve the npm error, then re-run",
    });
  }

  writeFileSync(pluginPath, after);

  console.log(`${current} -> ${next}  (${PACKAGE_MANIFEST}, ${PLUGIN_MANIFEST}, package-lock.json)`);
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`UsageError: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
