# Phase 7 — driving an automated review to convergence

**Dormant in this repo: no review bot is configured** (no Copilot ruleset, no
CodeRabbit). Phase 7 skips; phase-4 self-review + green CI is the review gate.
This file exists so the pipeline doesn't lose the mechanics if a bot is ever
added — if one is, record its role in `CLAUDE.md` and this phase reactivates.

A review bot re-reads the **whole PR** on each round, so treat every round's
output as a fresh read of the committed tree, not a conversation.

Two reviewer roles, assigned by project instructions:

- **Round-1 reviewer** — auto-reviews once on PR creation and is **dispositioned
  once**: address each thread, or decline with evidence. **Never re-requested in
  the ship flow** (a plain push does not re-trigger it).
- **Iterating reviewer** — a push-triggered bot (if the repo runs one) that
  **re-reviews automatically on every push** and **owns iteration**. Its rounds
  are free; drive them to quiet: address or decline with evidence, reply **on
  each review thread** ("fixed in `<sha>`" / decline + evidence), batch fixes
  into one push per round, and use its thread-resolution mechanism only once
  **every** thread carries a disposition.

**Converged = the iterating reviewer quiet on the latest push + every one of its
threads dispositioned and resolved + every round-1 thread dispositioned.** With
only a round-1 reviewer, converged = its threads dispositioned + green CI. Each
reviewer's dispositions get their **own block** in the merge summary.

If the iterating reviewer stays substantive round after round, that's a shape
problem more rounds won't fix — stop and report, don't loop forever.

## Poll mechanics

Reviews take minutes. Run `scripts/poll-pr.sh <n> [--await-review <login>]`
inline — a bounded foreground loop that returns ONE JSON summary: check
conclusions, reviews keyed to the current head sha, `mergeable_state`.
`done: false` means the window closed first — re-run to extend; never a
detached background monitor. No subagent: the script already projects its
output. Auto-triage what it returns on the **judgment tier**.

## Infra flakes — don't wait forever

- A review body that says it "encountered an error and was unable to review" with
  zero comments is an **infra failure**, not feedback. After a couple consecutive
  error bodies, proceed on green CI — but note in the merge summary that the
  reviewer never actually passed, a **degraded** exit, not convergence.
- A re-review that simply never lands (silence, no error) is flakiness. Bounded
  wait (~one poll window), then proceed — don't loop forever.

After any merge command, re-verify PR state before declaring done
(`scripts/merge-and-verify.sh` does).
