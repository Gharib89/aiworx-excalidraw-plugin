#!/usr/bin/env bash
# Post a PR comment (the merge summary in the unattended lane, a round log).
# On Azure DevOps this is a thread with status closed, so a comment-resolution
# policy never blocks completion.
#
#   comment-pr <pr> --body-file <path>
#
# stdout: {id, url}
# exit: 0 · 1 post failed · 2 usage
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
pr=${1:?usage: comment-pr <pr> --body-file <path>}; shift
[ "${1:-}" = --body-file ] && [ -f "${2:-}" ] && [ $# -eq 2 ] || ship_tooling "usage: comment-pr <pr> --body-file <path>"
ship_load_host
host_pr_comment "$pr" "$2" || ship_fail "comment failed"
