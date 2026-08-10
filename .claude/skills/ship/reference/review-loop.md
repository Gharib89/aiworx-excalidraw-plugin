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
to the current head sha, `mergeable_state`. `done: false` means the window
closed first — re-run to extend; never a detached background monitor. No
subagent: the script already projects its output. The poll is the **landing
signal** only — it projects `{login, state}` per review, so before triage fetch
the round's review body and comment threads (that fetch is also what tells an
error-only body apart from a real round). Auto-triage those on the
**judgment tier**.

## Infra flakes — don't wait forever

- A PR still silent minutes after open, or a push whose incremental review
  never lands within one poll window, is flakiness — trigger a round manually
  with a `@coderabbitai review` comment. If that also produces nothing,
  proceed on green CI and note in the merge summary that the reviewer never
  actually passed: a **degraded** exit, not convergence.
- A review body that is only an error notice with zero comments is an **infra
  failure**, not feedback — same handling: retry once, then degraded exit.

After any merge command, re-verify PR state before declaring done
(`scripts/merge-and-verify.sh` does).
