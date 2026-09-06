# Context discipline — a ship run is long; protect the main thread

A full ship touches many files across many turns. What bloats the window is raw
tool output landing in the main thread, not the work itself — so spend tokens on
decisions, not dumps.

**The delegation rule — delegate noise, not size.** A subagent earns its cost only
when the raw output you'd otherwise ingest is much larger than the conclusion you
need: a multi-file map, a full suite run, CI logs, a poll loop. When you can
already point at the target — one or two known files, a single test file, one
projected `gh` call — work inline; a subagent there costs more than it saves
(spawn overhead, relay loss, re-reading). A small-lane run typically spawns none
of its own (the `code-review` skill and the poll loop bring theirs); a large or
unfamiliar change may spawn several. Every lever below is subject to this rule.
In rough order of impact:

- **Delegate reading, not just review.** Don't read N files into the main thread
  to build a mental model. Send the investigation to a subagent (at the cheap
  tier — see the model-tier table in SKILL.md) — "map how X, Y, Z connect; return
  signatures, call sites, and the data shapes" — and it returns a small
  conclusion, then read only the exact lines you will edit. On a large or
  unfamiliar change this is the single biggest lever: a file body you only need
  to *understand* should never enter main context, only the hunk you *change*
  should.
- **Project every `gh` / CLI / API call.** Pipe `gh … --json <only-the-fields>
  --jq '…'`. A bare `gh pr view --json` serializes the entire PR object (repo
  metadata twice, every URL field) — kilobytes of noise from one call. The
  `scripts/` wrappers already project theirs — prefer them where a phase names
  one.
- **Investigate inside the worktree from the start** (phase 0 first), so you never
  read a file in the main checkout and then re-read it in the worktree to edit it.
- **Trust Edit/Write — don't verify-Read after a successful edit.** The tool
  errors if the match failed and the harness tracks file state for you; a re-Read
  to "confirm" the change is pure cost.
- **Targeted test files during the loop; full suite only at the local gate.** Run
  the one `tests/<area>.js` you touched (`node tests/gate.js`); re-running
  `npm test` — which includes the browser smoke suite — every cycle is slow
  noise.
- **Delegate the noisy verification *runs*, not just reads.** The browser smoke
  suite and multi-frame renders (phase 3) dump volumes of output — run them in a
  cheap-tier subagent (model-tier table in SKILL.md) that returns a pass/fail
  summary plus only the failing lines. The local gate (phase 5) and CI polling
  (phase 8) are already scripts that project their own output — run those
  inline, no subagent. (A single targeted test file's output is already small —
  run it inline too.)
- **One scratch file for the run's task list and the design/plan** (it survives
  a mid-run context summary); don't restate the same summary across turns.

## First action — the run's task list

**Before phase 0, before the worktree**, write the run's task list into the
scratch file (the one that later holds the design/plan): a ten-item markdown
checklist, one line per phase. Name it `ship-<issue>.md` and put it in the
scratchpad directory the harness names in its environment block, the
session-scoped temp directory outside the repo; with none named, use the OS temp
directory. The file is the source of truth. It survives a mid-run context summary and depends
on no tool the harness might withhold. Mirror it into the harness task tools
(`TaskCreate` per item; `TaskUpdate` to change status; `TaskList` to re-read)
only when they are already loaded or one `ToolSearch` probe
(`select:TaskCreate,TaskUpdate,TaskList`) loads them. A probe that returns
nothing is the normal case on Claude 5-family models: the harness drops these
tools there unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is set. Treat that as the
answer and proceed on the file alone.

One item per phase, exactly one `in_progress` at a time (the one `- [ ]` line
carrying an `in_progress` suffix), each marked `completed` (`- [x]`) only when
its verification passed. This is the
progress surface for an unattended run and the map back if context is summarized
mid-run — without it, a mid-run summary leaves you unable to tell which phase you
were in, so you skip or repeat one. A **small-lane** run keeps the same ten items — mark each collapsed phase
`completed` with a note `skipped (small lane)` when you reach it, so the record
shows a decision, not a gap. Create exactly these ten items:

- [ ] 0 · Isolate — worktree on a fresh branch off default
- [ ] 1 · Understand — fetch issue, derive success, claim it, apply spec precedence
- [ ] 2 · Implement — classify (docs/code/infra), then TDD per class; rebundle if a bundle input moved
- [ ] 3 · Browser-verify — smoke/render only what you touched; OS-specific claims wait for the CI matrix
- [ ] 4 · Docs-sync + self-review — sync docs first so the review covers them, then `code-review` skill on the diff, auto-triage findings
- [ ] 5 · Local gate — mirror the full CI checks (covers the synced docs), all green
- [ ] 6 · Open PR — ready (non-draft), Conventional-Commit title, reflect on the issue
- [ ] 7 · Review-bot loop — request each Copilot round and triage to convergence (soft cap 4)
- [ ] 8 · CI — resolve any base-branch conflict, then land all matrix legs + bundle job green
- [ ] 9 · Merge gate — hard stop for human merge approval
