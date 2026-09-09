#!/usr/bin/env bash
# Shared helpers for ship's generic mechanics. Sourced, never executed.
# Serves ship's own scripts only: a repo's local gate never sources this.
#
# Every mechanic prints one JSON object on stdout (built with jq -n), a failing
# step's last 40 log lines on stderr, and exits 0 ok / 1 real failure / 2 tooling.
#
# Host adapter interface. Each mechanic sources exactly one of host/github.sh or
# host/ado.sh, chosen from the origin remote, never from a flag. An adapter
# defines every function below; reads come back in one vocabulary on both hosts:
# checks pending|success|failure, mergeable clean|conflict|unknown, review
# approved|changes|comment, threads resolved|open (or the call fails, which the
# mechanic reports as "unavailable").
#
#   host_tooling_reasons                 -> one missing-tool reason per line
#   host_tooling_install                 -> install the host CLI where absent; non-zero = could not
#   host_identity                        -> the login the claim is written as
#   host_can_push                        -> true | false | unknown
#   host_issue_get <n>                   -> {number,title,body,state,is_pr,labels[],assignees[],created_at,url}
#   host_issue_comments <n>              -> [{author,body,created_at}]
#   host_issue_blockers_open <n>         -> [n, ...] open blockers; non-zero exit = query unavailable
#   host_issue_linked_prs <n>            -> {closing:[{number,state}], mentions:[{number,state}]} (live PRs)
#   host_issue_assign <n> <identity>
#   host_issue_unassign <n> <identity>
#   host_issue_has_label <n> <label>     -> exit 0 when present
#   host_issue_add_label <n> <label>
#   host_issue_remove_label <n> <label>  (no-op success when absent)
#   host_issue_comment <n> <body>
#   host_issue_close <n>
#   host_issue_create <title> <body-file> <label> -> {number,url}
#   host_pr_create <head> <base> <title> <body-file> <issue> -> {number,url}
#   host_pr_get <pr>                     -> {number,url,title,body,head_sha,head_ref,base_ref,state,mergeable}
#   host_pr_for_branch <branch>          -> {number,state} of the newest PR with that head, or null
#   host_pr_checks <pr> <head_sha>       -> [{name,status}]
#   host_pr_reviews <pr> <head_sha>      -> {on_head:[{login,state,substantive}],total}
#   host_pr_threads <pr>                 -> [{id,resolved,author,path,body}]; non-zero exit = unavailable
#   host_pr_reviewer_blocked <pr> <login>-> JSON string | null
#   host_pr_request_review <pr> <login>  -> {requested,readback[]}
#   host_pr_comment <pr> <body-file>     -> {id,url}
#   host_pr_set_body <pr> <body-file>
#   host_pr_resolve_thread <pr> <thread> -> {resolved}
#   host_pr_merge <pr> <subject>         -> exit 0 once the host reports merged
#   host_prs_open                        -> [{number,title,head_ref,author,url,created_at}]
#   host_issues_ready <label>            -> [{number,title,created_at}] oldest first, unassigned, not PRs

SHIP_SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SHIP_SCRIPTS
readonly SHIP_CLAIM_COMMENT='🤖 Claimed by a ship run — implementation in progress.'

# ship_tooling <msg>: the exit-2 shape. Also used when the host adapter itself
# cannot load, so a broken install still emits the contract, not "command not found".
ship_tooling() { jq -n --arg e "$1" '{error: $e}'; exit 2; }
ship_fail()    { jq -n --arg e "$1" '{error: $e}'; exit 1; }

# ship_tail40 <file>: a failing step's evidence, never the whole log.
ship_tail40() { tail -n 40 "$1" >&2; }

# Branch convention: <type>/<slug>-<issue>. The "-<issue>" suffix is what
# preflight greps for on the remote.
ship_branch()           { printf '%s/%s-%s' "$1" "$2" "$3"; }
ship_branch_suffix_re() { printf -- '-%s$' "$1"; }

# The main checkout, even when run from inside a worktree: --git-common-dir
# points at the primary .git, so a run started in a worktree never nests another.
ship_main_checkout() {
  local common
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  dirname "$common"
}

# Sibling container beside the checkout: <parent>/<repo>.worktrees
ship_worktree_container() {
  local root; root=$(ship_main_checkout) || return 1
  printf '%s/%s.worktrees' "$(dirname "$root")" "$(basename "$root")"
}

# The base ref, resolved from origin/HEAD, never a hardcoded branch (ADO
# defaults vary). Refreshes the symbolic ref when the clone never recorded it.
ship_base_ref() {
  local ref
  ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) \
    || { git remote set-head origin -a >/dev/null 2>&1 \
         && ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null); } \
    || return 1
  printf '%s' "${ref#refs/remotes/}"
}
ship_base_branch() { local b; b=$(ship_base_ref) || return 1; printf '%s' "${b#origin/}"; }

# Host detection from the origin remote. Sets SHIP_HOST and the host's
# identifiers; no --host flag and no env var, because every Bash call is a fresh
# shell and a per-call flag is one more thing prose can get wrong.
ship_detect_host() {
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 1
  case $url in
    *github.com[:/]*)
      SHIP_HOST=github
      local p=${url#*github.com}; p=${p#[:/]}; p=${p%.git}; p=${p%/}
      SHIP_OWNER=${p%%/*}; SHIP_REPO=${p#*/}
      SHIP_REPO_SLUG="$SHIP_OWNER/$SHIP_REPO" ;;
    *dev.azure.com/*)
      # https://[user@]dev.azure.com/<org>/<project>/_git/<repo>
      SHIP_HOST=ado
      local p=${url#*dev.azure.com/}; p=${p%.git}
      SHIP_ORG=${p%%/*}; p=${p#*/}
      SHIP_PROJECT=${p%%/_git/*}; SHIP_REPO=${p##*/_git/}
      SHIP_ORG_URL="https://dev.azure.com/$SHIP_ORG"
      SHIP_REPO_SLUG="$SHIP_ORG/$SHIP_PROJECT/$SHIP_REPO" ;;
    *@vs-ssh.visualstudio.com:v3/*)
      # git@ssh.dev.azure.com:v3/<org>/<project>/<repo> and the visualstudio.com twin
      SHIP_HOST=ado
      local p=${url#*:v3/}
      SHIP_ORG=${p%%/*}; p=${p#*/}
      SHIP_PROJECT=${p%%/*}; SHIP_REPO=${p#*/}
      SHIP_ORG_URL="https://dev.azure.com/$SHIP_ORG"
      SHIP_REPO_SLUG="$SHIP_ORG/$SHIP_PROJECT/$SHIP_REPO" ;;
    *ssh.dev.azure.com:v3/*)
      SHIP_HOST=ado
      local p=${url#*:v3/}
      SHIP_ORG=${p%%/*}; p=${p#*/}
      SHIP_PROJECT=${p%%/*}; SHIP_REPO=${p#*/}
      SHIP_ORG_URL="https://dev.azure.com/$SHIP_ORG"
      SHIP_REPO_SLUG="$SHIP_ORG/$SHIP_PROJECT/$SHIP_REPO" ;;
    *.visualstudio.com/*)
      # https://<org>.visualstudio.com/<project>/_git/<repo> (or DefaultCollection/)
      SHIP_HOST=ado
      local hostpart=${url#*://}; hostpart=${hostpart#*@}
      SHIP_ORG=${hostpart%%.visualstudio.com*}
      local p=${url#*.visualstudio.com/}; p=${p#DefaultCollection/}; p=${p%.git}
      SHIP_PROJECT=${p%%/_git/*}; SHIP_REPO=${p##*/_git/}
      SHIP_ORG_URL="https://dev.azure.com/$SHIP_ORG"
      SHIP_REPO_SLUG="$SHIP_ORG/$SHIP_PROJECT/$SHIP_REPO" ;;
    *) return 1 ;;
  esac
  SHIP_PROJECT=$(printf '%s' "${SHIP_PROJECT:-}" | sed 's/%20/ /g')
  export SHIP_HOST SHIP_OWNER SHIP_REPO SHIP_REPO_SLUG SHIP_ORG SHIP_PROJECT SHIP_ORG_URL
}

# ship_load_host: detect and source the adapter, or exit 2 with the contract.
ship_load_host() {
  ship_detect_host || ship_tooling "cannot derive the host from the origin remote"
  # shellcheck source=/dev/null
  source "$SHIP_SCRIPTS/host/$SHIP_HOST.sh" || ship_tooling "cannot load host adapter $SHIP_HOST"
}

# Triage roles are canonical names; the label strings a repo actually uses live
# in docs/agents/triage-labels.md (a fixed two-column table the setup skill
# writes). Falls back to the canonical name when the file or row is missing.
ship_triage_label() {
  local role=$1 root file label
  root=$(ship_main_checkout) || { printf '%s' "$role"; return; }
  file="$root/docs/agents/triage-labels.md"
  label=$(grep -E "^\| *\`$role\` *\|" "$file" 2>/dev/null | head -1 \
    | awk -F'|' '{print $3}' | tr -d '` ')
  printf '%s' "${label:-$role}"
}

# Closing-keyword test, the same on both hosts: does <body> claim to close
# <issue>? Fenced blocks and inline code come out first (a PR quoting
# "Closes #n" while discussing another PR mentions the issue, it does not claim
# it). The "(#n, and #m)" run lets a multi-issue "Closes #75, #81" count for #81.
ship_body_closes() { # ship_body_closes <body> <issue> -> exit 0 when it does
  jq -e -n --arg body "$1" --arg n "$2" '
    $body
    | gsub("(?s)```.*?```"; "") | gsub("`[^`]*`"; "")
    | test("\\b(clos(e[sd]?|ing)|fix(e[sd]|ing)?|resolv(e[sd]?|ing))"
           + "\\s+(#[0-9]+[\\s,]+(and[\\s,]+)?)*#" + $n + "\\b"; "i")' >/dev/null
}
