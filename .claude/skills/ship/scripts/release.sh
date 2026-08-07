#!/usr/bin/env bash
# Ship claim release — the counterpart to claim.sh, so a claim never outlives the
# run that took it. Two callers, two label outcomes:
#
#   - after a merge (phase 9, called by merge-and-verify.sh): release only. The
#     issue is closed and already carries its category label.
#   - after a blocked stop (--handback): release AND re-apply needs-triage. The
#     claim stripped ready-for-agent, so releasing alone would leave the issue in
#     no triage bucket at all. needs-triage, not ready-for-agent: a run that
#     stopped blocked is a signal a human should look, not an invitation for the
#     next agent to walk into the same block.
#
# Idempotent — releasing an issue that holds no claim is a no-op success. The
# label state is checked rather than assumed: a DELETE 404s the same way whether
# the label was already gone or the call itself failed, and reporting a release
# that didn't happen would leave exactly the residue this script exists to stop.
#
#   scripts/release.sh <issue> [--handback]
#
# Prints JSON {released, already, handed_back} once the claim is gone, or
# {released: false, error} if the release call itself failed — same shape split
# merge-and-verify.sh uses. Exit 0 = the claim is gone (and the hand-back landed,
# if asked for); 1 = it isn't, so the caller must say so rather than report a
# clean stop; 2 = bad arguments.
set -uo pipefail
N="${1:?usage: release.sh <issue> [--handback]}"
shift
HANDBACK=false
while [ $# -gt 0 ]; do
  case "$1" in
    # A typo'd flag must not read as release-only: the caller would believe a
    # hand-back landed that never ran.
    --handback) HANDBACK=true; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

api() { gh api "$@" || { sleep 2; gh api "$@"; }; }

ISS=$(api "repos/{owner}/{repo}/issues/$N") || exit 1

ALREADY=true
if jq -e '.labels[] | select(.name == "agent-working")' <<<"$ISS" >/dev/null; then
  ALREADY=false
  api -X DELETE "repos/{owner}/{repo}/issues/$N/labels/agent-working" >/dev/null || {
    echo '{"released": false, "error": "claim release failed"}'
    exit 1
  }
fi

# Adding a label already present is a no-op success on GitHub, so this needs no
# guard of its own.
HANDED_BACK=false
if $HANDBACK; then
  api -X POST "repos/{owner}/{repo}/issues/$N/labels" -f 'labels[]=needs-triage' >/dev/null \
    && HANDED_BACK=true
fi

jq -n --argjson already "$ALREADY" --argjson handed_back "$HANDED_BACK" \
  '{released: true, already: $already, handed_back: $handed_back}'

# A requested hand-back that didn't land leaves the issue unclaimed but unlabelled
# — the caller is already stopping, and needs to know this one didn't take.
if $HANDBACK && ! $HANDED_BACK; then exit 1; fi
exit 0
