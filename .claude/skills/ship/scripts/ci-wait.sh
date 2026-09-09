#!/usr/bin/env bash
# ship phase 8: conflict check first (a conflicted PR has no merge ref, so its
# checks sit pending forever), then a bounded foreground wait until every check
# on the head has completed.
#
#   ci-wait <pr> [--timeout <s>] [--interval <s>]
#
# stdout: {status: green | no-checks | conflict | checks-failed | timeout,
#          head_sha, checks: [{name, status}], failing: [names], waited_s}
#   Every check is listed by name so the run can hold it against the profile's
#   Legs:. no-checks is legal only where the profile's No-checks legal: says so.
# exit: 0 green or no-checks · 1 conflict, a failed check, or the window closed · 2 tooling
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
pr=${1:?usage: ci-wait <pr> [--timeout <s>] [--interval <s>]}; shift
timeout=1800; interval=30; grace=120
while [ $# -gt 0 ]; do
  case $1 in
    --timeout) timeout=${2:?}; shift 2 ;;
    --interval) interval=${2:?}; shift 2 ;;
    *) ship_tooling "unknown flag: $1" ;;
  esac
done
ship_load_host

emit() { # <status> <sha> <checks-json> <waited>
  jq -n --arg s "$1" --arg sha "$2" --argjson c "$3" --argjson w "$4" \
    '{status: $s, head_sha: $sha, checks: $c, failing: [$c[] | select(.status == "failure") | .name], waited_s: $w}'
}
start=$SECONDS
while :; do
  prj=$(host_pr_get "$pr") || ship_tooling "cannot read PR $pr"
  sha=$(jq -r .head_sha <<<"$prj")
  waited=$((SECONDS - start))
  if [ "$(jq -r .mergeable <<<"$prj")" = conflict ]; then
    emit conflict "$sha" '[]' "$waited"
    echo "PR $pr conflicts with its base: fetch, rebase, resolve, re-run base-fresh and the local gate, push." >&2
    exit 1
  fi
  checks=$(host_pr_checks "$pr" "$sha") || ship_tooling "cannot read checks"
  n=$(jq length <<<"$checks"); pending=$(jq '[.[] | select(.status == "pending")] | length' <<<"$checks")
  # A path-filtered repo can legitimately report no checks for a docs-only PR;
  # give the host a grace window to register them before believing that.
  if [ "$n" -eq 0 ] && [ "$waited" -ge "$grace" ]; then emit no-checks "$sha" "$checks" "$waited"; exit 0; fi
  if [ "$n" -gt 0 ] && [ "$pending" -eq 0 ]; then
    if jq -e 'any(.[]; .status == "failure")' <<<"$checks" >/dev/null; then
      emit checks-failed "$sha" "$checks" "$waited"; exit 1
    fi
    emit green "$sha" "$checks" "$waited"; exit 0
  fi
  if [ "$waited" -ge "$timeout" ]; then emit timeout "$sha" "$checks" "$waited"; exit 1; fi
  sleep "$interval"
done
