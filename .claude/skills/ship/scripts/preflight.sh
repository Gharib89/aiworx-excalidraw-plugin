#!/usr/bin/env bash
# ship phase 0: is <issue> actionable, and can this account finish the run?
#
# Push permission first: every read-only call succeeds for an account that
# cannot push, so a wrong login stays invisible until the phase-9 merge answers
# 404 with the whole run already spent. Then the profile (headings, the Schema
# line against this ship's metadata.profile-schema, and the Host cross-check),
# then every not-actionable reason, collected rather than
# first-hit so the human reads one full stop report.
#
#   preflight <issue> [--unattended]
#
# stdout: {host, repo, identity, profile, ok, reasons[], mentions[], pruned[]}
#   reasons use the stop names verbatim, detail after a colon:
#   closed · is a pull request · already claimed · existing PR · existing branch
#   · worktree exists · not triaged: run /triage first · ready-for-human:
#   attended only · profile missing · profile invalid: <detail>
#   mentions[] lists live PRs that name the issue without closing it: context
#   for phase 1, never a stop. pruned[] lists worktrees removed because their
#   PR is merged or closed.
# exit: 0 actionable · 1 not actionable · 2 tooling, or host-unreachable
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }

n=${1:?usage: preflight <issue> [--unattended]}; shift
unattended=false
while [ $# -gt 0 ]; do
  case $1 in
    --unattended) unattended=true; shift ;;
    *) ship_tooling "unknown flag: $1" ;;
  esac
done

ship_load_host
identity=null
unreachable() { # <detail>
  jq -n --arg h "$SHIP_HOST" --arg r "$SHIP_REPO_SLUG" --argjson id "$identity" --arg d "$1" \
    '{host: $h, repo: $r, identity: $id, ok: false, reasons: ["host-unreachable: " + $d], mentions: [], pruned: []}'
  exit 2
}

missing=$(host_tooling_reasons)
[ -z "$missing" ] || unreachable "$(paste -sd';' <<<"$missing")"
me=$(host_identity) || unreachable "cannot read the signed-in identity"
identity=$(jq -n --arg m "$me" '$m')
push=$(host_can_push) || unreachable "cannot read repository permissions"
case $push in
  true) ;;
  unknown) echo "push permission could not be proven on $SHIP_HOST; the merge will tell" >&2 ;;
  *) unreachable "$me cannot push to $SHIP_REPO_SLUG; switch to the account with access" ;;
esac

root=$(ship_main_checkout) || ship_tooling "not inside a git checkout"
reasons=()

# Profile: presence, the fourteen headings in order, the Schema line, and the
# Host cross-check. Read from the checkout preflight runs in, not the main one:
# a run inside a worktree is governed by the profile on its own branch, and a
# repo's first profile lands on a branch before it ever reaches main.
profile="$(git rev-parse --show-toplevel)/docs/agents/ship.md"
if [ ! -f "$profile" ]; then
  reasons+=("profile missing: $profile; run /setup-skills")
else
  expected=$'Host\nWorktree\nLocal gate\nCI\nReviewers\nCoding standards\nVerification\nVersioning and changelog\nPR\nPublic surface\nTriage\nDocs sync\nCurrent docs\nCloud lane'
  actual=$(grep -E '^## ' "$profile" | sed 's/^## //; s/ *$//')
  if [ "$actual" != "$expected" ]; then
    detail=$(diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | grep -E '^[<>]' | sed 's/^< /missing or misplaced: /; s/^> /unexpected: /' | paste -sd';')
    reasons+=("profile invalid: headings; $detail")
  fi
  skill="$SHIP_SCRIPTS/../SKILL.md"
  reads=$(awk 'NR>1 && /^---$/{exit} /^  profile-schema:/{print $2; exit}' "$skill")
  shipv=$(awk 'NR>1 && /^---$/{exit} /^  version:/{print $2; exit}' "$skill")
  schema=$(awk '/^## /{exit} /^Schema: /{print $2; exit}' "$profile")
  case $schema in
    '') reasons+=("profile invalid: no Schema line; run /setup-skills") ;;
    "$reads") ;;
    *) if [ "$schema" -lt "$reads" ] 2>/dev/null; then
         reasons+=("profile invalid: schema $schema, ship expects $reads; run /setup-skills")
       else
         reasons+=("profile invalid: schema $schema, ship $shipv reads $reads; refresh ship")
       fi ;;
  esac
  declared=$(awk '/^## Host/{f=1;next} /^## /{f=0} f && /^Host:/{sub(/^Host: */,""); print; exit}' "$profile" | tr -d ' `')
  [ "$declared" = "$SHIP_HOST" ] || reasons+=("profile invalid: Host mismatch (profile says '${declared:-nothing}', remote is $SHIP_HOST)")
fi

# Prune sibling worktrees whose PR is merged or closed. Never touches one whose
# PR is open or unknown.
pruned='[]'
container=$(ship_worktree_container)
if [ -d "$container" ]; then
  for wt in "$container"/*/; do
    [ -d "$wt" ] || continue
    wt=${wt%/}
    br=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
    pr=$(host_pr_for_branch "$br") || continue
    case $(jq -r '.state // "none"' <<<"$pr") in
      merged|closed)
        git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1 \
          && git -C "$root" branch -D "$br" >/dev/null 2>&1
        pruned=$(jq --arg w "$wt" '. + [$w]' <<<"$pruned") ;;
    esac
  done
  git -C "$root" worktree prune >/dev/null 2>&1
fi

# The issue itself.
mentions='[]'
if ! issue=$(host_issue_get "$n"); then
  reasons+=("issue #$n not found or unreadable")
else
  [ "$(jq -r .state <<<"$issue")" = open ] || reasons+=("closed")
  [ "$(jq -r .is_pr <<<"$issue")" = false ] || reasons+=("is a pull request")
  assignees=$(jq -r '.assignees | join(", ")' <<<"$issue")
  [ -z "$assignees" ] || reasons+=("already claimed: $assignees")

  rfa=$(ship_triage_label ready-for-agent); rfh=$(ship_triage_label ready-for-human)
  if jq -e --arg l "$rfa" '.labels | index($l)' <<<"$issue" >/dev/null; then :
  elif jq -e --arg l "$rfh" '.labels | index($l)' <<<"$issue" >/dev/null; then
    [ "$unattended" = false ] || reasons+=("ready-for-human: attended only")
  else
    reasons+=("not triaged: run /triage first")
  fi

  if linked=$(host_issue_linked_prs "$n"); then
    closing=$(jq -r '[.closing[] | "#\(.number) (\(.state))"] | join(", ")' <<<"$linked")
    [ -z "$closing" ] || reasons+=("existing PR: $closing")
    mentions=$(jq -c '[.mentions[].number]' <<<"$linked")
  else
    reasons+=("existing PR: cross-references unreadable, cannot prove none")
  fi
fi

br=$(git -C "$root" ls-remote --heads origin "*-$n" 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||' | paste -sd, -) \
  || reasons+=("existing branch: remote unreadable, cannot prove none")
[ -z "$br" ] || reasons+=("existing branch: $br")

for wt in "$container"/*-"$n"/; do
  [ -d "$wt" ] && reasons+=("worktree exists: ${wt%/}")
done

ok=true; [ "${#reasons[@]}" -eq 0 ] || ok=false
printf '%s\n' "${reasons[@]+"${reasons[@]}"}" | jq -Rs --arg h "$SHIP_HOST" --arg r "$SHIP_REPO_SLUG" \
  --argjson id "$identity" --arg p "$profile" --argjson ok "$ok" --argjson m "$mentions" --argjson pr "$pruned" \
  '{host: $h, repo: $r, identity: $id, profile: $p, ok: $ok,
    reasons: (split("\n") | map(select(. != ""))), mentions: $m, pruned: $pr}'
$ok
