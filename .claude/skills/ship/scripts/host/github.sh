#!/usr/bin/env bash
# GitHub adapter: the host_* interface from _lib.sh over REST via `gh api`.
# REST throughout, one retry after 2 s: gh's GraphQL paths (gh pr view --json,
# gh pr checks --watch) flake 401 mid-session. GraphQL is used only for the two
# things REST lacks, review-thread resolution state and resolveReviewThread,
# behind the same retry. Sourced by _lib.sh's ship_load_host; needs SHIP_OWNER
# and SHIP_REPO set.

R="repos/$SHIP_OWNER/$SHIP_REPO"

# Reads retry once on any failure. Creates (comment, PR, issue) re-read before
# retrying so a slow success is never double-posted; see the create functions.
api() { gh api "$@" 2>/dev/null || { sleep 2; gh api "$@"; }; }
gql() { gh api graphql "$@" 2>/dev/null || { sleep 2; gh api graphql "$@"; }; }

host_tooling_reasons() {
  command -v gh  >/dev/null || echo "gh not installed"
  command -v jq  >/dev/null || echo "jq not installed"
  command -v git >/dev/null || echo "git not installed"
}
# The Ubuntu archive is the one route the cloud sandbox proxy passes (the
# release tarball host 404s through it); apt installs 2.45.0 in about 12 s.
host_tooling_install() {
  command -v gh >/dev/null && return 0
  local sudo=""; [ "$(id -u)" -eq 0 ] || sudo="sudo -n"
  $sudo apt-get install -y gh
}
host_identity() { api user --jq .login; }
host_can_push() { api "$R" --jq '.permissions.push // false'; }

_norm_issue='{number, title, body: (.body // ""),
  state: (if .state == "open" then "open" else "closed" end),
  is_pr: (.pull_request != null),
  labels: [.labels[].name], assignees: [.assignees[].login],
  created_at, url: .html_url}'

host_issue_get()      { api "$R/issues/$1" --jq "$_norm_issue"; }
host_issue_comments() {
  api "$R/issues/$1/comments" --paginate --jq '.[] | {author: .user.login, body, created_at}' | jq -s .
}
# GitHub has native issue dependencies, so a failed query is "unavailable", never vacuous.
host_issue_blockers_open() {
  api "$R/issues/$1/dependencies/blocked_by" --paginate --jq '.[] | select(.state == "open") | .number' | jq -s .
}
# Cross-referenced timeline events hydrate each source PR in full, so the split
# between "claims to close this issue" and "merely mentions it" costs no extra call.
host_issue_linked_prs() {
  local n=$1 raw
  raw=$(api "$R/issues/$n/timeline" --paginate --jq '
      .[] | select(.event == "cross-referenced") | .source.issue
      | select(.pull_request != null)
      | select(.state == "open" or .pull_request.merged_at != null)
      | {number, state: (if .pull_request.merged_at != null then "merged" else "open" end), body: (.body // "")}' \
    | jq -s 'unique_by(.number)') || return 1
  local out='{"closing":[],"mentions":[]}' row
  while IFS= read -r row; do
    [ -z "$row" ] && continue
    if ship_body_closes "$(jq -r .body <<<"$row")" "$n"; then
      out=$(jq --argjson r "$row" '.closing += [$r | {number, state}]' <<<"$out")
    else
      out=$(jq --argjson r "$row" '.mentions += [$r | {number, state}]' <<<"$out")
    fi
  done < <(jq -c '.[]' <<<"$raw")
  printf '%s\n' "$out"
}
host_issue_assign()   { api -X POST   "$R/issues/$1/assignees" -f "assignees[]=$2" >/dev/null; }
host_issue_unassign() { api -X DELETE "$R/issues/$1/assignees" -f "assignees[]=$2" >/dev/null; }
host_issue_has_label(){ api "$R/issues/$1/labels" --jq '.[].name' | grep -qxF -- "$2"; }
host_issue_add_label(){ api -X POST "$R/issues/$1/labels" -f "labels[]=$2" >/dev/null; }
# Check first: a DELETE 404s the same way whether the label was already gone or
# the call itself failed, and a reported removal that never happened is exactly
# the residue this exists to stop.
host_issue_remove_label() {
  host_issue_has_label "$1" "$2" || return 0
  api -X DELETE "$R/issues/$1/labels/$(jq -rn --arg l "$2" '$l | @uri')" >/dev/null
}
host_issue_comment()  { jq -n --arg b "$2" '{body: $b}' | api -X POST "$R/issues/$1/comments" --input - >/dev/null; }
host_issue_close()    { api -X PATCH "$R/issues/$1" -f state=closed -f state_reason=completed >/dev/null; }

# Create-then-verify: on a failed create, look for the row a slow success left
# before retrying, so a flake never double-posts.
host_issue_create() { # <title> <body-file> <label>
  local title=$1 file=$2 label=$3 me out
  me=$(host_identity) || return 1
  _issue_create() {
    jq -n --arg t "$title" --rawfile b "$file" --arg l "$label" \
      '{title: $t, body: $b, labels: (if $l == "" then [] else [$l] end)}' \
      | gh api -X POST "$R/issues" --input - --jq '{number, url: .html_url}' 2>/dev/null
  }
  if out=$(_issue_create); then printf '%s\n' "$out"; return 0; fi
  sleep 2
  out=$(api "$R/issues?state=open&creator=$me&sort=created&direction=desc&per_page=20" \
    --jq --arg t "$title" '[.[] | select(.pull_request == null and .title == $t)] | first | select(. != null) | {number, url: .html_url}')
  if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  _issue_create
}

host_pr_create() { # <head> <base> <title> <body-file> <issue>
  local head=$1 base=$2 title=$3 file=$4 issue=$5 body out
  body=$(cat "$file")
  # The mechanic translates the closing link for the host: append the keyword
  # when the body does not already carry one aimed at this issue.
  if [ -n "$issue" ] && ! ship_body_closes "$body" "$issue"; then
    body=$(printf '%s\n\nCloses #%s\n' "$body" "$issue")
  fi
  _pr_create() {
    jq -n --arg h "$head" --arg b "$base" --arg t "$title" --arg body "$body" \
      '{head: $h, base: $b, title: $t, body: $body, draft: false}' \
      | gh api -X POST "$R/pulls" --input - --jq '{number, url: .html_url}' 2>/dev/null
  }
  if out=$(_pr_create); then printf '%s\n' "$out"; return 0; fi
  sleep 2
  out=$(api "$R/pulls?state=open&head=$SHIP_OWNER:$head" --jq 'first | select(. != null) | {number, url: .html_url}')
  if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  _pr_create
}

host_pr_get() {
  api "$R/pulls/$1" --jq '{number, url: .html_url, title, body: (.body // ""),
    head_sha: .head.sha, head_ref: .head.ref, base_ref: .base.ref,
    state: (if .merged then "merged" elif .state == "open" then "open" else "closed" end),
    mergeable: (if .mergeable_state == "dirty" then "conflict"
                elif .mergeable == true then "clean" else "unknown" end)}'
}

host_pr_for_branch() { # <branch>
  api "$R/pulls?state=all&head=$SHIP_OWNER:$1&sort=created&direction=desc&per_page=1" \
    --jq 'first | if . == null then null else {number, state: (if .merged_at != null then "merged" elif .state == "open" then "open" else "closed" end)} end'
}

# Check runs plus classic commit statuses, one row per name, latest wins.
host_pr_checks() { # <pr> <head_sha>
  local sha=$2 runs statuses
  runs=$(api "$R/commits/$sha/check-runs" --paginate --jq '.check_runs[] | {name,
      status: (if .status != "completed" then "pending"
               elif (.conclusion | IN("success","neutral","skipped")) then "success"
               else "failure" end), at: (.completed_at // .started_at // "")}' | jq -s .) || return 1
  statuses=$(api "$R/commits/$sha/status" --jq '.statuses[] | {name: .context,
      status: (if .state == "success" then "success" elif .state == "pending" then "pending" else "failure" end),
      at: .updated_at}' | jq -s .) || return 1
  jq -n --argjson a "$runs" --argjson b "$statuses" \
    '$a + $b | group_by(.name) | map(max_by(.at) | {name, status})'
}

# Reviews keyed to the current head: a review on an older commit does not count.
# `substantive` is the landing signal: a reviewer's reply to one thread posts as
# a review row of its own (current head, empty body), so only a body is a round.
host_pr_reviews() { # <pr> <head_sha>
  api "$R/pulls/$1/reviews" --paginate --jq '.[]' | jq -s --arg sha "$2" '{
    on_head: [.[] | select(.commit_id == $sha) | {login: .user.login,
      state: (if .state == "APPROVED" then "approved" elif .state == "CHANGES_REQUESTED" then "changes" else "comment" end),
      substantive: ((.body // "") != ""), submitted_at}],
    total: length}'
}

_threads_query='query($o:String!,$r:String!,$n:Int!,$after:String){
  repository(owner:$o,name:$r){ pullRequest(number:$n){
    reviewThreads(first:100, after:$after){
      pageInfo{hasNextPage endCursor}
      nodes{ id isResolved isOutdated path
        comments(first:1){ nodes{ author{login} body url } } } } } } }'
# GraphQL only: REST has no thread-resolution state. A refused GraphQL path
# (a proxy that pins it) fails this call; the mechanic reports "unavailable".
host_pr_threads() {
  local after=null page out='[]'
  while :; do
    page=$(gql -f query="$_threads_query" -F o="$SHIP_OWNER" -F r="$SHIP_REPO" -F n="$1" \
      $([ "$after" != null ] && printf -- '-F after=%s' "$after") \
      --jq '.data.repository.pullRequest.reviewThreads') || return 1
    out=$(jq --argjson p "$page" '. + [$p.nodes[] | {id, resolved: .isResolved, outdated: .isOutdated, path,
      author: .comments.nodes[0].author.login, body: .comments.nodes[0].body, url: .comments.nodes[0].url}]' <<<"$out")
    [ "$(jq -r .pageInfo.hasNextPage <<<"$page")" = true ] || break
    after=$(jq -r .pageInfo.endCursor <<<"$page")
  done
  printf '%s\n' "$out"
}

# The awaited login's own account of a round it has not delivered, stated in a
# PR comment rather than a review: the one place a quota or queue notice shows up.
host_pr_reviewer_blocked() { # <pr> <login>
  api "$R/issues/$1/comments" --paginate --jq '.[]' | jq -s --arg l "$2" '
    [.[] | select(.user.login == $l) | .body | split("\n")[]
     | select(test("rate limit|quota|Next included review|queue"; "i"))
     | sub("^>\\s*"; "") | gsub("\\*"; "")] | last // null'
}

# Request, then read the request back off the host's own record: the login you
# request and the login you read back can differ (Copilot is requested as
# copilot-pull-request-reviewer[bot] and recorded without the suffix), and an
# empty requested_reviewers list proves nothing once the bot has posted.
host_pr_request_review() { # <pr> <login>
  local pr=$1 login=$2 ok=false readback
  api -X POST "$R/pulls/$pr/requested_reviewers" -f "reviewers[]=$login" >/dev/null && ok=true
  sleep 2
  readback=$( { api "$R/pulls/$pr" --jq '.requested_reviewers[].login';
                api "$R/issues/$pr/timeline" --paginate \
                  --jq '.[] | select(.event == "review_requested") | .requested_reviewer.login // empty'; } \
              | jq -R . | jq -s 'unique')
  jq -n --argjson ok "$ok" --argjson rb "$readback" --arg l "$login" \
    '{requested: ($ok and ([$rb[] | ascii_downcase | sub("\\[bot\\]$"; "")] | index($l | ascii_downcase | sub("\\[bot\\]$"; "")) != null)),
      readback: $rb}'
}

host_pr_comment() { # <pr> <body-file>
  local pr=$1 file=$2 me out
  me=$(host_identity) || return 1
  _pr_comment() { jq -n --rawfile b "$file" '{body: $b}' | gh api -X POST "$R/issues/$pr/comments" --input - --jq '{id, url: .html_url}' 2>/dev/null; }
  if out=$(_pr_comment); then printf '%s\n' "$out"; return 0; fi
  sleep 2
  out=$(api "$R/issues/$pr/comments?per_page=100" --paginate --jq '.[]' \
    | jq -s --arg me "$me" --rawfile b "$file" '[.[] | select(.user.login == $me and .body == $b)] | last | select(. != null) | {id, url: .html_url}')
  if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  _pr_comment
}
host_pr_set_body() { jq -n --rawfile b "$2" '{body: $b}' | api -X PATCH "$R/pulls/$1" --input - >/dev/null; }

host_pr_resolve_thread() { # <pr> <thread-node-id>
  gql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' \
    -F id="$2" --jq '{resolved: .data.resolveReviewThread.thread.isResolved}'
}

# Squash with the PR title as the subject; release tooling reads it. Verified by
# the caller re-reading host_pr_get, never assumed from this call's exit code.
host_pr_merge() { # <pr> <subject>
  api -X PUT "$R/pulls/$1/merge" -f merge_method=squash -f commit_title="$2" >/dev/null
}

host_prs_open() {
  api "$R/pulls?state=open&per_page=100" --paginate \
    --jq '.[] | {number, title, head_ref: .head.ref, author: .user.login, url: .html_url, created_at}' | jq -s .
}
# Oldest first, unassigned, issues only (the issues endpoint also lists PRs).
host_issues_ready() { # <label>
  api "$R/issues?state=open&assignee=none&sort=created&direction=asc&per_page=100&labels=$(jq -rn --arg l "$1" '$l | @uri')" \
    --paginate --jq '.[] | select(.pull_request == null) | {number, title, created_at}' | jq -s .
}
