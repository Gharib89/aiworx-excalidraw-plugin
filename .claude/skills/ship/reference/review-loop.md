# Phase 7 — driving an automated review to convergence

**In this repo: GitHub Copilot, on request only, two rounds maximum** (no Copilot
ruleset, no CodeRabbit — nothing auto-reviews). Phase-4 self-review + green CI is
still the gate; these rounds are a second pair of eyes on top. `CLAUDE.md`'s
*Code review* section is the authority on the policy; this file holds the
mechanics.

A review bot re-reads the **whole PR** on each round, so treat every round's
output as a fresh read of the committed tree, not a conversation.

## The two rounds

Copilot is a **requested** reviewer: it never triggers itself, and a plain push
does **not** re-trigger it. Each round is an explicit request:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<pr>/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

(REST, not `--add-reviewer` — the GraphQL path flakes 401 mid-session.)

- **Round 1** — request it once the PR is open and CI is running. Triage every
  comment: fix the valid ones in one batched push, reply on each thread
  (`fixed in <sha>` / decline + evidence).
- **Round 2** — re-request after that push, so it reads the corrected tree. Same
  triage. **Then stop**: two rounds is the cap.

**Converged = every comment from both rounds dispositioned + green CI.** A round
that returns nothing is a pass, not a miss — but only if you actually requested
it. Copilot's dispositions get their **own block** in the merge summary.

If round 2 is still substantive, that's a shape problem more rounds won't fix —
stop and report rather than requesting a third.

**Triage, don't apply.** Copilot does not know this repo's constraints: verify
every nit against the **pinned** dependency versions, harden rather than rip out
capability, and reject known non-issues with a one-line reason.

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
