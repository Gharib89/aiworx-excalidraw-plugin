# Phases 1–3 — understand, classify, implement, browser-verify (detail)

Phase 2 leads (classification drives everything downstream); the phase-1 and
phase-3 deep-dives follow at the end.

## Phase 2 — classify, then implement test-first

First **classify the change** into one of three classes — this decides whether
TDD applies and which verification proves it. **Announce the class and the
skip path it implies** — e.g. "classified `docs` → skipping TDD and the phase-3
browser verification, going straight to the local gate" — so a wrong label is a
visible decision now, not a silently-skipped verification later. Later phases
refer back to this class by name.

- **`docs`** — markdown (README, the shipped skill, agent docs), comments,
  manifest text with no logic: **skip TDD** (no behavior to red→green). Mark the
  commit `docs:`. Don't manufacture a contrived test.
- **`code`** (feature / bugfix in `tools/` or `tests/` behavior): invoke the
  `tdd` skill **autonomously** — red→green→refactor **without pausing for plan
  approval** (you're intentionally overriding tdd's plan-approval checkpoint;
  the merge gate is the review point). This repo's suites are plain Node scripts
  under `tests/` — a new case goes into the existing `tests/<area>.js` for the
  area, wired into `npm test` via `package.json` only if it's a genuinely new
  file.
- **`infra`** (tooling / refactor where a strict red→green is awkward — the
  change *is* the bundler, CI, a fixture, or `smoke.js` itself): don't force a
  contrived red. Extract the logic into a testable seam and unit-test its
  **observable behavior** through that seam; let the real run (phase 3) be the
  integration proof.

When in doubt between `code` and `docs`, treat it as `code` and write the test.

**Bundle inputs are a tripwire, not a class.** Whatever the class: touching
`tools/page.js`, `tools/bundle.js`, or moving a lockfile-resolved version of a
bundled dep requires `npm run bundle` + committing `dist/` in the same change —
`browser.js` refuses a stale fingerprint, so every later browser-dependent step
goes red if you forget.

## Phase 2 — delegate execution, keep judgment

Phase 2 fuses two kinds of work. **Judgment** — the classification above, the
lane keys, spec interpretation, external-claim probes, design choices — stays in
the main thread on the judgment tier. **Execution** — writing the failing test,
making it green, refactoring, all from a plan the main thread already set — is
mechanical-tier work: delegate it to ONE sonnet subagent when the plan is
settled and the change is bounded (small lane, sharp-brief fixes). Keep it
inline when the plan itself is still uncertain — a plan/implement feedback loop
across a subagent boundary loses too much. The phase-4 Standards review (opus,
full diff) is the safety net either way.

Hand the subagent: the worktree path, the plan, the test command, and the repo
conventions the edit needs. Require back: a diff summary, the test files/cases
added or updated, and a **structured deviations list** — it lands verbatim in
the PR body, and a subagent that fixes-and-forgets loses it. Two tripwires in
its prompt:

- Every Edit/Write path carries the **worktree prefix** — an absolute
  main-checkout path silently edits the wrong tree. After its first edit,
  `git -C <main-checkout> status` must be clean.
- It runs only the **targeted test files**; the phase-5 gate stays with the
  orchestrator.

## Verify the spec's external-system claims before building on them

If the issue asserts a *causal mechanism* about something outside this repo's
code — an Excalidraw library behavior ("exportToSvg does X"), a Chrome/CSS
rendering claim (the dark-theme filter, font subsetting), a Playwright or esbuild
behavior, an OS path/discovery claim — treat it as a **hypothesis, not a fact**
and confirm it against the real thing with the cheapest possible probe (one
smoke-style browser call, one render, one measured string) *before* writing the
fix around it. A triage brief's root cause is frequently a plausible guess;
building on a wrong one means implementing the fix, having phase 3 disprove it,
and rebuilding from scratch. Verifying up front collapses that loop — and if the
probe contradicts the brief, that's an early stop-and-report, not a phase-3
surprise. (This repo exists because two such claims — font registration and
glyph subsetting — turned out to be traps; assume more are lurking.)

## Phase 1 detail — spec precedence

A later triage brief / authoritative comment can *supersede* the issue body —
when they conflict (scope reduced, an option chosen, an axis dropped), the latest
authoritative spec wins, and the body's original acceptance criteria no longer
bind. Note this explicitly in the deviations log so the merge summary carries it.

## Phase 3 detail — verify where it failed

Run the browser-dependent verification **for only what you touched** — never the
whole suite — and create or update those tests as part of the work: the smoke
suite for measurement/export/warm claims, a targeted `node tools/render.js` (or
`check.js`) run for gate/layout claims, the area's `tests/<area>.js` for the
rest. **Verify on the environment the bug was actually reported against:** this
machine proves **Linux** claims. If the issue names macOS or Windows behavior —
Chrome discovery, path handling, junction links — a local green is misleading;
say so, write the test so the **CI matrix leg** proves it, and treat that leg's
result as the verification (watch it in phase 8). If no usable Chrome exists
locally (`CHROME_PATH` unset and discovery fails), print the exact command +
required setup, hand it back, and wait for the user to confirm it passed. Green
≠ fixed unless it's green where it failed.
