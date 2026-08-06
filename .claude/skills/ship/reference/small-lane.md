# The small lane — the reduced spine

A change that passes all three lane keys (SKILL.md → *The lanes*) skips the
ceremony that can't matter and keeps the safety that always does.

## What collapses

Keys 1–2 already make the phase-4 docs-sync gate and the phase-3 browser
verification no-ops by construction (nothing on the public surface changed;
nothing browser-dependent to prove). On top of that:

- **The phase-4 self-review still runs** — nothing reviews this repo unless
  asked, so the self-review is the review the change gets. It never collapses.
- **Phase 7 still runs** — the Copilot rounds are cheap and a small diff is
  quick to re-read; the small lane does not buy an exemption from them.
- **Local gate (phase 5) = `scripts/local-gate.sh --small <test-file>`** — the
  bundle-fingerprint staleness check + the one regression test file (red→green
  proof). Lean on CI for the rest of the suite, the browser smoke, and the
  OS matrix — CI re-runs them, and a red CI on a small change is a cheap
  round-trip.
- **Subagents: usually none of your own.** You can already point at the file (no
  mapper), and the proving test file's output is short (run it inline); the
  `code-review` skill brings its own, and polling is a script. The delegation
  rule is in [context-discipline.md](context-discipline.md).

## The floor — never collapses

The worktree (phase 0), **one regression test** proving any behavior change, the
**self-review** (the gate — Copilot only ever adds to it), the **fingerprint check**
(a stale committed bundle silently reproduces the bugs the sources fixed), the
PR, CI, and the **merge gate**.

## Revocable

The lane is falsifiable: any later contradiction — CI red on behavior (any OS
leg), the self-review flags a real bug, the fingerprint check hits, or you find
the change touches the public surface — **downgrades to the full lane** for the
remaining phases: run the skipped browser verification, add the missing test or
docs-sync, and run the full local gate. Downgrading once is cheap; shipping a
non-small change as small is the failure.
