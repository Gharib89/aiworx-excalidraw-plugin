# The small lane: the reduced spine

A change that passes all three lane keys (SKILL.md, *The lanes*) skips the
ceremony that cannot matter and keeps every check. It drops planning breadth,
never a check. The floor is the same in every repo.

## What collapses

Keys 1 and 2 already make phase-3 verification and the phase-4 docs-sync gate
no-ops by construction: nothing on the public surface changed, nothing the
real thing needs to prove. On top of that:

- **Local gate (phase 5) is `--small <node>`**: the repo's security check (the
  `secrets` gate, whatever scanner the gate body wires) plus the one regression
  test proving the behavior change red to green, with the node written in the
  profile's `Small node:` syntax. `base-fresh` still runs first. Lean on CI for
  the rest of the suite, lint and types: a red CI on a small change is a cheap
  round-trip.
- **On-request reviewers get exactly one round**, whatever their `Cap:`.
  `auto-once` and `on-push` reviewers behave as in the full lane; ship does not
  control when they fire.
- **Subagents: usually none of your own.** You can already point at the file,
  the proving node's output is short, and `code-review` brings its own.

## The floor: never collapses

1. Isolation (phase 0)
2. `base-fresh` and the local gate `--small <node>`: security check plus the
   one regression test
3. The **self-review, unmodified**. It is the only check that reads the diff
   against the issue; a reviewer reviews standards and has never read the
   issue. It also carries the two rejection rails. Its cost scales with the
   diff, so on a small diff it is cheap.
4. Non-draft PR with `Closes #<issue>`
5. CI green plus every reviewer per its trigger
6. The merge gate

Adjacent finds are still filed: an unfiled find is lost and filing costs one
call.

## Revocable, one way

The lane is falsifiable. Any of these **downgrades to the full lane** for the
remaining phases: CI red on behavior, a reviewer flags a real bug, the
self-review flags a real bug, the local gate's floor check hits, or the change
turns out to touch the public surface. Downgrade means: run the skipped
verifications and docs-sync, add the missing test or docs, run the full local
gate, and apply full-lane review terms. Never upgrade back. Downgrading once is
cheap; shipping a non-small change as small is the failure.
