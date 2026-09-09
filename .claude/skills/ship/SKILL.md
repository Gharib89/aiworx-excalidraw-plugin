---
name: ship
description: >-
  Drive one tracker issue to a merge-ready PR in a single run, stopping only at
  the human merge gate. Reads every repo fact from the ship profile at
  docs/agents/ship.md. Composes the `tdd`, `code-review`, `writing-for-agents`
  and `find-docs` skills. Use when the user wants to ship an issue, take an
  issue through to a PR, or run the unattended lane.
argument-hint: "[issue-number] [--unattended]"
metadata:
  version: 1.2.3
  profile-schema: 1
---

# ship

Drive one issue from nothing to a **merge-ready PR**, hands-off, stopping only
at the merge gate. The human runs `/ship <issue>`, walks away, and comes back to
a PR implemented test-first, verified against the real thing the repo
integrates with, self-reviewed, reviewed by every reviewer the repo names, and
CI-green, with every decision summarized for a ten-second approve.

This skill is **generic**. It knows how to ship; it knows nothing about the
repo. Every repo fact comes from the **ship profile**, `docs/agents/ship.md`
(vocabulary: [CONTEXT.md](https://github.com/Gharib89/skills/blob/main/CONTEXT.md)
of the source repo). The copy under `.claude/skills/ship` is a **derived copy**:
never edit it in place; the repo's `### Ship` block in CLAUDE.md carries the
refresh command.

**Self-contained.** This skill behaves identically whether or not a personal
`~/.claude/CLAUDE.md`, `~/.claude/rules/` or personal skills exist. Its inputs
are the repo's CLAUDE.md, the profile, the docs the profile names, and the
issue. Nothing a run needs arrives from the personal layer.

**Version.** Print `ship <version>` (the `metadata.version` above) in the run
header, the first line of the first reply, and again in the merge summary, so
every PR records which ship produced it.

## Argument and flags

`$ARGUMENTS`:

- `<issue>`: the issue number (work item id on Azure DevOps). Omitted with no
  flag: ask which issue.
- Free text instead of a number: treat it as the task spec directly. No issue
  fetch, no claim, no `Closes`, no reflect; everything else runs.
- `--unattended`: the **unattended run**. No human is present: a blocked stop
  hands back instead of asking, the sandbox clone is the isolation, and the
  merge gate posts the summary as a PR comment and returns. It starts with
  `tooling --install`, because the cloud sandbox image lacks the host's CLI.
  With no `<issue>` it runs the whole unattended lane (tooling, bootstrap, PR
  cap, select) before the pipeline:
  [reference/unattended.md](reference/unattended.md).

Without `--unattended` the run is **attended**: any needed human action stops
and asks, and the claim holds while it waits.

## The ship profile

Load `docs/agents/ship.md` **once, whole, at preflight**, the way a session
loads `docs/agents/issue-tracker.md`. It has fourteen fixed `##` headings, every
one always present; a defaulted axis reads `None.` or `Default.`. Facts sit on
`Label:` lines; the prose under a heading explains, and never carries a fact.
You read the profile and pass its facts to the mechanics as arguments; no script
parses markdown.

| Heading | Feeds |
|---|---|
| `## Host` | preflight cross-check against the `origin` remote |
| `## Worktree` (`Carry:`, `Bootstrap:`) | phase 0 isolate and post-merge cleanup |
| `## Local gate` (`Location:`, `Small node:`, `Tripwires:`) | phase 5; phase 2 tripwires |
| `## CI` (`Legs:`, `No-checks legal:`, `Push policy:`) | phase 8; the legs a verification may defer to |
| `## Reviewers` (zero or more, each with `Trigger:`) | phase 7 |
| `## Coding standards` | the `code-review` skill's Standards axis in phase 4 and every reviewer decline |
| `## Verification` (zero or more, seven fixed lines each) | phase 3 |
| `## Versioning and changelog` (`In-PR requirement:`, `Subject constraints:`) | phase 2 and the PR title |
| `## PR` | phase 6 |
| `## Public surface` | lane key 1 |
| `## Triage` | the marker `file-issue` applies to an adjacent find |
| `## Docs sync` (`Targets:`, `Agent-facing:`) | phase 4 |
| `## Current docs` (`Sources:`, `Pinned:`) | every API claim in phases 2, 4 and 7 |
| `## Cloud lane` (`PR cap:`, `Bootstrap:`) | the unattended lane only |

Two more repo docs feed a run and are read the same way: triage roles
(`ready-for-agent`, `ready-for-human`, `needs-triage`) are canonical role names
whose label strings come from `docs/agents/triage-labels.md`, and the tracker's
mechanics come from `docs/agents/issue-tracker.md`.

**Profile schema.** Directly under the `# Ship profile` title, before the first
`##`, the profile carries `Schema: N`. This skill declares the schema it reads as
`metadata.profile-schema` in the frontmatter above. The number is separate from
`metadata.version`: it moves only when ship's expectations of the profile change
(a heading or `Label:` line added, renamed or removed; a `Label:` vocabulary
changed), always with a ship major bump, never for a behaviour change that
leaves the profile alone. Preflight compares the two and refuses a mismatch in
either direction, in both lanes, never claimed; the detail names both numbers
and the fix:

- `profile invalid: schema 1, ship expects 2; run /setup-skills` (profile older)
- `profile invalid: schema 2, ship 1.1.0 reads 1; refresh ship` (ship older)
- `profile invalid: no Schema line; run /setup-skills`

A profile older than ship is refused even where ship could default the missing
axis: a defaulted axis reads `None.`/`Default.` explicitly, never an omitted
heading. The schema is not printed in the run header: a run that reaches the
header has passed the check, so `ship <version>` implies it.

Missing file: stop `profile missing`, naming `docs/agents/ship.md` and
`/setup-skills`. Missing or misordered headings: stop `profile invalid`, naming
them. A fact the current run needs that reads `None.` where it cannot be none
(an on-request reviewer with no `Cap:`) is also `profile invalid`; a fact the
run will not touch is never checked.

## Generic mechanics: the only way to touch the host

`scripts/` holds one executable per deterministic step. Each prints one JSON
verdict on stdout, a failing step's last 40 log lines on stderr, and exits
`0` ok, `1` real failure, `2` tooling. When a phase names a mechanic, run it
instead of re-deriving what it wraps; it is the single source of truth for that
step, including the host adapter it sources (`scripts/host/github.sh` or
`scripts/host/ado.sh`, chosen from the `origin` remote).

**You never run `gh` or `az` yourself in a ship run.** Every host interaction
goes through a named mechanic, and a missing operation is a ship defect to
report, never a reason to hand-roll the call. Reads come back in one vocabulary
on both hosts: checks `pending|success|failure`, mergeable
`clean|conflict|unknown`, review `approved|changes|comment`, threads
`resolved|open|unavailable`.

| Mechanic | Phase |
|---|---|
| `preflight <issue>` | 0 |
| `isolate <issue> <type> <slug> [--carry <file>...] [--in-place]` | 0 |
| `read-issue <issue>` | 1 |
| `manage-issue <issue> take \| release \| handback "<reason>"` | 1; any stop after the claim; 9 |
| `file-issue --title --body-file --label <marker>` | 2, 4, 7 |
| `base-fresh` | 5, and after every conflict resolution |
| `<Location:>` from the profile `[--small <node>] [--base <ref>]` | 5 (the repo's own local gate) |
| `open-pr <issue> --title --body-file` | 6 |
| `reflect <issue> <pr>` | 6 |
| `poll-pr <pr> [--await-review <login>] [--timeout <s>]` | 7, 8 |
| `request-review <pr> <login>` | 7 |
| `comment-pr <pr> --body-file` | 7, 9 |
| `update-pr-body <pr> --section Review --body-file` | 7 |
| `resolve-thread <pr> <thread>` | 7 |
| `ci-wait <pr>` | 8 |
| `merge <pr> <issue> --worktree <path>` | 9, on approval |
| `cleanup <issue>` | 9, after merge |
| `tooling [--install]`, `list-prs --open` and `select` | unattended lane |

Run mechanics **inline**: they project their own output, so a subagent there
burns budget to relay what an exit code already says. Poll loops are bounded
and foreground; reaching the bound is never permission to proceed. Re-run to
extend.

## The autonomy contract

One guaranteed stop, the **merge gate**: merging is effectively irreversible,
so a human says merge. Ship never merges on its own and never uses an
auto-merge flag. Two conditional pauses in an attended run: the **ambiguity
rail** (phase 1, the issue is too vague to plan) and a **hand-off** (phase 3, a
verification's prerequisite is missing and its disposition says so). Everything
else, triaging your own findings, fixing, re-running, is autonomous.

**Never proceed on red.** Any failure before the merge gate gets a bounded
self-fix-and-retry, about two attempts. Still red, or the failure says the
approach is wrong: **stop and report** with the concrete evidence and, if
cheap, a verified-working alternative, so the report is a fast yes.

**Every stop has a name** and a claim action. Report the name verbatim; a
sibling maps it, a human reads it.

| Stop | Reason | Claim |
|---|---|---|
| Profile missing or invalid, host unreachable | `profile missing`, `profile invalid: <detail>`, `host-unreachable` | never claimed |
| Preflight not actionable | `closed`, `is a pull request`, `already claimed`, `existing PR`, `existing branch`, `worktree exists`, `not triaged: run /triage first`, `ready-for-human: attended only` | never claimed |
| Issue too vague to plan | `ambiguous` | never claimed |
| Change outgrows one PR, or needs a redesign the issue never scoped | `needs-split` | attended: ask; unattended: hand back |
| A find shows the issue is mis-specified | `mis-specified` | attended: ask; unattended: hand back |
| Verification prerequisite missing | `hand-off` (attended waits, claim holds) / `blocked-verification` | attended: hold; unattended: hand back |
| Local gate verdict `unavailable` | `local gate unavailable: <gates>` | attended: ask; unattended: hand back |
| Carried file changed | `carried file modified: <file>` | attended: ask; unattended: hand back |
| Red after retries | `red-after-retry: <what>` | attended: ask; unattended: hand back |
| Merge gate reached | none: the run's success | holds until merge |

Hand-back is `manage-issue <issue> handback "<reason>"`: unassign, drop
`ready-for-agent`, add `ready-for-human`, comment the reason. In an attended run
you stop and ask; only if the human says stop do you hand back. Never hand back
to the agent queue: that loops forever.

## Consult current docs

While implementing (phase 2) or triaging findings (phases 4 and 7), verify API
claims against **current** docs through the `find-docs` skill and the extra
`Sources:` the profile names, never memory. For every library on the profile's
`Pinned:` line, read the installed version from the repo's manifest and confirm
the claim against that version before acting on it; a remembered API the
installed version lacks is a regression.

## Model tiers

Use the cheapest model that fits; reserve the strong tier for judgment. Tag
every subagent with a model explicitly, never default-inherit.

| Work | Model |
|---|---|
| Investigation and mapping | haiku |
| Phase-2 **execution** from a settled plan; mechanical edits and fixes; the docs-sync pass on human prose; the `code-review` skill's **Spec** axis | sonnet |
| Phase-2 **judgment** (classification, plan, design, the implementation brief); triage of every finding; the `writing-for-agents` pass; the `code-review` skill's **Standards** axis | opus |

When you invoke `code-review`, tier its two axes yourself. Fall back to the
nearest available tier rather than running everything on one model. Subagents
are a lever, never a dependency: with no subagent tools in the session, run
everything inline and the run is still complete.

## Working standards

These bind every edit a run makes, in every repo, with or without a personal
CLAUDE.md:

- **Simplest shape that solves the problem.** No speculative features,
  configurability or abstraction for single-use code. If the diff could be a
  third the size, rewrite it.
- **Surgical.** Touch only what the issue needs; every changed line traces to
  it or to a logged deviation. Match existing style. Leave adjacent code,
  comments and formatting alone.
- **Root cause, not symptom.** No temporary patches, no swallowed errors, no
  `TODO` standing in for the fix. If the real fix is out of scope, say so and
  file it.
- **Comments record the why.** Document public APIs and non-obvious
  constraints, invariants and workarounds. Skip narrative comments on
  internals.
- **Concise PR and summary, always the why.** State what changed and why; the
  reader has the diff for the how.

## The lanes

Every run is **full lane** until the change proves it **small**: all three keys
hold, asserted by you at phase 2 and announced with the class, never confirmed
with anyone. When unsure, it is not small.

1. **No public-surface change.** The public surface is the profile's
   `## Public surface`; `Default.` means the exported or published API, CLI
   flags and exit codes, config schema, file formats and documented behavior.
2. **Provable without the real thing.** A unit or regression test fully proves
   it; no verification in the profile's `## Verification` applies.
3. **Single-concern.** No new dependency, none of the profile's `Tripwires:`
   fired, no new logic branch beyond the fix itself.

Behavior change is allowed: a bugfix is one. Small means narrow, locally
provable and invisible to the public surface. Small: read
[reference/small-lane.md](reference/small-lane.md) before continuing. Its
floor is the same in every repo, and the lane revokes one way only.

## The pipeline

Work the phases in order, keeping the main thread on orchestration and
decisions. **First**, read
[reference/context-discipline.md](reference/context-discipline.md): the
delegation rule, the levers that keep a long run from bloating the window, and
your **required first action, the Run file** holding the ten-item checklist.
Phase 0 starts once the Run file exists.

**Compose, don't reinline.** Load `tdd` (phase 2), `writing-for-agents`
(phase 4, agent-facing docs), `code-review` (phase 4) and `find-docs` (any API
claim) through the Skill tool when their moment comes; never hand-roll their
logic. Any skill you compose that has an unattended mode is told the run is
unattended explicitly; it has no other way to know.

**0 · Isolate.** Run `preflight <issue>`. It proves tooling, identity and
**push permission first** (every read-only call succeeds for an account that
cannot push, so a wrong account stays invisible until the merge answers 404),
cross-checks `## Host` against the remote, loads and validates the profile
headings, prunes worktrees whose PR is merged or closed, and collects every
not-actionable reason. Admission: `ready-for-agent` always; `ready-for-human` in an
attended run only; anything else is `not triaged`.
An assignee, including your own identity, is `already claimed`; stale-claim
recovery is a human unassigning by hand. `existing PR` means a live PR whose
body **closes** this issue or whose head branch ends in `-<issue>`; PRs that
merely mention it come back as `mentions[]`, context for phase 1, never a stop.

Then isolate. Attended: `isolate <issue> <type> <slug>` with the profile's
`Carry:` files. It resolves the main checkout through `--git-common-dir`,
fetches, branches from `origin/HEAD`, creates the sibling worktree
`<parent>/<repo>.worktrees/<slug>-<issue>`, copies the carried files in one
way, and prints the path. Unattended: `isolate ... --in-place`, because the
sandbox clone is the isolation; same fetch and branch, no worktree, no carry.
Never `EnterWorktree`. Branch `<type>/<slug>-<issue>`, `<type>` matching the
issue (`feat`, `fix`, `docs`, ...); the `-<issue>` suffix is what preflight
greps. Every edit, commit and the PR happen from this branch. **Commit as you
go**: the PR needs real commits. The branch type is a label; the squash
subject, not the branch, is what release tooling reads. A `Bootstrap:` under
`## Worktree` runs once here, after isolate.

**1 · Understand.** `read-issue <issue>`: title, body, labels, assignee, state,
comments, open blockers. Derive what success looks like. A later authoritative
comment supersedes the body (**spec precedence**, detailed in
[reference/implement.md](reference/implement.md)). Too vague to plan: stop
`ambiguous`, unclaimed. Otherwise **claim before any work**:
`manage-issue <issue> take`, idempotent, which assigns you and posts the fixed
comment `🤖 Claimed by a ship run — implementation in progress.` The claim
holds until merge; every stop after this point follows the stop table.

**2 · Implement.** Classify `docs` / `code` / `infra`; **announce the class,
the skip path it implies, and whether the three lane keys hold**; announce the
applicable verifications from `## Verification` (their `Applies when:` lines
are prose you judge here) or the skip. Then implement test-first per class:
classes, the TDD override, external-claim probes, and the judgment/execution
split in [reference/implement.md](reference/implement.md). The profile's
`Tripwires:` and `In-PR requirement:` apply whatever the class: a bundle
rebuild or a version bump CI enforces lands in this change, or phase 8 goes red
with no phase explaining why. Keep a **deviations log** from the first edit:
whenever the territory forces a departure from the issue, brief or plan,
resolve it by the conservative option, log what and why, keep going; the log
lands verbatim in the PR body and the merge summary. An **adjacent find** has
three dispositions and no fourth: it blocks the issue, so fix it inline and log
the deviation; it does not block, so `file-issue` it with the profile's triage
marker and leave it; or it shows the issue is mis-specified, so stop
`mis-specified`. No cap: the merge summary lists every issue filed. If the core
work balloons (the diff outgrows one PR, or the fix demands a redesign the
issue never scoped), stop `needs-split` with a split proposal.

**3 · Verify.** For each applicable verification, run its `Run:` line scoped
to what you touched, on the environment the issue was reported against; green
elsewhere is not fixed. Result words: `pass | fail | deferred-to-ci |
unavailable`. Prerequisite (`Needs:`) missing: follow `Without it:`.
`hand-off` prints the exact command and setup and waits (attended) or hands
back (unattended); `defer-to-ci` continues only because `Also proven by CI:`
names the leg you will watch in phase 8, and is the only unattended-safe
disposition; `blocked` stops `blocked-verification`. Noisy runs go to a
cheap-tier subagent returning the result plus failing lines. `docs` class and
the small lane skip this phase. Detail in
[reference/implement.md](reference/implement.md).

**4 · Sync docs, then self-review.** Docs first, so the review reads the docs
edits as part of the diff. **Docs-sync fires only when the public surface or
observable behavior changed**: bring the profile's `Targets:` in line, folding
the edits into this change. Targets on the `Agent-facing:` line go through the
`writing-for-agents` skill at the judgment tier; human prose takes the
mechanical pass. Skip the step for internal refactors, a bugfix restoring
documented behavior, test-only or tooling changes, and comments; when you skip,
say so in one line at the merge gate.

**Self-review**, unconditional in every lane: invoke `code-review` against the
diff since `origin/HEAD`, its Standards axis reading the profile's
`## Coding standards` path, its Spec axis reading the issue. **Auto-triage**
every finding: harden rather than rip out capability, verify nits against the
pinned versions, reject known non-issues; fix the valid ones; record a one-line
disposition per finding. Two rails on rejecting: a claim about **what exists
in the repo** is checked against `origin/HEAD`, never the worktree, which may
predate a merge; and a finding's **evidence and its claim are separate**, so a
reviewer citing the wrong commit for a real primitive is still right. A valid
finding outside the issue is an adjacent find: phase 2's three dispositions.
This self-review plus green CI is the review gate; reviewers in phase 7 are a
second pair of eyes on top, never a substitute.

**5 · Local gate.** *Precondition:* every applicable verification is `pass` or
`deferred-to-ci`, or the class is `docs`; otherwise you skipped one, go back.
Run `base-fresh` first: it proves the branch has seen every commit on its base,
the one thing CI cannot (CI tests the merge ref, so a branch that predates a
merge still goes green while every "does this exist?" answer you took from the
worktree was pre-merge). Behind: rebase, re-run, then continue. Confirm every
`Carry:` file still matches the main checkout's copy; a difference is
`carried file modified`, because ship has no business editing untracked
secrets. Then run the gate at the profile's `Location:` from the worktree,
inline. Small lane:
`--small <node>` with the node written in the profile's `Small node:` syntax.
The gate owns dependency install and every check CI runs; its verdict is one
JSON object: `verdict` `pass|fail|unavailable`, per-gate statuses
`pass|fail|deferred-to-ci|unavailable`, `gates.secrets` present in every lane.
Unparseable output or a missing `secrets` key reads as `unavailable`. `fail`:
fix loop. Any `deferred-to-ci`: proceed, and the merge summary names each
deferred gate. `unavailable`: stop `local gate unavailable`; never open the PR.

**6 · Open PR.** `open-pr <issue> --title --body-file`, **non-draft** (drafts
may not trigger a reviewer). Title: a Conventional-Commit subject derived from
the issue, honouring `Subject constraints:`; it becomes the squash subject that
release tooling reads. Body: the repo's template per `## PR`, filled honestly
(never a raw body that bypasses it); with no template, a plain body. Every
variant carries `Closes #<issue>` (the mechanic translates it for the host), a
**Deviations from plan** section (the log verbatim, `None` only if the plan
held), and a `## Review` section holding one placeholder line per reviewer,
filled at phase-7 exit. Then `reflect <issue> <pr>` so a human reading the
issue sees the PR.

**7 · Reviewers.** For each reviewer under `## Reviewers`, drive it to
convergence by its **trigger**, never by its brand: `auto-once` is
dispositioned once and never re-requested; `on-push` re-reviews every push,
rounds are free, and it converges when a review has landed on the current head
with nothing actionable and every thread is dispositioned and resolved;
`on-request` gets one round per `request-review`, up to `Cap:`, and converges
when the latest round has nothing actionable and every thread is dispositioned.
Zero reviewers: skip the phase. Batch fixes into one push per round; reply on
every thread. Exits: `converged`, `converged, override needed` (a gating
reviewer's declined finding, cited with evidence), or `degraded: <reason>` from
the fixed vocabulary `never-queued | blocked | silent | infra-error | cap-hit |
unreachable`. Degraded proceeds to the merge gate on green CI and never hands
back on its own. At exit, `update-pr-body <pr> --section Review` with one status
line per reviewer. Mechanics, convergence per trigger, degraded detection and
the worked examples: [reference/review-loop.md](reference/review-loop.md).

**8 · CI.** CI runs from PR-open and overlaps phase 7; `ci-wait <pr>` covers
it, reading the profile's `Legs:`. `conflict`: a conflicted PR has no merge
ref, so checks sit pending forever; fetch, rebase onto the base, resolve,
re-run `base-fresh` and the local gate, push. `no-checks` is fine only where
`No-checks legal:` says so. A red leg named on a verification's
`Also proven by CI:` line is that verification failing: back to phase 2.
Red after reviewers converged: fix, push, proceed on green; a lint or flake fix
earns no new on-request round, and an on-push reviewer re-reads it on its own,
so wait for its quiet again. Honour `Push policy:`; a push spends CI minutes
and review quota, so push when the tree changed.

**9 · Merge gate.** **Hard stop.** Write the summary per
[reference/merge-gate.md](reference/merge-gate.md), uncompressed. Attended:
post it in the conversation and wait for an explicit "merge"; on approval run
`merge <pr> <issue> --worktree <path>` then `cleanup <issue>`; any `false` in
their JSON is finished by hand before reporting done. Unattended:
`comment-pr <pr> --body-file` with the summary, and return. The claim holds in
both lanes until the merge releases it.

## Reference files

- `reference/context-discipline.md`: the delegation rule; the Run file, its ten
  items and clock stamps.
- `reference/small-lane.md`: what collapses, the floor, revocation.
- `reference/implement.md`: phases 1 to 3 in detail: spec precedence, classes,
  the TDD override, external-claim probes, the judgment/execution split,
  verification dispositions.
- `reference/review-loop.md`: phase 7 per trigger, convergence, degraded
  exits, worked examples.
- `reference/merge-gate.md`: the summary template, approval mechanics, the
  unattended posting.
- `reference/unattended.md`: `--unattended` end to end, and the lane with no
  issue argument.
