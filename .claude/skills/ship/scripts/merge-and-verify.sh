#!/usr/bin/env bash
# Merge mechanics (ship phase 9 — run only AFTER the human says "merge"):
# squash-merge via REST, re-verify merged state, delete the remote branch,
# fast-forward the local base branch onto the squash commit, and confirm the
# linked issue closed (closing it if the Closes-keyword didn't).
# REST throughout — gh's GraphQL merge path flakes 401; every call retries once.
#
#   scripts/merge-and-verify.sh <pr> [issue]
#
# The squash subject is "<PR title> (#<pr>)" — the release history reads it, so
# the PR title must already be the Conventional-Commit line.
set -uo pipefail
PR="${1:?usage: merge-and-verify.sh <pr> [issue]}"
ISSUE="${2:-}"

api() { gh api "$@" || { sleep 2; gh api "$@"; }; }

PRJ=$(api "repos/{owner}/{repo}/pulls/$PR") || exit 1
TITLE=$(jq -r .title <<<"$PRJ")
BRANCH=$(jq -r .head.ref <<<"$PRJ")
BASE=$(jq -r .base.ref <<<"$PRJ")

api -X PUT "repos/{owner}/{repo}/pulls/$PR/merge" \
  -f merge_method=squash -f commit_title="$TITLE (#$PR)" >/dev/null \
  || { echo '{"merged": false, "error": "merge call failed"}'; exit 1; }

# Never assume the command took — verify merged state before reporting done.
MERGED=$(api "repos/{owner}/{repo}/pulls/$PR" | jq -r .merged)
[ "$MERGED" = "true" ] \
  || { echo '{"merged": false, "error": "post-merge verify failed: PR not merged"}'; exit 1; }

# This repo does not auto-delete branches on merge — delete explicitly.
# May legitimately 422 if the branch is already gone.
BRANCH_DELETED=true
api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$BRANCH" >/dev/null 2>&1 || BRANCH_DELETED=false

# The local base branch is now behind by the squash commit. This script runs
# from the feature worktree, so a plain `git pull` here would pull the base
# INTO the feature branch — instead fast-forward the checkout that actually
# holds the base branch, or move the ref directly when no checkout holds it.
# Best-effort: the merge already landed, so a dirty or diverged base checkout
# is reported, not fatal.
BASE_UPDATED=false
if git fetch --quiet origin "$BASE"; then
  BASE_WT=$(git worktree list --porcelain \
    | awk -v b="branch refs/heads/$BASE" '/^worktree /{p=substr($0,10)} $0==b{print p; exit}')
  if [ -n "$BASE_WT" ]; then
    git -C "$BASE_WT" merge --ff-only "origin/$BASE" >/dev/null && BASE_UPDATED=true
  elif ! git rev-parse --verify -q "refs/heads/$BASE" >/dev/null \
       || git merge-base --is-ancestor "refs/heads/$BASE" "refs/remotes/origin/$BASE"; then
    # No checkout holds it, so there is no `merge --ff-only` to lean on — do the
    # fast-forward check by hand rather than force-moving a diverged local base.
    git update-ref "refs/heads/$BASE" "refs/remotes/origin/$BASE" && BASE_UPDATED=true
  fi
fi

ISSUE_STATE=null
if [ -n "$ISSUE" ]; then
  sleep 3  # give the Closes-keyword automation a beat
  STATE=$(api "repos/{owner}/{repo}/issues/$ISSUE" | jq -r .state)
  if [ "$STATE" = "open" ]; then
    api -X PATCH "repos/{owner}/{repo}/issues/$ISSUE" \
      -f state=closed -f state_reason=completed >/dev/null
    STATE=$(api "repos/{owner}/{repo}/issues/$ISSUE" | jq -r .state)
  fi
  ISSUE_STATE="\"$STATE\""
fi

jq -n --arg subject "$TITLE (#$PR)" --arg branch "$BRANCH" --arg base "$BASE" \
  --argjson deleted "$BRANCH_DELETED" --argjson base_updated "$BASE_UPDATED" \
  --argjson issue_state "$ISSUE_STATE" \
  '{merged: true, squash_subject: $subject, branch: $branch,
    remote_branch_deleted: $deleted, base_branch: $base,
    base_branch_updated: $base_updated, issue_state: $issue_state}'
