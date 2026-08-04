# Phase 9 — the merge gate

This is the merge gate — the one guaranteed human stop (rationale in the autonomy
contract in SKILL.md). Your job is to make that call a 10-second yes/no by laying
out everything they'd want to check.

## Post this summary, then stop

```
## /ship summary — #<issue>: <title>

PR:        <url>  (<branch> → main)
Issue:     <one-line restatement of what was asked>
Lane:      <full | small — skipped: browser verification, full local suite (CI)>

Implementation
  - <what was built, 1–3 lines>
  - tests added/updated: <files / count>
  - bundle: <untouched | rebuilt and committed (inputs changed)>

Deviations from plan
  - <departure: what + why, conservative option taken>   (or: None — plan held)

Browser verification
  - <what was run: smoke / targeted render / tests/<area>.js>  → <pass | handed to you>
  - OS-specific claims: <none | proven by CI leg: <os>>

Self-review (code-review skill — the review gate; no bot in this repo)
  - <comment> → <fixed | rejected: reason | n/a>
  ...

Local gate:  tests <✓/✗> · fingerprint <✓/✗> · bundle-repro <✓/✗/n/a> · clean-tree <✓/✗>
Docs-sync:   <ran: files | skipped: reason>
CI:          <ubuntu / macos / windows / bundle> → <green | state>

Ready to merge. Reply "merge" to squash-merge, delete the branch, and clean up.
```

Then **wait.** Do not merge until the user explicitly says so. Never use an
auto-merge flag.

## On approval

Run `scripts/merge-and-verify.sh <pr> <issue>` — it squash-merges via REST with
the PR title as the squash subject (the release history reads it, so the title
must already be the Conventional-Commit line), re-verifies the PR actually
merged, deletes the remote branch (this repo does **not** auto-delete branches
on merge), and confirms the linked issue closed (closing it if the
`Closes #<issue>` keyword didn't).

Then clean up the local workspace: a squash-merged branch isn't an ancestor of
the default branch, so local branch deletion needs a force delete, and exiting
the worktree should discard its now-orphaned changes.

## If the user says no / wants changes

Treat their note as the next round of work: apply it on the same branch, re-run
the local gate, and come back to this gate. Don't re-open the whole pipeline.
