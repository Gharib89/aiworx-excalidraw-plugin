---
name: ship
description: >-
  Take a tracker issue to a merge-ready PR in one unattended run, stopping only
  at a human merge gate. Composes the `tdd`, `writing-for-agents` and
  `code-review` skills. Use when the user wants to ship an issue or take an issue
  through to a PR.
argument-hint: "[issue-number]"
---

# ship

Drive one issue from nothing to a **merge-ready PR**, hands-off, stopping only at
a final human merge gate. You run `/ship <issue>`, walk away, and come back to a
PR implemented test-first, browser-verified, self-reviewed, and CI-green — every
decision summarized for you to approve before the merge.

This skill is **generic** — everything repo-specific lives in the repo's
**project instructions** (`CLAUDE.md`). **Read them first** and pull what the
phases below need; if any is missing, surface the gap — don't guess: the
**test command** (run from a worktree), the **browser-verification** story
(system Chrome, `CHROME_PATH`), the **full local-gate set CI runs** (not a fixed
triad), **docs-sync rules**, the **commit-subject convention**, and **whether a
review bot exists** (`CLAUDE.md`'s *Code review* section is the authority — it
decides whether phase 7 runs and on what terms). This copy also ships
the repo-specific deterministic steps as executables — see *Scripts* below.

## Scripts — deterministic steps are encoded, not prose

`scripts/` holds each deterministic step as an executable: it prints a
one-screen summary (JSON, or pass/fail lines plus only the failing output), and
its exit code is the step's completion criterion. When a phase names a script,
run it instead of re-deriving the calls it wraps — the script is the single
source of truth for that step's mechanics (REST-over-GraphQL, the one-retry on
gh's 401 flake, output projection).

| Script | Phase | GitHub API |
|---|---|---|
| `scripts/preflight.sh <issue>` | 0 pre-flight | yes |
| `scripts/isolate.sh <type> <slug> <issue>` | 0 worktree (when `EnterWorktree` is absent) | no |
| `scripts/claim.sh <issue>` | 1 claim | yes |
| `scripts/release.sh <issue> [--handback]` | any blocked stop after the claim; 9 (called by `merge-and-verify.sh`) | yes |
| `scripts/local-gate.sh [--small <test-file>]` | 5 local gate | no |
| `scripts/poll-pr.sh <pr> [--await-review <login>]` | 7/8 poll | yes |
| `scripts/merge-and-verify.sh <pr> [issue]` | 9 on approval | yes |

The GitHub-API scripts assume direct `api.github.com` access via `gh`. In a
sandbox that gates it, skip them and use the caller's MCP mapping; the
local-only scripts still apply.

## The autonomy contract

`/ship` runs unattended through implementation, testing, review, and CI, to **one
guaranteed stop: the merge gate** — your single review point. It pauses in only
three places:

- **Merge gate (always).** Merging to the default branch is effectively
  irreversible; a human approves it. Never auto-merge.
- **Ambiguity rail (phase 1, only if needed).** Issue too underspecified to derive
  a plan → stop and ask rather than build the wrong thing.
- **Browser-verification hand-off (phase 3, only if needed).** No usable Chrome on
  this machine, or the claim is OS-specific and this OS can't prove it → hand the
  exact command (or the CI-matrix expectation) back and wait.

Everything else — triaging your own findings, fixing, re-running — is
**autonomous**, no mid-loop pause.

**Never proceed on red.** Any failure before the merge gate (failing test,
stale-bundle refusal, CI) gets a bounded self-fix-and-retry (~2 attempts). Still
red after that, or the failure means the approach is wrong → **stop and report**;
never merge on red. Make the report a **fast yes**: attach the concrete evidence
(failing output / render) and, if cheap, a **verified-working alternative** — a
one-glance approve-or-redirect, not an open-ended "what now?". **If you claimed
the issue and are now ending the run short of the merge** — this red stop, or
the mid-run ambiguity/scope stop in phase 2 — release the claim first
(`scripts/release.sh <issue> --handback`), or it outlives the run and blocks
every future one. Not at the phase-3 browser hand-off: that one waits and
resumes, so the claim should hold. Phase 9 releases it on merge.

## Argument

`$ARGUMENTS` is the issue number. Omitted → ask which issue. Free text rather than
a number → treat it as the task spec directly and skip the issue fetch in phase 1.

## Consult current docs — don't trust training data for APIs

While implementing (phase 2) or triaging findings (phase 4), verify against
**current** docs, not memory — your training data may lag the installed version.
Use **context7** (the `find-docs` skill) for any library/SDK/CLI. This matters
most for `@excalidraw/excalidraw` (pinned — read the version from
`package.json`), Playwright, and esbuild: confirm any API claim against the
**pinned** version before acting — a plausible "remembered" API the installed
version doesn't have would be a regression.

## Model tiers — match the model to the work

Use the cheapest model that fits; reserve the strong model for judgment. Tag every
subagent and the poll loop with a model explicitly — never default-inherit.

| Work | Model |
|------|-------|
| Investigation / mapping | haiku |
| Phase-2 **execution** from a settled plan (split in [reference/implement.md](reference/implement.md)) | sonnet |
| Mechanical edits & fixes, docs-sync helper, `code-review` skill's **Spec** axis | sonnet |
| Triage judgment (phase 4), phase-2 **judgment** (classification, plan, design), the `writing-for-agents` pass on agent-facing docs, `code-review` skill's **Standards / code** axis | opus |

Triage and code review are judgment — running them on the cheap tier under-reads
diffs. Poll loops and gate runs are **scripts** (see *Scripts*) — no model at
all; a subagent there burns budget to relay what an exit code already says. When
you invoke the `code-review` skill, tier its two axes yourself (Standards =
opus, Spec = sonnet — rows above). Fall back to the nearest available tier
rather than running everything on one model.

## The lanes

Every run is **full lane** until the change proves it's **small** — all three keys
hold (assert at phase 2, announced like the class; when unsure, it's *not* small):

1. **No public-surface change.** The **public surface** is the documented,
   user-visible contract: the CLIs (`check.js` / `render.js` / `revise.js`) and
   their flags and exit codes, the author API, the gate's rules and problem
   codes, the shipped skill (`skills/excalidraw-diagram/`), the palette, output
   shapes (`--json`), documented behavior. A small change adds, removes, renames,
   and changes none of it.
2. **Provable without a browser** — a unit/regression test (`tests/*.js` that
   doesn't launch Chrome) fully proves it; no need for the smoke suite or a
   render.
3. **Single-concern** — no new dependency, no bundle-input change
   (`tools/page.js`, `tools/bundle.js`, `tools/fonts.js`, lockfile dep moves),
   no new logic branch beyond the fix itself.

Behavior change is allowed — a bugfix *is* one. Small means narrow + locally
provable + invisible to the public surface, not zero-behavior. Small → read
**[reference/small-lane.md](reference/small-lane.md)** — the reduced spine: what
collapses, the floor that never does, when the lane revokes — before continuing.

## The pipeline

Work the phases in order; keep the main thread on orchestration and decisions,
delegating noisy work to subagents. **First**, read
[reference/context-discipline.md](reference/context-discipline.md) — it opens
with the **delegation rule** (when a subagent earns its cost), covers how to keep
this long run from bloating the window, **and names your required first action:
creating the run's ten-item task list** (one per phase below). Don't start phase 0
until that list exists.

**Compose, don't reinline.** Load the `tdd` skill (phase 2), the
`writing-for-agents` skill (phase 4, agent-facing docs only) and the
`code-review` skill (phase 4) through the Skill tool when their phase begins —
never hand-roll their logic. Set the `code-review` skill's per-axis tiers
yourself when you invoke it (opus code / sonnet spec, table above); run
finding-**triage** at the judgment tier, mechanical helpers at the cheap tier
(table above).

**0 · Isolate.** **Pre-flight:** run `scripts/preflight.sh <issue>` — if it
reports not actionable (closed, an existing open/merged PR that claims to
*close* it, existing branch, already claimed, or a `gh` account without push
access), **stop and report** its reasons instead of opening a duplicate. The
push-access row is checked first because it is the only one the rest of the run
cannot see: every read-only call succeeds for an account that cannot push, so a
wrong active account stays invisible until phase 9's merge answers 404. Its `mentions` array lists live PRs that merely
name the issue — the "spun this out of the PR I was working on" pattern — which
is context to carry into phase 1, never a reason to stop. Then create an
isolated workspace on a fresh branch off the default
branch — `EnterWorktree`, or `scripts/isolate.sh <type> <slug> <issue>` when
that tool is absent (it also installs the runtime deps a worktree needs). Name
the branch `<type>/<slug>-<issue>` where `<type>` matches the issue (feat/fix/…).
All work, commits, and the PR happen from this branch; clean it up after merge.
**Commit as you go** — intermediate messages don't matter, but the PR needs real
commits. (The branch `<type>` is just a label — the commit/PR
Conventional-Commit type may differ once you see the change. The squash subject,
not the branch, drives the release history.)

**1 · Understand.** Fetch the issue and its comments. Derive what success looks
like. A later authoritative comment can supersede the issue body — **spec
precedence**, detailed in [reference/implement.md](reference/implement.md). **If
it's too vague to plan, stop and ask** (the ambiguity rail).
**Claim it before implementing** — `scripts/claim.sh <issue>` (idempotent) marks
the issue in-progress so a concurrent run can't double-pick it; skip if there's
no issue. Don't claim if you stopped on the ambiguity rail; if you claim then
stop blocked, hand the issue back with `scripts/release.sh <issue> --handback`
(drops the claim and applies `needs-triage`, since claiming stripped
`ready-for-agent` — releasing alone would leave the issue in no triage bucket).

**2 · Implement.** Classify the change as `docs` / `code` / `infra`, announce the
class and the skip path it implies — **and whether it passes the three lane keys**
(if so, announce that and follow
[reference/small-lane.md](reference/small-lane.md)) — then implement
test-first per class —
**full detail (classes, TDD override, external-claim verification, and the
judgment/execution split that puts execution on a sonnet subagent) in
[reference/implement.md](reference/implement.md).** **Stay surgical** — implement
only what the issue asks; every changed line should trace to it. An adjacent bug or
cleanup you spot is **out of scope**: file a `needs-triage` issue for it and move
on, don't fix it inline. **Keep a deviations log** from the first edit: whenever
the territory forces a departure from the issue/brief/plan — an edge case the
spec missed, a wrong assumption, a **known unknown** the brief flagged — resolve
it by the conservative option, log what + why, and keep going; the log lands
verbatim in the PR body's **Deviations from plan** section (phase 6) and the
merge summary. If the core work itself balloons mid-flight — the diff
outgrows what one PR can carry, or the fix demands a redesign the issue never
scoped — **stop and report** with a split proposal instead of pushing through (the
ambiguity rail applies mid-run too).

**Bundle discipline:** if the change touches a bundle input (`tools/page.js`,
`tools/bundle.js`, `tools/fonts.js`, or lockfile-resolved versions of the
bundled deps), run
`npm run bundle` and **commit the rebuilt `dist/`** in the same change —
`browser.js` refuses a stale fingerprint, so forgetting turns every later
browser call red.

**3 · Browser-verify.** Verify **only what you touched** against the real
pipeline — the smoke suite, a targeted render, or the browser-dependent test
file for the area — **detail in
[reference/implement.md](reference/implement.md)**, including the OS caveat:
this machine proves Linux claims; macOS/Windows claims (browser discovery, path
handling) are proven by the CI matrix, not locally. A `docs` change — or a
**small-lane** one (key 2) — has nothing browser-dependent to verify; skip to
the local gate.

**4 · Sync docs, then self-review.** Sync docs **before** reviewing, so the review
reads the docs edits as part of the diff (the whole point of this ordering: a review
run on a docs-less diff never checks the docs).

**Docs-sync (conditional) — do this first.** Fire **only if this change altered
the public surface** (*The lanes*, key 1) **or observable behavior**. Then bring
the project's documented artifacts (README, the shipped skill
`skills/excalidraw-diagram/`, tests) back in line **per the project's docs-sync
rules in `CLAUDE.md`** — at the mechanical tier — and fold the edits into this
change.

Any artifact **written for an agent** — a skill, `AGENTS.md` / `CLAUDE.md`, a
domain glossary, a doc reached by a pointer — goes through the
`writing-for-agents` skill instead (Skill tool, judgment tier), so the edit
lands on the levers that keep such a document predictable: pointer wording, the
information hierarchy, leading words, positive phrasing, one home per meaning.
Prose aimed at humans — README, code comments — takes the mechanical pass above.

**Skip** the whole docs-sync step when nothing user-visible changed — an
internal refactor (`infra`), a bugfix that restores already-documented behavior,
test-only / build / tooling changes, or pure comments; when you skip, say so in
one line at the merge gate.

**Self-review.** Invoke the `code-review` skill against the diff — now including the
docs-sync edits — (it runs its two axes on their own tiers — opus for code, sonnet
for spec). **Auto-triage** each finding: harden rather than rip out capability,
verify nits against the **pinned** dependency versions, reject known non-issues; fix
the valid ones; record a one-line disposition per finding for the merge summary.

Two rails on rejecting a finding, both learned from a defect that reached main.
A claim about **what exists in the repo** is checked against `origin/main` — the
base the review pinned — never against the worktree, which may predate a merge.
And a finding's **evidence and its claim are separate**: a reviewer citing the
wrong commit for a real primitive is still right, so re-derive the claim before
rejecting it.
This self-review plus green CI *is* the review gate — don't skim it. The
CodeRabbit rounds in phase 7 are a second pair of eyes on top, not a
substitute for it.

**5 · Local gate.** *Precondition:* phase 3 passed **or** the class is `docs` — if
neither holds, you skipped a verification; stop and go back.

Run `scripts/local-gate.sh` green before opening the PR — it mirrors the checks
CI actually runs (bundle-fingerprint staleness, the full `npm test` suite
including browser smoke, bundle reproducibility when bundle inputs changed, and
the verification-must-not-dirty-the-repo check) and prints per-check pass/fail
with only the failing lines. It also checks the one thing **CI cannot**: that
the branch has seen every commit on its base. CI tests the merge ref, so a
branch that predates a merge still goes green — while every "does this already
exist?" question you answer from the worktree gets the pre-merge answer. Red
there means rebase onto the base, re-run this gate, then open the PR. Run it inline: it projects its own output, so a
subagent adds nothing. The one thing it can't run locally is the macOS/Windows
legs of the CI matrix — *anticipate* those (phase 3's OS caveat).
**Small lane:** `scripts/local-gate.sh --small <test-file>` per
[reference/small-lane.md](reference/small-lane.md).

**6 · Open PR.** Open a **ready** (non-draft) PR. Title it as a
Conventional-Commit subject derived from the issue (the title becomes the squash
subject — the project's release history reads it). **If the repo has a PR
template**, fill it in honestly; otherwise write a plain body that keeps the
`Closes #<issue>` keyword and copies the phase-2 deviations log into a
**Deviations from plan** section ("None" only if the plan genuinely held).
**Reflect the PR back on the issue** right after opening (a comment linking the
PR) so a scheduled run won't re-pick it.

**7 · Review-bot loop.** **Only if the repo has an automated reviewer configured**
(per project instructions — never an assumption). **Here: CodeRabbit, automatic,
until converged — soft cap four rounds.** It reviews on PR-open and re-reviews
every push: triage each round, push the fixes, and stop when a round returns
nothing actionable. A PR still silent minutes after opening means the reviewer
never ran — trigger it with `@coderabbitai review`, don't count silence as a
pass. Convergence, the cap, poll loop, and the infra-flake rails:
**[reference/review-loop.md](reference/review-loop.md)**.

**8 · CI.** CI runs from PR-open. `scripts/poll-pr.sh <pr>` covers this phase: it
reports the check conclusions (all three OS legs + the bundle job) and surfaces
a conflict immediately (`mergeable_state: dirty`). A conflicted PR has no merge
ref, so merge-commit checks never start and CI sits **pending forever** — don't
wait on it. Resolve: fetch the latest default branch, rebase (or merge) it in,
fix conflicts, **re-run the local gate (phase 5)**, and push — that recomputes
the merge ref and lets CI run. Then land the checks green. **A red macOS or
Windows leg with a green Linux leg is a real signal, not a flake** — the matrix
exists because browser discovery and path handling are per-OS claims; fix from
the leg's log.

**9 · Merge gate.** **Hard stop.** Post the summary and wait for the user's
explicit "merge"; on approval, squash-merge, delete the branch, clean up the
worktree. Summary format and merge mechanics:
**[reference/merge-gate.md](reference/merge-gate.md).**

## Reference files

- `reference/context-discipline.md` — the delegation rule; keeping the long run
  from bloating context; the required first-action task list.
- `reference/small-lane.md` — the reduced spine for small changes: what collapses,
  the floor, revocation.
- `reference/implement.md` — phases 1–3: spec precedence, change classification,
  external-claim verification, verify-where-it-failed (the OS caveat).
- `reference/review-loop.md` — phase 7: the CodeRabbit loop, convergence and
  the soft cap, triage rails and infra-flake handling.
- `reference/merge-gate.md` — phase 9: the merge-summary template and the
  squash-merge / cleanup mechanics.
