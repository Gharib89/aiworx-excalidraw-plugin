/**
 * The version gate's decision logic, and the arithmetic the bump helper uses.
 *
 * An install of this plugin is a cached copy. Claude Code refreshes it when the
 * marketplace's version moves, so a change to plugin content that ships under a
 * version an install already has never reaches that install: the session keeps
 * loading the old skill text against the new expectations. The gate makes that
 * impossible to merge — a change to gated content must arrive with a strictly
 * greater version than the base ref carried.
 *
 * Everything here is pure: the changed paths and the two refs' manifest versions
 * come in, a verdict goes out. Reading them out of git is tools/version-gate.js.
 *
 * This module is not public surface; the two CLIs that wrap it are.
 */

/**
 * Path prefixes whose content reaches an installed copy and is *loaded* by a
 * session — the skill text, the tools it invokes, the committed browser bundle,
 * the brand assets, and the manifests themselves.
 *
 * The repo ships wholesale (marketplace source is `./`), so plenty of other
 * paths land in an install too. They are deliberately ungated: `tests/`,
 * `docs/`, `examples/`, `.github/` and the root prose change nothing a session
 * loads, and gating them would demand a version bump for every typo fix.
 */
export const GATED_PREFIXES = ["skills", "tools", "dist", "brand", ".claude-plugin"];

/** Where the version lives, twice, and must agree. */
export const PLUGIN_MANIFEST = ".claude-plugin/plugin.json";
export const PACKAGE_MANIFEST = "package.json";

const BUMP_HELPER = "node tools/bump-version.js <patch|minor|major>";

/**
 * `major.minor.patch`, all three plain non-negative integers with no leading
 * zeros — the shape both manifests must carry. Prereleases and build metadata
 * are rejected on purpose: a marketplace compares released versions, and this
 * repo has never shipped one.
 *
 * Returns null rather than throwing, so a caller can report the offending value
 * instead of a stack.
 */
export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

/** Negative / zero / positive, the sort-comparator convention. */
export function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * The subset of `paths` that lives under a gated prefix.
 *
 * Matching is on path segments, not string prefixes: `toolsmith/x.js` is not
 * `tools/`, and treating it as such would demand bumps for changes that reach
 * no install.
 */
export function gatedPaths(paths) {
  return paths.filter((p) => GATED_PREFIXES.some((g) => p === g || p.startsWith(`${g}/`)));
}

/**
 * The gate's verdict for one change.
 *
 * `base` and `head` are each `{ plugin, pkg }` — the raw version strings from
 * the two manifests at that ref. Returns
 * `{ ok, bumpRequired, gated, problems }`; every problem names the offending
 * value and the next action, because the CI log is the only place a contributor
 * reads it.
 */
export function checkVersionBump({ changedPaths, base, head }) {
  const problems = [];
  const gated = gatedPaths(changedPaths);
  const bumpRequired = gated.length > 0;

  // The single-source-of-truth rule holds on every change, gated or not: the
  // two manifests drifting apart is a release bug waiting to happen, and it is
  // free to catch here.
  if (head.plugin !== head.pkg) {
    problems.push(
      `version mismatch: ${PACKAGE_MANIFEST} says "${head.pkg}" but ${PLUGIN_MANIFEST} says "${head.plugin}" — run ${BUMP_HELPER} to set both`,
    );
  }

  const headVersion = parseSemver(head.plugin);
  if (!headVersion) {
    problems.push(
      `${PLUGIN_MANIFEST} version "${head.plugin}" is not a major.minor.patch semver — run ${BUMP_HELPER}`,
    );
  }
  if (!parseSemver(head.pkg)) {
    problems.push(
      `${PACKAGE_MANIFEST} version "${head.pkg}" is not a major.minor.patch semver — run ${BUMP_HELPER}`,
    );
  }

  if (bumpRequired) {
    const baseVersion = parseSemver(base.plugin);
    if (!baseVersion) {
      // Not the contributor's fault, but waving the change through would ship
      // gated content under a version nothing can compare.
      problems.push(
        `the base ref's ${PLUGIN_MANIFEST} version "${base.plugin}" is not a semver, so no bump can be verified — fix the base branch first`,
      );
    } else if (headVersion && compareSemver(headVersion, baseVersion) <= 0) {
      problems.push(
        `${gated.length} plugin-content file(s) changed (${gated.slice(0, 5).join(", ")}${gated.length > 5 ? ", …" : ""}) but the version did not increase: base "${base.plugin}", head "${head.plugin}" — run ${BUMP_HELPER}`,
      );
    }
  }

  return { ok: problems.length === 0, bumpRequired, gated, problems };
}

/**
 * The next version after `current` for the named part, or null if `current` is
 * unparseable. Lower parts reset — 0.5.3 minor is 0.6.0, not 0.6.3.
 */
export function nextVersion(current, part) {
  const v = parseSemver(current);
  if (!v) return null;
  if (part === "major") return `${v.major + 1}.0.0`;
  if (part === "minor") return `${v.major}.${v.minor + 1}.0`;
  if (part === "patch") return `${v.major}.${v.minor}.${v.patch + 1}`;
  return null;
}
