# Phase 7 — driving an automated review to convergence

**In this repo: GitHub Copilot, requested per round — soft cap four rounds.**
Phase-4 self-review + green CI is still the gate; these rounds are a second pair
of eyes on top. `CLAUDE.md`'s *Code review* section is the authority on the
policy; this file holds the mechanics.

## Requesting a round

Copilot is a **requested reviewer, not a webhook**. Nothing arrives until you
ask, and asking is one call:

```bash
gh api -X POST "repos/{owner}/{repo}/pulls/$PR/requested_reviewers" \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
gh api "repos/{owner}/{repo}/pulls/$PR" --jq '.requested_reviewers | map(.login)'
```

**The read-back is the whole point of the second call.** The POST answers `200`
and adds **nobody** when Copilot code review is not enabled for the account, so
the response body proves nothing. A `requested_reviewers` that comes back
without `copilot-pull-request-reviewer[bot]` means the round was never queued:
mark the exit **degraded** and carry on to phase 8. Waiting is the one thing
that cannot help.

One request yields **one review**. Copilot does not re-review on push, so each
round after the first starts by requesting again — which is why a run counts its
rounds instead of assuming them.

## The loop

1. Request the round, and read the request back.
2. Poll for it to land (mechanics below).
3. Triage every comment: fix the valid ones in one batched push, reply on each
   thread (`fixed in <sha>` / decline + one-line reason).
4. Request the next round against the corrected tree.

**Converged = the latest round returns nothing actionable + every thread from
all rounds dispositioned + green CI.** A round with no actionable comments is
the convergence signal — stop requesting, you are done. Copilot's dispositions
get their **own block** in the merge summary.

**The soft cap.** A round 4 that is still substantive is a shape problem more
rounds won't fix — stop, mark the exit **degraded** in the merge summary, and
leave the call to the human at the merge gate.

**Triage, don't apply.** Copilot does not know this repo's constraints: verify
every nit against the **pinned** dependency versions, harden rather than rip out
capability, and reject known non-issues with a one-line reason. The two rails
from phase 4 apply here too — check a claim about what exists in the repo
against `origin/main` rather than the worktree, and judge a finding's claim
separately from the evidence it cites.

## Poll mechanics

Reviews take minutes. Run
`scripts/poll-pr.sh <n> --await-review "copilot-pull-request-reviewer[bot]"`
inline — a bounded foreground loop that returns ONE JSON summary: check
conclusions, reviews keyed to the current head sha, `reviewer_blocked`,
`mergeable_state`. `done: false` means the window closed first — re-run to
extend; never a detached background monitor. No subagent: the script already
projects its output. The poll is the **landing signal** only — before triage
fetch the round's review body and comment threads. Auto-triage those on the
**judgment tier**.

**A round is a review with a body.** Replying to a thread posts a review row of
its own — current head sha, state `COMMENTED`, empty body — so answering round N
manufactures rows that look like round N+1 arriving. `poll-pr.sh` counts only
`substantive: true`; hold any hand-rolled check to the same bar.

## A round that hasn't landed

Read the request-back first, because the two causes need opposite handling:

- **Never queued** (`requested_reviewers` came back without Copilot): the
  reviewer is **unavailable**, not late. Retry the request once; if it still
  adds nobody, proceed on green CI and mark the merge summary **degraded**, and
  say in it that Copilot review is not enabled for the account so the human can
  fix it at the source. Do not spend a second poll window on it.
- **Queued but quiet** (Copilot is in `requested_reviewers`, no review yet):
  keep polling. `reviewer_blocked` carries any banner the reviewer posted about
  quota or queueing; non-null with `done: false` means waiting, not missing.

A review body that is only an error notice with zero comments is the same
failure as never queueing: re-request once, then degraded.

After any merge command, re-verify PR state before declaring done
(`scripts/merge-and-verify.sh` does).
