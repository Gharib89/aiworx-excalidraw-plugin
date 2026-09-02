# Phase 7 — driving an automated review to convergence

**In this repo: GitHub Copilot, requested per round — soft cap four rounds.**
Phase-4 self-review + green CI is still the gate; these rounds are a second pair
of eyes on top. `CLAUDE.md`'s *Code review* section is the authority on the
policy; this file holds the mechanics.

## Requesting a round

Copilot is a **requested reviewer, not a webhook**. Nothing arrives until you
ask. The request is one POST; the second call is the mandatory read-back:

```bash
PR=219
gh api -X POST "repos/{owner}/{repo}/pulls/$PR/requested_reviewers" \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
gh api "repos/{owner}/{repo}/issues/$PR/timeline" --paginate \
  --jq '.[] | select(.event == "review_requested") | .requested_reviewer.login'
```

**Read the timeline, not `requested_reviewers`.** The POST's own response proves
nothing, and neither does `requested_reviewers`: Copilot never appears there.
That array comes back `[]` on a request that queued perfectly and delivered its
review two and a half minutes later — so treating an empty array as *not
enabled* abandons a round that was already on its way. The `review_requested`
event is the proof the request landed.

The two endpoints name the same reviewer differently: the timeline event says
**`Copilot`**, the review it posts is authored by
**`copilot-pull-request-reviewer[bot]`**, and the check run is
`copilot-pull-request-reviewer`. Match whichever the endpoint you are reading
uses.

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

- **Never queued** (no `review_requested` event on the timeline): the reviewer
  is **unavailable**, not late. Retry the request once; if no event appears,
  proceed on green CI and mark the merge summary **degraded**, saying that the
  request never landed so the human can fix it at the source. Do not spend a
  second poll window on it.
- **Queued but quiet** (the event is there, no review yet): keep polling — a
  round normally takes two to four minutes. `reviewer_blocked` surfaces a
  reviewer comment about rate limits or quota (the three phrases
  `poll-pr.sh` matches); non-null with `done: false` means waiting, not missing.

A review body that is only an error notice with zero comments is the same
failure as never queueing: re-request once, then degraded.

After any merge command, re-verify PR state before declaring done
(`scripts/merge-and-verify.sh` does).
