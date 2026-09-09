---
name: cloud-ship
description: >-
  Run one fire of the scheduled cloud routine: invoke the `ship` skill
  unattended so it selects the oldest ready issue, drives it to a merge-ready
  PR and stops at the merge gate, then relay the outcome. Composes `ship`. Use
  only from a cloud routine's prompt; a human shipping an issue runs `/ship`.
metadata:
  version: 1.0.0
---

# cloud-ship

One **fire**: one selected issue driven to one merge-ready PR, ending at the
merge gate with no human present. Everything a fire does is `ship`'s: the
sandbox tooling, the profile's cloud bootstrap, the PR cap, the selection, the
claim, the branch, the isolation, the hand-back and the merge summary. This
skill adds the invocation and the relay, nothing else. The copy under
`.claude/skills/cloud-ship` is a **derived copy**, the same bytes in every repo,
never edited in place; the repo's `### Ship` block in CLAUDE.md carries the
refresh command.

## The fire

1. **Invoke `ship` unattended.** Call the Skill tool with skill `ship` and
   arguments `--unattended`, no issue number. Ship runs the whole unattended
   lane (`reference/unattended.md` in its own folder): tooling, the profile's
   `## Cloud lane` bootstrap, the PR cap, selection, then phases 0 to 9 on the
   selected issue, posting the merge summary as a PR comment and returning.
2. **Relay.** Report ship's step-5 result verbatim, prefixed with
   `cloud-ship <version>` (the `metadata.version` above): the PR link and where
   the merge summary is, or the stop reason as ship named it
   (`bootstrap-failed`, `pr-queue-full`, `nothing-ready`,
   `blockers-unavailable`, `host-unreachable`, or any stop from ship's table).
   `nothing-ready` is the one clean no-op; every other stop is a fire worth
   reading in the routine log.

## What this skill never does

- **Never writes to the tracker.** No claim, no label, no comment, no
  hand-back: after selection every tracker write is ship's, and before it there
  is no issue to write to.
- **Never touches git before ship does.** No `git switch`, no branch: ship's
  `isolate --in-place` branches the sandbox clone itself.
- **Never calls a ship script by path.** `select`, `list-prs`, `preflight` and
  the rest are ship's mechanics, run by ship.
- **Never overrides the merge gate.** Ship already knows it is unattended and
  returns there; a second definition of the gate here would drift from ship's.
- **Never merges, waits or polls after ship returns.** A human merges from the
  PR; the open PR and the claim keep later fires off the issue.

## The routine prompt

One sentence, identical in every repo, because the derived copy is the same
bytes everywhere and ship derives the repo from the clone's remote:

```
Run the cloud-ship skill.
```
