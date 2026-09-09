#!/usr/bin/env bash
# ship phase 6: push the branch and open a NON-DRAFT PR linked so the merge
# closes the issue (drafts may not trigger a reviewer).
#
#   open-pr <issue> --title "<conventional-commit subject>" --body-file <path>
#
# Run from the run's branch. <issue> may be `none` for a task-spec run: no
# closing link, no branch-suffix check. The mechanic adds the host's closing
# link when the body lacks one aimed at this issue. Re-running after a flake
# returns the PR the first call created.
#
# stdout: {number, url, branch, base}
# exit: 0 · 1 push or create failed · 2 usage or wrong branch
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
usage='usage: open-pr <issue> --title "<subject>" --body-file <path>'
n=${1:?$usage}; shift
title=""; file=""
while [ $# -gt 0 ]; do
  case $1 in
    --title) title=${2:?}; shift 2 ;;
    --body-file) file=${2:?}; shift 2 ;;
    *) ship_tooling "unknown flag: $1" ;;
  esac
done
[ -n "$title" ] && [ -f "$file" ] || ship_tooling "$usage"
ship_load_host

branch=$(git rev-parse --abbrev-ref HEAD) || ship_tooling "not inside a git checkout"
[ "$branch" != HEAD ] || ship_tooling "detached HEAD; check out the run's branch first"
if [ "$n" != none ]; then
  [[ $branch =~ $(ship_branch_suffix_re "$n") ]] || ship_tooling "branch $branch does not end in -$n; is this the run's worktree?"
fi
base=$(ship_base_branch) || ship_tooling "cannot resolve origin/HEAD"
[ "$branch" != "$base" ] || ship_tooling "refusing to open a PR from the base branch $base"

log=$(mktemp); trap 'rm -f "$log"' EXIT
git push -u origin "HEAD:refs/heads/$branch" >"$log" 2>&1 || { ship_tail40 "$log"; ship_fail "git push failed"; }

issue_arg=$n; [ "$n" = none ] && issue_arg=""
pr=$(host_pr_create "$branch" "$base" "$title" "$file" "$issue_arg") || ship_fail "PR create failed"
jq --arg b "$branch" --arg base "$base" '. + {branch: $b, base: $base}' <<<"$pr"
