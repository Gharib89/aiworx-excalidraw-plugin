#!/usr/bin/env bash
# Poll a PR's checks + reviews (ship phase 8) in a bounded foreground loop,
# then print ONE JSON summary. REST only — gh's GraphQL path flakes 401
# mid-session; every call retries once.
#
#   scripts/poll-pr.sh <pr> [--timeout 480] [--interval 20] [--await-review <login>]
#
# JSON: {head_sha, mergeable_state, checks: [{name,status,conclusion}],
#        reviews: [{login,state,substantive}]  (reviews keyed to the CURRENT head
#        sha — a review on an older commit does not count),
#        review_count_total, reviewer_blocked, done, waited_s}
#
# done=true (exit 0): all check runs completed (and the awaited review landed),
# or mergeable_state=dirty (conflicted — merge-ref checks will never start, so
# waiting is pointless; resolve the conflict instead).
# done=false (exit 3): the window closed first — re-run to keep waiting.
#
# `substantive` is the landing signal, not `state`. A reviewer's reply to ONE
# COMMENT THREAD posts as a review row of its own: current head sha, state
# COMMENTED, empty body. Answering a round's comments therefore manufactures the
# rows that say the NEXT round arrived, and awaiting a bare login goes green on
# the reviewer echoing you. Only a non-empty body is a round.
#
# `reviewer_blocked` carries the awaited login's own account of why a round has
# not come — a quota banner, a queue notice. Non-null with done=false means the
# round is WAITING, not missing: keep polling rather than calling it an infra
# flake. Its countdown is the reviewer's static text and does not re-render, so
# read it as "blocked", never as "blocked for N more minutes".
set -uo pipefail
PR="${1:?usage: poll-pr.sh <pr> [--timeout s] [--interval s] [--await-review login]}"
shift
TIMEOUT=480; INTERVAL=20; AWAIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout)      TIMEOUT="$2";  shift 2 ;;
    --interval)     INTERVAL="$2"; shift 2 ;;
    --await-review) AWAIT="$2";    shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

api() { gh api "$@" 2>/dev/null || { sleep 2; gh api "$@"; }; }

START=$SECONDS
while :; do
  PRJ=$(api "repos/{owner}/{repo}/pulls/$PR") || exit 1
  SHA=$(jq -r .head.sha <<<"$PRJ")
  MSTATE=$(jq -r '.mergeable_state // "unknown"' <<<"$PRJ")
  CHECKS=$(api "repos/{owner}/{repo}/commits/$SHA/check-runs" --paginate \
    | jq -s '[.[].check_runs[] | {name, status, conclusion}]') || exit 1
  ALL_REVIEWS=$(api "repos/{owner}/{repo}/pulls/$PR/reviews" --paginate | jq -s 'add // []') || exit 1
  REVIEWS=$(jq --arg sha "$SHA" \
    '[.[] | select(.commit_id == $sha)
          | {login: .user.login, state, substantive: ((.body // "") != "")}]' <<<"$ALL_REVIEWS")

  # the awaited reviewer's own account of a round it has not delivered, which it
  # states in a comment rather than a review — the one place a quota shows up
  BLOCKED=null
  if [ -n "$AWAIT" ]; then
    BLOCKED=$(api "repos/{owner}/{repo}/issues/$PR/comments" --paginate \
      | jq -s --arg l "$AWAIT" 'add // [] | [.[] | select(.user.login == $l) | .body
           | split("\n")[] | select(test("rate limit|quota|Next included review"; "i"))
           | sub("^>\\s*"; "") | gsub("\\*"; "")] | last // null') || BLOCKED=null
  fi

  N=$(jq length <<<"$CHECKS")
  PENDING=$(jq '[.[] | select(.status != "completed")] | length' <<<"$CHECKS")
  DONE=0
  if [ "$MSTATE" = "dirty" ]; then
    DONE=1
  elif [ "$N" -gt 0 ] && [ "$PENDING" -eq 0 ]; then
    if [ -z "$AWAIT" ] ||
       jq -e --arg l "$AWAIT" 'any(.[]; .login == $l and .substantive)' <<<"$REVIEWS" >/dev/null; then
      DONE=1
    fi
  fi

  WAITED=$((SECONDS - START))
  if [ "$DONE" -eq 1 ] || [ "$WAITED" -ge "$TIMEOUT" ]; then
    jq -n --arg sha "$SHA" --arg ms "$MSTATE" \
      --argjson checks "$CHECKS" --argjson reviews "$REVIEWS" \
      --argjson total "$(jq length <<<"$ALL_REVIEWS")" \
      --argjson blocked "$BLOCKED" \
      --argjson finished "$([ "$DONE" -eq 1 ] && echo true || echo false)" \
      --argjson waited "$WAITED" \
      '{head_sha: $sha, mergeable_state: $ms, checks: $checks, reviews: $reviews,
        review_count_total: $total, reviewer_blocked: $blocked,
        done: $finished, waited_s: $waited}'
    [ "$DONE" -eq 1 ] && exit 0 || exit 3
  fi
  sleep "$INTERVAL"
done
