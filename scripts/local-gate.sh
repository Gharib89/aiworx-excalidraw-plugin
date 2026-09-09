#!/usr/bin/env bash
# Local gate: every check this repo's CI runs, run locally before a PR opens.
# Written by setup-skills; owned by the repo. Ship never edits it.
#
#   scripts/local-gate.sh [--small <tests/suite.js>] [--base <ref>]
#
# Contract (ship's local-gate contract, the same in every repo):
#   stdout: one JSON object, {"verdict","base","lane","gates":{<name>:<status>}}
#   stderr: a failing gate's last 40 log lines, never the full log
#   exit:   0 every gate passed · 1 a gate failed · 2 tooling
#   gate status: pass | fail | deferred-to-ci | unavailable
#     deferred-to-ci: planned, CI proves this gate (other-OS legs, unchanged bundle)
#     unavailable:    unexpected, the gate could not ask its question (tool missing)
#   verdict: pass | fail | unavailable; fail wins over unavailable
#   `secrets` is required in every lane. Base defaults to origin/HEAD.
#
# Mirrors .github/workflows/ci.yml: the `test` leg (npm test plus the
# verification-must-not-dirty-the-repo check), the `bundle` leg when a bundle
# input changed (rebuild from the locked toolchain, rebuilt dist/ must match the
# committed one, then gate the clean fixture), and the `plugin` leg (version
# gate, plugin validate). The macOS/Windows matrix legs are CI's alone.
set -uo pipefail

small="" base=""
while [ $# -gt 0 ]; do
  case $1 in
    --small) [ $# -ge 2 ] || { printf '{"error":"--small needs a test node"}\n'; exit 2; }; small=$2; shift 2 ;;
    --base)  [ $# -ge 2 ] || { printf '{"error":"--base needs a ref"}\n'; exit 2; }; base=$2; shift 2 ;;
    *) printf '{"error":"unknown flag: %s"}\n' "$1"; exit 2 ;;
  esac
done
command -v jq >/dev/null || { echo '{"error":"jq not installed"}'; exit 2; }
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo '{"error":"not inside a git checkout"}'; exit 2; }
if [ -z "$base" ]; then
  base=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) \
    || { echo '{"error":"cannot resolve origin/HEAD; run git remote set-head origin -a or pass --base"}'; exit 2; }
  base=${base#refs/remotes/}
fi
lane=full; [ -z "$small" ] || lane=small

declare -A gates
log=$(mktemp); trap 'rm -f "$log"' EXIT
run()  { local name=$1; shift; if "$@" >"$log" 2>&1; then gates[$name]=pass; else gates[$name]=fail; tail -n 40 "$log" >&2; fi; }
mark() { gates[$1]=$2; }   # mark <name> deferred-to-ci|unavailable

# --- gates ---------------------------------------------------------------------

# secrets: required in every lane; the repo has no CI scanner, so this is the
# only place added lines are checked.
if command -v gitleaks >/dev/null; then
  run secrets gitleaks git --no-banner --redact --log-opts="$base..HEAD" .
else
  mark secrets unavailable
fi

# Bundle inputs = exactly what tools/fingerprint.js hashes: page source, bundler
# config, the font list, and lockfile-resolved dep versions.
bundle_changed=0
git diff --quiet "$base"...HEAD -- tools/page.js tools/bundle.js tools/fonts.js package-lock.json 2>/dev/null \
  || bundle_changed=1

# Stale-bundle check: browser.js refuses a mismatched stamp, so catch it here with
# a named gate instead of an opaque mid-suite failure.
fingerprint_check() {
  node --input-type=module -e '
    const m = await import("./tools/fingerprint.js");
    const expected = m.expectedFingerprint();
    const stamped = m.stampedFingerprint("dist/excalidraw-page.js");
    if (expected !== stamped) {
      console.error(`stale bundle: stamped ${stamped ?? "none"}, sources expect ${expected}; run npm run bundle and commit dist/`);
      process.exit(1);
    }
    console.log(`fingerprint ${expected} matches`);'
}

# Bytes AND paths: `git diff` alone misses an added file (renamed woff2, or a new
# dist/ path .gitignore's by-name un-ignores would drop). Mirrors ci.yml.
dist_unchanged() {
  git diff --quiet -- dist/ && [ -z "$(git status --porcelain --ignored dist/)" ]
}

# Runtime deps suffice for the tests; rebundling needs the dev deps (esbuild).
deps_install() {
  if [ "$bundle_changed" -eq 1 ]; then
    [ -d node_modules/esbuild ] || npm ci
  else
    [ -d node_modules ] || npm ci --omit=dev
  fi
}

if [ "$lane" = small ]; then
  run fingerprint fingerprint_check
  run test node "$small"                 # the one regression suite proving the change
else
  pre_status=$(git status --porcelain)
  run deps deps_install
  if [ "$bundle_changed" -eq 1 ]; then
    run bundle:rebuild npm run bundle
    run bundle:reproducible dist_unchanged
    run bundle:fixture node tools/check.js tests/fixtures/clean.excalidraw
  else
    mark bundle:rebuild deferred-to-ci   # CI rebuilds on every PR; nothing changed to rebuild here
    mark bundle:reproducible deferred-to-ci
    mark bundle:fixture deferred-to-ci
  fi
  run fingerprint fingerprint_check
  run test npm test
  clean_tree_check() {
    local post; post=$(git status --porcelain)
    [ "$pre_status" = "$post" ] && return 0
    echo "verification dirtied the repo; status delta:"
    diff <(echo "$pre_status") <(echo "$post")
    return 1
  }
  run test:clean-tree clean_tree_check
  run plugin:version-gate node tools/version-gate.js --base "$base"
  if command -v claude >/dev/null; then
    run plugin:validate claude plugin validate . --strict
  else
    mark plugin:validate deferred-to-ci   # CI runs it against the pinned CLI
  fi
fi
# --- end gates -----------------------------------------------------------------

verdict=pass
for s in "${gates[@]}"; do
  case $s in
    fail) verdict=fail ;;
    unavailable) [ "$verdict" = fail ] || verdict=unavailable ;;
  esac
done
case $verdict in pass) rc=0 ;; fail) rc=1 ;; *) rc=2 ;; esac

for k in "${!gates[@]}"; do printf '%s\t%s\n' "$k" "${gates[$k]}"; done \
  | jq -Rs --arg v "$verdict" --arg b "$base" --arg l "$lane" \
      '{verdict: $v, base: $b, lane: $l,
        gates: (split("\n") | map(select(. != "") | split("\t") | {(.[0]): .[1]}) | add // {})}'
exit $rc
