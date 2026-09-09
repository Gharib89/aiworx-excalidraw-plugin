#!/usr/bin/env bash
# One on-request round: request the reviewer, then read the request back off
# the host's own record (an empty requested-reviewers list proves nothing, and
# the login requested and the login recorded can differ).
#
#   request-review <pr> <login>
#
# stdout: {pr, login, requested, readback[]}
# exit: 0 requested and read back · 1 not read back (never-queued after one retry) · 2 usage
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
pr=${1:?usage: request-review <pr> <login>}; login=${2:?usage: request-review <pr> <login>}
[ $# -eq 2 ] || ship_tooling "unknown flag: $3"
ship_load_host
out=$(host_pr_request_review "$pr" "$login") || ship_tooling "request call failed"
if [ "$(jq -r .requested <<<"$out")" != true ]; then
  sleep 5
  out=$(host_pr_request_review "$pr" "$login") || ship_tooling "request call failed"
fi
jq --argjson pr "$pr" --arg l "$login" '{pr: $pr, login: $l} + .' <<<"$out"
[ "$(jq -r .requested <<<"$out")" = true ]
