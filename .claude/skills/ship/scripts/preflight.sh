#!/usr/bin/env bash
# Ship phase-0 pre-flight: is this issue actionable, or already in flight?
# Catches a manual re-run or an already-shipped issue: closed issue, an existing
# open/merged PR that claims to CLOSE it, an existing remote branch, or an
# agent-working claim.
#
#   scripts/preflight.sh <issue>
#
# Prints JSON {actionable, reasons: [], mentions: []}. `mentions` lists live PRs
# that name the issue without claiming to close it — context, never a blocker.
# Exit 0 = actionable, 1 = stop and report.
set -uo pipefail
N="${1:?usage: preflight.sh <issue>}"

api() { gh api "$@" || { sleep 2; gh api "$@"; }; }

ISS=$(api "repos/{owner}/{repo}/issues/$N") || exit 1
REASONS=()
STATE=$(jq -r .state <<<"$ISS")
[ "$STATE" = "open" ] || REASONS+=("issue is $STATE")
jq -e '.pull_request' <<<"$ISS" >/dev/null && REASONS+=("#$N is a PR, not an issue")
jq -e '.labels[] | select(.name == "agent-working")' <<<"$ISS" >/dev/null \
  && REASONS+=("already claimed (agent-working)")

# PRs referencing the issue, via cross-referenced timeline events. A bare
# cross-reference is undirected — it fires whether the PR implements the issue
# or merely names it (the "spun this out of the PR I was working on" pattern) —
# so each live candidate is split on whether its body carries a closing keyword
# aimed at THIS issue. Only a claimed close is in-flight work; a mention is
# context, not a blocker. The timeline hydrates each source PR in full, so the
# bodies are already in this payload — no extra call, and no extra 401 surface.
#
# Matched with jq's Oniguruma, not grep: \b and case-insensitivity behave the
# same on GNU and BSD userlands, and jq is already a hard dependency here. The
# `(#[0-9]+[\s,]+(and[\s,]+)?)*` run before the back-reference is what lets a
# multi-issue "Closes #75, #81" claim count for #81 and not just for #75.
XREF=$(api "repos/{owner}/{repo}/issues/$N/timeline" --paginate \
  | jq -s --arg n "$N" '
      [.[][] | select(.event == "cross-referenced")
       | .source.issue | select(.pull_request != null)
       | {number, state, merged: (.pull_request.merged_at != null),
          closes: ((.body // "") | test(
            "\\b(clos(e[sd]?|ing)|fix(e[sd]|ing)?|resolv(e[sd]?|ing))"
            + "\\s+(#[0-9]+[\\s,]+(and[\\s,]+)?)*#" + $n + "\\b"; "i"))}]
      | unique_by(.number)
      | [.[] | select(.state == "open" or .merged)]
      | {closing: [.[] | select(.closes)       | .number],
         mentions: [.[] | select(.closes | not) | .number]}') || exit 1
CLOSING=$(jq -c .closing <<<"$XREF")
MENTIONS_JSON=$(jq -c .mentions <<<"$XREF")
[ "$CLOSING" != "[]" ] && REASONS+=("existing PR(s) claiming to close #$N: $CLOSING")

# Remote branch already pushed for this issue (…-<issue> naming convention).
BR=$(git ls-remote --heads origin "*-$N" | awk '{print $2}' | sed 's|refs/heads/||' | paste -sd, -) || exit 1
[ -n "$BR" ] && REASONS+=("remote branch exists: $BR")

if [ "${#REASONS[@]}" -eq 0 ]; then
  jq -n --argjson mentions "$MENTIONS_JSON" \
    '{actionable: true, reasons: [], mentions: $mentions}'
else
  printf '%s\n' "${REASONS[@]}" | jq -Rs --argjson mentions "$MENTIONS_JSON" \
    '{actionable: false, reasons: split("\n")[:-1], mentions: $mentions}'
  exit 1
fi
