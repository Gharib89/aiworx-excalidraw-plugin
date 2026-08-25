#!/usr/bin/env node
/**
 * The version gate's decision logic — the pure half of tools/plugin-version.js.
 *
 * The gate exists so a merged change to plugin content can never ship under a
 * version an install already has: a cached copy would then never refresh, and
 * the session would load stale skill text against newer tools. Everything the
 * gate decides is a function of three inputs — the changed paths, the base
 * ref's two manifests, the head's two manifests — so it is provable here
 * without git, a network, or Chrome.
 *
 * The CLI half (reading those inputs out of git) is proven by the gate running
 * against this very PR in CI.
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GATED_PREFIXES,
  checkVersionBump,
  compareSemver,
  gatedPaths,
  nextVersion,
  parseSemver,
} from "../tools/plugin-version.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.log(`FAIL  ${name}  — ${err.message}`);
    fail.push(name);
  }
};

/** A base/head pair; both manifests agree unless a case says otherwise. */
const at = (version, pkgVersion = version) => ({ plugin: version, pkg: pkgVersion });

// ---- semver parsing ----

check("parses a plain three-part version", () => {
  deepStrictEqual(parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3 });
});

check("rejects everything that is not exactly three numeric parts", () => {
  for (const bad of ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "01.2.3", "1.2.3-rc.1", "", " 1.2.3"]) {
    strictEqual(parseSemver(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

check("orders versions numerically, not lexically", () => {
  ok(compareSemver(parseSemver("0.10.0"), parseSemver("0.9.0")) > 0);
  ok(compareSemver(parseSemver("1.0.0"), parseSemver("0.99.99")) > 0);
  strictEqual(compareSemver(parseSemver("2.3.4"), parseSemver("2.3.4")), 0);
});

// ---- which paths demand a bump ----

check("plugin content is gated", () => {
  const gated = [
    "skills/excalidraw-diagram/SKILL.md",
    "skills/excalidraw-diagram/reference/authoring.md",
    "tools/author.js",
    "dist/excalidraw-page.js",
    "brand/logo.png",
    ".claude-plugin/plugin.json",
  ];
  deepStrictEqual(gatedPaths(gated), gated);
});

check("repo-only content is not gated", () => {
  deepStrictEqual(
    gatedPaths([
      "tests/gate.js",
      "docs/adr/0001-x.md",
      "examples/band.excalidraw",
      ".github/workflows/ci.yml",
      "README.md",
      "CLAUDE.md",
      "package.json",
    ]),
    [],
  );
});

check("a prefix match is a path-segment match, not a string prefix", () => {
  deepStrictEqual(gatedPaths(["toolsmith/x.js", "skills-old/SKILL.md", "distant.md"]), []);
});

// ---- the gate's verdict ----

check("a gated change with a bumped version passes", () => {
  const r = checkVersionBump({
    changedPaths: ["tools/author.js"],
    base: at("0.5.0"),
    head: at("0.6.0"),
  });
  strictEqual(r.ok, true, r.problems.join("; "));
  strictEqual(r.bumpRequired, true);
});

check("a gated change with an unchanged version fails and names the fix", () => {
  const r = checkVersionBump({
    changedPaths: ["skills/excalidraw-diagram/SKILL.md"],
    base: at("0.5.0"),
    head: at("0.5.0"),
  });
  strictEqual(r.ok, false);
  const said = r.problems.join("\n");
  ok(said.includes("0.5.0"), `problem should name the offending version: ${said}`);
  ok(said.includes("bump-version.js"), `problem should name the helper: ${said}`);
});

check("a gated change with a decreasing version fails", () => {
  const r = checkVersionBump({
    changedPaths: ["dist/excalidraw-page.js"],
    base: at("0.5.0"),
    head: at("0.4.9"),
  });
  strictEqual(r.ok, false);
  ok(r.problems.join("\n").includes("0.4.9"));
});

check("a change that touches nothing gated passes without a bump", () => {
  const r = checkVersionBump({
    changedPaths: ["tests/gate.js", "README.md"],
    base: at("0.5.0"),
    head: at("0.5.0"),
  });
  strictEqual(r.ok, true, r.problems.join("; "));
  strictEqual(r.bumpRequired, false);
});

check("the two manifests must agree, gated change or not", () => {
  const r = checkVersionBump({
    changedPaths: ["README.md"],
    base: at("0.5.0"),
    head: at("0.6.0", "0.5.0"),
  });
  strictEqual(r.ok, false);
  const said = r.problems.join("\n");
  ok(said.includes("package.json"), said);
  ok(said.includes(".claude-plugin/plugin.json"), said);
});

check("a malformed head version fails and names the offending value", () => {
  const r = checkVersionBump({
    changedPaths: ["tools/author.js"],
    base: at("0.5.0"),
    head: at("0.6", "0.6"),
  });
  strictEqual(r.ok, false);
  ok(r.problems.join("\n").includes('"0.6"'), r.problems.join("\n"));
});

check("a malformed base version fails rather than waving the change through", () => {
  const r = checkVersionBump({
    changedPaths: ["tools/author.js"],
    base: at("not-a-version"),
    head: at("0.6.0"),
  });
  strictEqual(r.ok, false);
  ok(r.problems.join("\n").includes("not-a-version"));
});

// ---- the bump helper's arithmetic ----

check("nextVersion increments the named part and zeroes the ones below it", () => {
  strictEqual(nextVersion("0.5.3", "patch"), "0.5.4");
  strictEqual(nextVersion("0.5.3", "minor"), "0.6.0");
  strictEqual(nextVersion("0.5.3", "major"), "1.0.0");
});

check("nextVersion refuses an unparseable current version", () => {
  strictEqual(nextVersion("0.5", "patch"), null);
});

// ---- the repo the gate guards ----

check("this repo's two manifests already agree on a valid version", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const plugin = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8")).version;
  ok(parseSemver(pkg), `package.json version is not semver: ${pkg}`);
  strictEqual(plugin, pkg);
});

check("every gated prefix names something that exists in this repo", () => {
  for (const prefix of GATED_PREFIXES) {
    ok(
      readFileSync !== undefined && existsInRepo(prefix),
      `gated prefix ${prefix} does not exist — the gate would silently never fire on it`,
    );
  }
});

function existsInRepo(prefix) {
  try {
    readFileSync(join(root, prefix));
    return true;
  } catch (err) {
    // EISDIR means the path is there and is a directory, which is what a
    // prefix normally names; only "not found" is the failure this asserts.
    return err.code === "EISDIR";
  }
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nversion gate holds");
process.exit(fail.length ? 1 : 0);
