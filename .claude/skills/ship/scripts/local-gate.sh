#!/usr/bin/env bash
# Local gate (ship phase 5): run the checks CI runs, print one line per check
# plus the failing output only. Exit 0 = all green.
#
#   scripts/local-gate.sh                       # full gate
#   scripts/local-gate.sh --small <test-file>   # small lane: fingerprint check +
#                                               # the one proving test file
#
# Mirrors .github/workflows/ci.yml: the full `npm test` suite (browser smoke
# included), the verification-must-not-dirty-the-repo check, and — when a bundle
# input changed — the bundle job (rebuild from the locked toolchain, rebuilt
# dist/ must match the committed one, then gate the clean fixture). The one
# thing it can't run is the macOS/Windows matrix legs.
#
# Works from the main checkout or a worktree: installs node_modules if absent
# (runtime deps only; full dev install when a bundle input changed).
set -u

ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1

SMALL_NODE=""
if [ "${1:-}" = "--small" ]; then
  SMALL_NODE="${2:?--small needs a test file (e.g. tests/gate.js)}"
fi

# Bundle inputs = what tools/fingerprint.js hashes: page source, bundler config,
# and lockfile-resolved dep versions.
BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD || echo origin/main)
BUNDLE_CHANGED=0
git diff --quiet "$BASE"...HEAD -- tools/page.js tools/bundle.js package-lock.json 2>/dev/null \
  || BUNDLE_CHANGED=1

if [ ! -d node_modules ]; then
  if [ "$BUNDLE_CHANGED" -eq 1 ]; then npm ci >/dev/null || exit 1
  else npm ci --omit=dev >/dev/null || exit 1; fi
elif [ "$BUNDLE_CHANGED" -eq 1 ] && [ ! -d node_modules/esbuild ]; then
  npm ci >/dev/null || exit 1   # rebundling needs the dev deps
fi

NAMES=(); RCS=(); LOGS=()
run() { # run <name> <cmd...>
  local name="$1"; shift
  local log rc
  log=$(mktemp)
  "$@" >"$log" 2>&1
  rc=$?
  NAMES+=("$name"); RCS+=("$rc"); LOGS+=("$log")
  if [ "$rc" -eq 0 ]; then echo "PASS $name"; else echo "FAIL $name (exit $rc)"; fi
}

# Stale-bundle check: browser.js refuses a mismatched stamp, so catch it here
# with a named check instead of an opaque mid-suite failure.
fingerprint_check() {
  node --input-type=module -e '
    const m = await import("./tools/fingerprint.js");
    const expected = m.expectedFingerprint();
    const stamped = m.stampedFingerprint("dist/excalidraw-page.js");
    if (expected !== stamped) {
      console.error(`stale bundle: stamped ${stamped ?? "none"}, sources expect ${expected} — run npm run bundle and commit dist/`);
      process.exit(1);
    }
    console.log(`fingerprint ${expected} matches`);'
}

# Bytes AND paths: `git diff` alone misses an added file (renamed woff2, or a
# new dist/ path .gitignore's by-name un-ignores would drop). Mirrors ci.yml.
dist_unchanged() {
  git diff --quiet -- dist/ && [ -z "$(git status --porcelain --ignored dist/)" ]
}

# The one thing CI cannot answer: has this branch seen every commit on its base?
# A branch that predates a merge still diffs and merges clean — CI tests the
# merge ref, and nothing here is textual — but every "does X already exist in
# the repo?" question answered from this worktree gets the pre-merge answer.
# That is how a valid review finding gets rejected against a tree main has moved
# past. Best-effort fetch: offline falls back to the last known ref.
base_fresh_check() {
  git fetch -q origin "${BASE#origin/}" 2>/dev/null
  local behind
  # An unresolvable base fails: a check that could not ask its question must not
  # answer "fresh". Offline is fine — the fetch is best-effort and the last
  # known ref still compares — but a missing ref is a real failure.
  if ! behind=$(git log --oneline "HEAD..$BASE" 2>&1); then
    echo "cannot resolve $BASE, so freshness went unchecked: ${behind%%$'\n'*}"
    return 1
  fi
  if [ -n "$behind" ]; then
    echo "branch has not seen these commits on $BASE — rebase onto it, re-run this gate, then open the PR:"
    printf '%s\n' "$behind"
    return 1
  fi
  echo "$BASE is an ancestor of HEAD"
}

if [ -n "$SMALL_NODE" ]; then
  run "base fresh" base_fresh_check
  run "fingerprint" fingerprint_check
  run "test file" node "$SMALL_NODE"
else
  PRE_STATUS=$(git status --porcelain)
  run "base fresh" base_fresh_check
  if [ "$BUNDLE_CHANGED" -eq 1 ]; then
    run "bundle rebuild" npm run bundle
    run "bundle reproducible (dist/ matches commit)" dist_unchanged
    run "check clean fixture" node tools/check.js tests/fixtures/clean.excalidraw
  fi
  run "fingerprint" fingerprint_check
  run "npm test" npm test
  clean_tree_check() {
    local post
    post=$(git status --porcelain)
    if [ "$PRE_STATUS" != "$post" ]; then
      echo "verification dirtied the repo — status delta:"
      diff <(echo "$PRE_STATUS") <(echo "$post")
      return 1
    fi
  }
  run "clean tree (verification must not dirty the repo)" clean_tree_check
fi

FAIL=0
for i in "${!NAMES[@]}"; do
  if [ "${RCS[$i]}" -ne 0 ]; then
    FAIL=1
    echo
    echo "---- ${NAMES[$i]} — last 40 lines ----"
    tail -n 40 "${LOGS[$i]}"
  fi
  rm -f "${LOGS[$i]}"
done
exit "$FAIL"
