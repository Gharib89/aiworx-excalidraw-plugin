# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## `agent-working` — a claim, not a triage role

`agent-working` is local to this repo and has no counterpart in the canonical five: it records that a `/ship` run holds the issue, so a concurrent run can't double-pick it. Only `/ship` applies and removes it — never triage.

Its lifecycle is a closed loop, and every leg is mechanical:

| When | What happens | By |
| ---- | ------------ | -- |
| Run claims the issue | `ready-for-agent` off, `agent-working` on, claim comment posted | `.claude/skills/ship/scripts/claim.sh` |
| Issue is already claimed | Pre-flight refuses it — this is the whole point of the label | `scripts/preflight.sh` |
| Run merges | `agent-working` off; the issue closes carrying its category label only | `scripts/release.sh`, via `scripts/merge-and-verify.sh` |
| Run ends blocked | `agent-working` off, `needs-triage` on — back to the maintainer's bucket | `scripts/release.sh <issue> --handback` |

The hand-back applies `needs-triage` rather than restoring `ready-for-agent` on purpose: a run that stopped blocked is a signal a human should look, not an invitation for the next agent to walk into the same block.

**A stray `agent-working` is a bug, not a state.** Because claiming strips `ready-for-agent`, an issue left holding the claim after a run dies is both unclaimable by pre-flight and invisible in every triage bucket. If you find one, clear it with `scripts/release.sh <issue> --handback` rather than by hand.
