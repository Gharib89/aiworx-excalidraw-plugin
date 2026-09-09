#!/usr/bin/env bash
# Azure DevOps adapter: the host_* interface from _lib.sh over the `az` CLI with
# the azure-devops extension. `az repos` / `az boards` where a subcommand
# exists; `az devops invoke` for what they lack (PR threads, iterations,
# statuses); never `az rest` or curl. One credential covers the run: `az login`
# (Entra) or AZURE_DEVOPS_EXT_PAT. Sourced by _lib.sh's ship_load_host; needs
# SHIP_ORG_URL, SHIP_PROJECT and SHIP_REPO set.
#
# Contract mapping (Host interface decision): label = tag, claim = Assigned To,
# issue comment = discussion entry, "Closes #n" = --work-items link plus
# transition on completion, PR comment = thread with status closed, thread
# resolved = status fixed|closed|wontFix|byDesign, CI = policy evaluations plus
# PR statuses, blocked-by = Predecessor links, merge = pr update --status completed.
#
# Verified live on the onboarding run (map ticket "Onboard the Azure DevOps repo
# and run ship attended"): every mechanic from preflight to merge and cleanup
# completed one attended run against Azure Repos + Boards + Pipelines.

ORG=(--org "$SHIP_ORG_URL")
PRJ=("${ORG[@]}" --project "$SHIP_PROJECT")
_pr_url() { printf '%s/%s/_git/%s/pullrequest/%s' "$SHIP_ORG_URL" "$(jq -rn --arg p "$SHIP_PROJECT" '$p | @uri')" "$SHIP_REPO" "$1"; }

# Reads retry once after 2 s; az is slow, so creates re-read rather than retry blindly.
azx() { az "$@" -o json 2>/dev/null || { sleep 2; az "$@" -o json; }; }
invoke() { # <http-method> <area> <resource> <api-version> [--route-parameters ...] [--in-file f]
  local m=$1 area=$2 res=$3 v=$4; shift 4
  azx devops invoke "${ORG[@]}" --http-method "$m" --area "$area" --resource "$res" --api-version "$v" "$@"
}

# The work item type for new items and the closed state come from the repo's
# tracker doc (fixed flag lines the setup skill writes), not the ship profile.
_tracker_flag() {
  local doc; doc="$(ship_main_checkout)/docs/agents/issue-tracker.md"
  grep -oE "\*\*$1: [^*]+\*\*" "$doc" 2>/dev/null | head -1 | sed -E "s/^\*\*$1: (.*)\.\*\*$/\1/"
}
ADO_WIT=$(_tracker_flag "Work item type"); ADO_WIT=${ADO_WIT:-Issue}
ADO_CLOSED=$(_tracker_flag "Closed state"); ADO_CLOSED=${ADO_CLOSED:-Done}

host_tooling_reasons() {
  command -v az  >/dev/null || echo "az not installed"
  command -v jq  >/dev/null || echo "jq not installed"
  command -v git >/dev/null || echo "git not installed"
  command -v az >/dev/null && ! az extension show --name azure-devops >/dev/null 2>&1 \
    && echo "azure-devops extension missing: az extension add --name azure-devops"
}
# Microsoft's documented Debian install plus the extension. Not yet measured
# behind the cloud sandbox proxy (map ticket "Probe a cloud session against the
# Azure DevOps repo"); on a developer machine the tooling reasons already name it.
host_tooling_install() {
  local sudo=""; [ "$(id -u)" -eq 0 ] || sudo="sudo -n"
  command -v az >/dev/null || curl -sL https://aka.ms/InstallAzureCLIDeb | $sudo bash
  az extension show --name azure-devops >/dev/null 2>&1 || az extension add --name azure-devops
}
# Entra login first; a PAT session has no `az account`, so fall back to the
# connection data of the authenticated user.
host_identity() {
  local id
  id=$(az account show --query user.name -o tsv 2>/dev/null) && [ -n "$id" ] && { printf '%s' "$id"; return 0; }
  invoke GET core connectionData 7.1 --query 'authenticatedUser.properties.Account.$value' -o tsv 2>/dev/null \
    | tr -d '"' | grep . 
}
# No cheap, reliable push probe exists on ADO without a security-namespace
# walk; preflight reports unknown and the merge tells.
host_can_push() { printf 'unknown'; }

_wi_norm() {
  jq --arg closed "$ADO_CLOSED" '{number: .id, title: .fields["System.Title"],
    body: (.fields["System.Description"] // ""),
    state: (if (.fields["System.State"] == $closed) or (.fields["System.State"] == "Removed") then "closed" else "open" end),
    is_pr: false,
    labels: ((.fields["System.Tags"] // "") | split(";") | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != ""))),
    assignees: [.fields["System.AssignedTo"].uniqueName // empty],
    created_at: .fields["System.CreatedDate"],
    url: (._links.html.href // ($org + "/" + ($project | @uri) + "/_workitems/edit/" + (.id | tostring)))}' \
    --arg org "$SHIP_ORG_URL" --arg project "$SHIP_PROJECT"
}
_wi_show() { azx boards work-item show "${ORG[@]}" --id "$1" --expand relations; }
host_issue_get() { _wi_show "$1" | _wi_norm; }
host_issue_comments() {
  # "7.1-preview" exactly: az parses the version as a float and chokes on "7.1-preview.4".
  invoke GET wit comments 7.1-preview --route-parameters project="$SHIP_PROJECT" workItemId="$1" \
    | jq '[.comments[] | {author: .createdBy.uniqueName, body: .text, created_at: .createdDate}]'
}
# Predecessor links (System.LinkTypes.Dependency-Reverse) are the blockers; ADO
# has the concept, so a failed read is "unavailable", never vacuous.
host_issue_blockers_open() {
  local ids out='[]' id
  ids=$(_wi_show "$1" | jq -r '[.relations[]? | select(.rel == "System.LinkTypes.Dependency-Reverse") | .url | split("/") | last] | .[]') || return 1
  for id in $ids; do
    st=$(host_issue_get "$id" | jq -r .state) || return 1
    [ "$st" = open ] && out=$(jq --argjson i "$id" '. + [$i]' <<<"$out")
  done
  printf '%s\n' "$out"
}
# A linked PR closes the work item on completion, so every live linked PR is
# "closing"; ADO has no undirected mention to separate out.
host_issue_linked_prs() {
  local ids out='{"closing":[],"mentions":[]}' id st
  ids=$(_wi_show "$1" | jq -r '[.relations[]? | select(.rel == "ArtifactLink" and (.url | startswith("vstfs:///Git/PullRequestId/")))
          | .url | split("%2F") | last] | .[]') || return 1
  for id in $ids; do
    st=$(azx repos pr show "${ORG[@]}" --id "$id" | jq -r .status) || return 1
    case $st in
      active)    out=$(jq --argjson i "$id" '.closing += [{number: $i, state: "open"}]' <<<"$out") ;;
      completed) out=$(jq --argjson i "$id" '.closing += [{number: $i, state: "merged"}]' <<<"$out") ;;
    esac
  done
  printf '%s\n' "$out"
}
host_issue_assign()   { azx boards work-item update "${ORG[@]}" --id "$1" --assigned-to "$2" >/dev/null; }
host_issue_unassign() { azx boards work-item update "${ORG[@]}" --id "$1" --fields "System.AssignedTo=" >/dev/null; }
_tags() { host_issue_get "$1" | jq -r '.labels | join("; ")'; }
host_issue_has_label() { host_issue_get "$1" | jq -e --arg l "$2" '.labels | index($l)' >/dev/null; }
host_issue_add_label() {
  host_issue_has_label "$1" "$2" && return 0
  local t; t=$(_tags "$1") || return 1
  azx boards work-item update "${ORG[@]}" --id "$1" --fields "System.Tags=${t:+$t; }$2" >/dev/null
}
# Removing the LAST tag needs a json-patch `remove`: the server ignores an empty
# System.Tags value however it is sent (`--fields`, `add ""`, `replace ""`), and
# `az devops invoke` cannot send application/json-patch+json, so this one call is
# `az rest` on the Entra token (a PAT-only session fails it and reports false).
host_issue_remove_label() {
  host_issue_has_label "$1" "$2" || return 0
  local t; t=$(host_issue_get "$1" | jq -r --arg l "$2" '[.labels[] | select(. != $l)] | join("; ")') || return 1
  if [ -n "$t" ]; then
    azx boards work-item update "${ORG[@]}" --id "$1" --fields "System.Tags=$t" >/dev/null
  else
    az rest --method patch --url "$SHIP_ORG_URL/_apis/wit/workitems/$1?api-version=7.1" \
      --resource 499b84ac-1321-427f-aa17-267ca6975798 --headers "Content-Type=application/json-patch+json" \
      --body '[{"op":"remove","path":"/fields/System.Tags"}]' -o none 2>/dev/null
  fi
}
host_issue_comment() { azx boards work-item update "${ORG[@]}" --id "$1" --discussion "$2" >/dev/null; }
host_issue_close()   { azx boards work-item update "${ORG[@]}" --id "$1" --state "$ADO_CLOSED" >/dev/null; }
# Markdown body goes in as preformatted HTML: the description field is HTML.
_html_pre() { jq -Rs '"<pre>" + (. | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;")) + "</pre>"' -r "$1"; }
host_issue_create() { # <title> <body-file> <label>
  local out
  out=$(azx boards work-item create "${PRJ[@]}" --type "$ADO_WIT" --title "$1" --description "$(_html_pre "$2")" \
        ${3:+--fields "System.Tags=$3"}) \
    || out=$(azx boards query "${PRJ[@]}" --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] = '${1//\'/\'\'}' AND [System.CreatedBy] = @me ORDER BY [System.CreatedDate] DESC" \
             | jq 'first | select(. != null)') || return 1
  [ -n "$out" ] || return 1
  jq '{number: .id, url: ._links.html.href}' <<<"$out"
}

host_pr_create() { # <head> <base> <title> <body-file> <issue>
  local out
  out=$(azx repos pr create "${PRJ[@]}" --repository "$SHIP_REPO" --source-branch "$1" --target-branch "$2" \
        --title "$3" --description "$(cat "$4")" --draft false ${5:+--work-items "$5"}) \
    || out=$(azx repos pr list "${PRJ[@]}" --repository "$SHIP_REPO" --source-branch "$1" --status active --top 1 | jq 'first | select(. != null)') \
    || return 1
  [ -n "$out" ] || return 1
  jq --arg u "$(_pr_url "$(jq -r .pullRequestId <<<"$out")")" '{number: .pullRequestId, url: $u}' <<<"$out"
}
_pr_norm() {
  jq --arg u "$1" '{number: .pullRequestId, url: $u, title, body: (.description // ""),
    head_sha: .lastMergeSourceCommit.commitId, head_ref: (.sourceRefName | ltrimstr("refs/heads/")),
    base_ref: (.targetRefName | ltrimstr("refs/heads/")),
    state: (if .status == "completed" then "merged" elif .status == "active" then "open" else "closed" end),
    mergeable: (if .mergeStatus == "conflicts" then "conflict" elif .mergeStatus == "succeeded" then "clean" else "unknown" end)}'
}
host_pr_get() { azx repos pr show "${ORG[@]}" --id "$1" | _pr_norm "$(_pr_url "$1")"; }
host_pr_for_branch() {
  azx repos pr list "${PRJ[@]}" --repository "$SHIP_REPO" --source-branch "$1" --status all --top 1 \
    | jq 'first | if . == null then null else {number: .pullRequestId,
        state: (if .status == "completed" then "merged" elif .status == "active" then "open" else "closed" end)} end'
}
# Policy evaluations (build validation, required reviewers) plus PR statuses.
host_pr_checks() { # <pr> <head_sha>
  local pol st
  pol=$(azx repos pr policy list "${ORG[@]}" --id "$1" | jq '[.[] | select(.configuration.isEnabled == true)
      | select(.status != "notApplicable")
      | {name: (.configuration.settings.displayName // .configuration.type.displayName),
         status: (if .status == "approved" then "success" elif (.status | IN("queued","running")) then "pending" else "failure" end)}]') || return 1
  # A status is re-posted per transition (queued → pending → final), so only the
  # newest row per context counts; notApplicable means "no check here", not red.
  st=$(invoke GET git pullRequestStatuses 7.1 --route-parameters project="$SHIP_PROJECT" repositoryId="$SHIP_REPO" pullRequestId="$1" \
      | jq '[.value[] | {name: ((.context.genre // "status") + "/" + .context.name), created: .creationDate,
         status: (if .state == "succeeded" then "success" elif .state == "notApplicable" then "skip"
                  elif (.state == null) or (.state | IN("pending","notSet")) then "pending" else "failure" end)}]
         | group_by(.name) | map(sort_by(.created) | last | del(.created)) | map(select(.status != "skip"))') || st='[]'
  jq -n --argjson a "$pol" --argjson b "$st" '$a + $b | group_by(.name) | map(last)'
}
_threads_raw() { invoke GET git pullRequestThreads 7.1 --route-parameters project="$SHIP_PROJECT" repositoryId="$SHIP_REPO" pullRequestId="$1"; }
# {id, created} of the newest iteration: a push makes one, so "on the current
# head" means iteration == this id, or (for a PR-level thread with no iteration
# context, how a build-service reviewer posts) published after it was created.
_latest_iteration() {
  invoke GET git pullRequestIterations 7.1 --route-parameters project="$SHIP_PROJECT" repositoryId="$SHIP_REPO" pullRequestId="$1" \
    | jq '(.value | max_by(.id)) as $i | {id: ($i.id // 0), created: ($i.createdDate // "")}'
}
# A service identity (a build service) has an empty uniqueName; its displayName is the login then.
_author_login='(.comments[0].author | if (.uniqueName // "") != "" then .uniqueName else .displayName end)'
# Votes are the review rows; a reviewer that only opened threads on the latest
# iteration counts as a substantive comment review on the head.
host_pr_reviews() { # <pr> <head_sha>
  local votes it threads
  votes=$(azx repos pr reviewer list "${ORG[@]}" --id "$1" | jq '[.[] | select(.vote != 0)
      | {login: .uniqueName, state: (if .vote > 0 then "approved" else "changes" end), substantive: true}]') || return 1
  it=$(_latest_iteration "$1") || it='{"id":0,"created":""}'
  threads=$(_threads_raw "$1" | jq --argjson it "$it" '[.value[] | select(.isDeleted != true)
      | select(.comments[0].commentType != "system")
      | select((.pullRequestThreadContext.iterationContext.secondComparingIteration == $it.id)
               or (.pullRequestThreadContext == null and .publishedDate >= $it.created))
      | {login: '"$_author_login"', state: "comment", substantive: true}] | unique_by(.login)') || threads='[]'
  jq -n --argjson v "$votes" --argjson t "$threads" '{on_head: ($v + $t), total: ($v + $t | length)}'
}
host_pr_threads() {
  _threads_raw "$1" | jq '[.value[] | select(.isDeleted != true) | select(.comments[0].commentType != "system")
    | {id: (.id | tostring), resolved: (.status | IN("fixed","closed","wontFix","byDesign")),
       author: '"$_author_login"', path: .threadContext.filePath, body: .comments[0].content}]'
}
host_pr_reviewer_blocked() { echo null; }
host_pr_request_review() { # <pr> <login>
  local ok=false rb
  azx repos pr reviewer add "${ORG[@]}" --id "$1" --reviewers "$2" >/dev/null && ok=true
  rb=$(azx repos pr reviewer list "${ORG[@]}" --id "$1" | jq '[.[] | .uniqueName, .displayName]') || rb='[]'
  jq -n --argjson ok "$ok" --argjson rb "$rb" --arg l "$2" \
    '{requested: ($ok and ([$rb[] | ascii_downcase] | index($l | ascii_downcase) != null)), readback: $rb}'
}
# A closed thread: visible, and a comment-resolution policy never blocks on it.
host_pr_comment() { # <pr> <body-file>
  local f out; f=$(mktemp)
  jq -n --rawfile b "$2" '{comments: [{parentCommentId: 0, content: $b, commentType: 1}], status: "closed"}' > "$f"
  out=$(invoke POST git pullRequestThreads 7.1 --route-parameters project="$SHIP_PROJECT" repositoryId="$SHIP_REPO" pullRequestId="$1" --in-file "$f")
  local rc=$?; rm -f "$f"; [ $rc -eq 0 ] || return 1
  jq --arg u "$(_pr_url "$1")" '{id: .id, url: ($u + "?discussionId=" + (.id | tostring))}' <<<"$out"
}
host_pr_set_body() { azx repos pr update "${ORG[@]}" --id "$1" --description "$(cat "$2")" >/dev/null; }
host_pr_resolve_thread() { # <pr> <thread-id>
  local f out; f=$(mktemp); printf '{"status":"fixed"}' > "$f"
  out=$(invoke PATCH git pullRequestThreads 7.1 --route-parameters project="$SHIP_PROJECT" repositoryId="$SHIP_REPO" pullRequestId="$1" threadId="$2" --in-file "$f")
  local rc=$?; rm -f "$f"; [ $rc -eq 0 ] || return 1
  jq '{resolved: (.status | IN("fixed","closed","wontFix","byDesign"))}' <<<"$out"
}
host_pr_merge() { # <pr> <subject>
  azx repos pr update "${ORG[@]}" --id "$1" --status completed --squash true --delete-source-branch true \
    --transition-work-items true --merge-commit-message "$2" >/dev/null
}
host_prs_open() {
  azx repos pr list "${PRJ[@]}" --repository "$SHIP_REPO" --status active --top 100 \
    | jq --arg base "$SHIP_ORG_URL" --arg p "$(jq -rn --arg p "$SHIP_PROJECT" '$p | @uri')" --arg r "$SHIP_REPO" \
      '[.[] | {number: .pullRequestId, title, head_ref: (.sourceRefName | ltrimstr("refs/heads/")), author: .createdBy.uniqueName,
              url: ($base + "/" + $p + "/_git/" + $r + "/pullrequest/" + (.pullRequestId | tostring)), created_at: .creationDate}]'
}
host_issues_ready() { # <label>
  azx boards query "${PRJ[@]}" --wiql "SELECT [System.Id], [System.Title], [System.CreatedDate] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> '$ADO_CLOSED' AND [System.State] <> 'Removed' AND [System.Tags] CONTAINS '${1//\'/\'\'}' AND [System.AssignedTo] = '' ORDER BY [System.CreatedDate] ASC" \
    | jq '[.[] | {number: .id, title: .fields["System.Title"], created_at: .fields["System.CreatedDate"]}]'
}
