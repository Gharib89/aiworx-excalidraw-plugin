# Context discipline: a ship run is long; protect the main thread

A full ship touches many files across many turns. What bloats the window is raw
tool output landing in the main thread, not the work itself, so spend tokens on
decisions, not dumps.

**The delegation rule: delegate noise, not size.** A subagent earns its cost
only when the raw output you would otherwise ingest is much larger than the
conclusion you need: a multi-file map, a verification run, CI logs. When you
can already point at the target (one or two known files, a single test node,
one mechanic's projected JSON) work inline; a subagent there costs more than it
saves. A small-lane run typically spawns none of its own; a large or unfamiliar
change may spawn several. The rule is a lever, never a dependency: a session
with no subagent tools runs everything inline and is still a complete run.
Every lever below is subject to it, in rough order of impact:

- **Delegate reading, not just review.** Send the investigation to a cheap-tier
  subagent ("map how X, Y, Z connect; return signatures, call sites and data
  shapes") and read only the exact lines you will edit. A file body you only
  need to *understand* never enters main context; only the hunk you *change*
  does.
- **Mechanics already project.** Every host read comes through a mechanic that
  returns a small JSON; there is no bare host CLI call to over-fetch with.
- **Investigate inside the worktree from the start**, so you never read a file
  in the main checkout and re-read it in the worktree to edit it.
- **Trust Edit/Write.** The tool errors if the match failed and the harness
  tracks file state; a re-Read to confirm is pure cost.
- **Targeted test nodes during the loop; the full suite only at the local
  gate.** Re-running the whole suite every cycle is slow noise.
- **Delegate noisy verification runs.** A phase-3 verification that dumps
  volumes goes to a cheap-tier subagent returning `pass | fail` plus the
  failing lines. The local gate, `base-fresh`, `poll-pr` and `ci-wait` project
  their own output: run them inline.
- **One Run file** for the checklist and the design and plan. It survives a
  mid-run context summary; the same summary repeated across turns does not.

## First action: the Run file

**Before phase 0, before the worktree**, write the **Run file**:
`ship-<issue>.md` (`ship-<slug>.md` when the argument was a task spec) in the
scratchpad directory the harness names in its environment block, or the OS
temp directory when none is named. Never inside the repo. It holds the
ten-item checklist below and, as they form, the design and plan. It is the
**source of truth** for where the run is: it survives a mid-run summary and
depends on no tool the harness might withhold. Without it a summarized run
cannot tell which phase it was in, and skips or repeats one.

The harness task tools are an **optional mirror**, decided per run, never per
repo: one `ToolSearch` probe (`select:TaskCreate,TaskUpdate,TaskList`). Tools
present: mirror each flip. Nothing returned: an answer, not a fault; proceed on
the file alone.

**Stamp every flip** from `date -u +%H:%M`, never an estimate. Stamps go at the
end of the line, after the `in_progress` suffix, one range per parentheses:

```
- [ ] 5 · Local gate: ... in_progress (10:12→)          # opened
- [x] 5 · Local gate: ... (10:12→10:19)                  # closed, suffix gone
- [x] 2 · Implement: ... (08:31→09:40) (10:20→10:33)     # re-opened by a red gate
```

A phase that re-opens appends a second range. A range whose close reads
earlier than its open crossed midnight UTC and is 24 h longer than it looks.
The merge summary's `Timing:` line is read off these stamps, and they are the
only way to see which phase a slow run spent its hours in.

One item per phase, exactly one `in_progress`, each `completed` only when its
verification passed. A **small-lane** run keeps all ten and marks each
collapsed phase `completed` with `skipped (small lane)`, so the record shows a
decision, not a gap. The wording of items 2, 3, 7 and 8 comes from the profile
(`Tripwires:`, the applicable verifications, the reviewer list, the CI legs);
write it in when you create the file. Create exactly these ten:

- [ ] 0 · Isolate: preflight, worktree (or in place) on a fresh branch off the default
- [ ] 1 · Understand: read the issue, derive success, claim, apply spec precedence
- [ ] 2 · Implement: classify (docs/code/infra), lane keys, TDD per class, tripwires <from the profile>
- [ ] 3 · Verify: <applicable verifications from the profile> scoped to what changed
- [ ] 4 · Docs-sync + self-review: sync docs first, then `code-review` on the diff, auto-triage
- [ ] 5 · Local gate: base-fresh, then the repo's gate, all green
- [ ] 6 · Open PR: non-draft, Conventional-Commit title, Closes, reflect on the issue
- [ ] 7 · Reviewers: <each reviewer and its trigger from the profile> to convergence
- [ ] 8 · CI: resolve any conflict, land <legs from the profile> green
- [ ] 9 · Merge gate: hard stop for human approval (unattended: summary as PR comment, return)
