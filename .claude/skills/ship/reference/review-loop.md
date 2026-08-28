# Phase 7 — driving an automated review to convergence

**In this repo: CodeRabbit, automatic, until converged — soft cap four rounds**
(configured in `.coderabbit.yaml`; no other bot reviews). Phase-4 self-review +
green CI is still the gate; these rounds are a second pair of eyes on top.
`CLAUDE.md`'s *Code review* section is the authority on the policy; this file
holds the mechanics.

## The loop

CodeRabbit reviews the PR on open and posts an **incremental review** after
every push — there is no request step. Each round:

1. Wait for the round's review to land (poll mechanics below).
2. Triage every comment: fix the valid ones in one batched push, reply on each
   thread (`fixed in <sha>` / decline + one-line reason).
3. That push triggers the next incremental round on the corrected tree.

**Converged = the latest round returns nothing actionable + every thread from
all rounds dispositioned + green CI.** A round with no actionable comments is
the convergence signal — stop pushing, you are done. CodeRabbit's dispositions
get their **own block** in the merge summary.

**The soft cap.** A round 4 that is still substantive is a shape problem more
rounds won't fix — stop, mark the exit **degraded** in the merge summary, and
leave the call to the human at the merge gate.

**Triage, don't apply.** CodeRabbit does not know this repo's constraints:
verify every nit against the **pinned** dependency versions, harden rather than
rip out capability, and reject known non-issues with a one-line reason.

## Poll mechanics

Reviews take minutes. Run
`scripts/poll-pr.sh <n> --await-review "coderabbitai[bot]"` inline — a bounded
foreground loop that returns ONE JSON summary: check conclusions, reviews keyed
to the current head sha, `reviewer_blocked`, `mergeable_state`. `done: false`
means the window closed first — re-run to extend; never a detached background
monitor. No subagent: the script already projects its output. The poll is the
**landing signal** only — before triage fetch the round's review body and
comment threads. Auto-triage those on the **judgment tier**.

**A round is a review with a body.** Replying to a thread posts a review row of
its own — current head sha, state `COMMENTED`, empty body — so answering round N
manufactures rows that look like round N+1 arriving. `poll-pr.sh` counts only
`substantive: true`; hold any hand-rolled check to the same bar.

## A round that hasn't landed — blocked, or flaking

**Read `reviewer_blocked` before calling anything a flake.** A missing round has
two causes and they need opposite handling; the reviewer says which in a
*comment*, which is why the poll projects it.

- **Blocked** (`reviewer_blocked` non-null — a quota banner, a queue notice):
  the round is **waiting, not missing**. Keep polling. This is recoverable and
  the exit stays clean; free-OSS quota on this repo resets in about an hour.
  Two traps: the banner's countdown is static text that never re-renders, so
  read it as *blocked* and never as *blocked for N more minutes*; and a
  `@coderabbitai review` while blocked answers **"Action not completed / Review
  rate limited"**, which is the command being inapplicable rather than the
  quota talking. Once the quota clears, a manual trigger answers **"Action
  performed / Review triggered"** — that word pair is the whole signal.
- **Flaking** (`reviewer_blocked` null and no round within a poll window):
  trigger with `@coderabbitai review`. If that also produces nothing, proceed
  on green CI and mark the merge summary **degraded** — the reviewer never
  actually passed. A review body that is only an error notice with zero
  comments is the same failure: retry once, then degraded.

The reviewer's summary comment also names the range it has queued
(*"Reviewing files that changed between \<base\> and \<head\>"*) — the surest
answer to *which commits has it actually seen*, better than any review row.

After any merge command, re-verify PR state before declaring done
(`scripts/merge-and-verify.sh` does).
