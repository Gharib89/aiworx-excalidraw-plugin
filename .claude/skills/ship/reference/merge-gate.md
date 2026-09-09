# Phase 9: the merge gate

The one guaranteed human stop (the autonomy contract in SKILL.md). Your job is
to make the call a ten-second yes or no by laying out everything the human
would want to check.

**Write it uncompressed.** A session-wide output style or personal brevity rule
does **not** apply to this summary. It is the evidence a human approves an
irreversible squash-merge on, and in the unattended lane it is the only record
of the run. Never paste organization identifiers, credentials or live-system
names into it; the repo may be public.

## The summary

```
## /ship summary: #<issue>: <title>   (ship <version>)

PR:        <url>  (<branch> → <default branch>)
Issue:     <one-line restatement of what was asked>
Lane:      <full | small: skipped <phase 3 verifications, docs-sync>>

Implementation
  - <what was built, 1 to 3 lines>
  - tests added/updated: <files / count>
  - tripwires: <none fired | <what was rebuilt or bumped>>

Deviations from plan
  - <departure: what and why, conservative option taken>   (or: None, plan held)

Verification                                   (one row per applicable entry)
  - <name>: <pass | fail | deferred-to-ci: <CI leg> | unavailable>   <what ran>
  (or: none applicable: <class docs | small lane>)

Self-review (code-review skill, the review gate)
  - <finding> → <fixed | rejected: reason>
  ...

Review                                         (one block per reviewer)
  <name> (<trigger>, <n> rounds): <converged | converged, override needed | degraded: <reason>>
    - <finding> → <fixed in <sha> | declined: reason | filed: #<n>>
    ...                                        (or: clean, no findings)

Local gate:  <derived from the gate's JSON: <gate> <✓ | ✗ | deferred-to-ci | unavailable> · ...>
Docs-sync:   <ran: files | skipped: reason>
CI:          <leg> → <green | state> · ...     (from the profile's Legs:)
Issues filed: <#n <title>, ... | none>
Timing:      start→PR <m>m · PR→gate <m>m · per phase: 0 <m> · 1 <m> · 2 <m> · 3 <m> · 4 <m> · 5 <m> · 6 <m> · 7 <m> · 8 <m>
             (from the Run file's stamps: start→PR is phase 0's open to phase 6's
             close, PR→gate is phase 6's close to phase 8's close; a re-opened
             phase sums its ranges)

Ready to merge. Reply "merge" to squash-merge, close the issue, and clean up.
```

The `Local gate:` row is the gate's `gates` object verbatim, never retyped from
memory. `Issues filed` lists every issue the run filed, in every lane; an
implausible count is the human's signal. The `Review` blocks say what the PR
body's `## Review` section says, in more detail; the section links here.

## Attended: post, then wait

Post the summary in the conversation and **wait**. Merge only on an explicit
"merge". Never an auto-merge flag: it can merge the instant CI is green,
before a reviewer lands.

**On approval**, from the worktree, `merge <pr> <issue> --worktree <path>`. It
squash-merges with the PR title as the squash subject, re-verifies the PR is
merged before reporting (never assume the command took), confirms the issue
closed and closes it explicitly if the link did not fire, deletes the remote
branch and proves the deletion, fast-forwards the local base branch from the
checkout that holds it (a plain pull from the feature worktree would pull the
base *into* the feature branch; a diverged local base is reported, never
discarded; a transient `index.lock` from a concurrent status is retried, never
deleted), and **releases the claim and strips `ready-for-agent`**, so a
reopened issue goes back through triage instead of being refused forever.
Then `cleanup <issue>`: removes the worktree and force-deletes the local
branch (a squash-merged branch is not an ancestor of the default branch).
Carried files are never copied back. Any `false` in either JSON: finish that
step by hand before reporting done.

**If the human says no or wants changes**, treat the note as the next round of
work: apply it on the same branch, re-run the local gate, come back to this
gate. Do not re-open the whole pipeline.

## Unattended: post to the PR, then return

`comment-pr <pr> --body-file` with the summary. Then **return** with the PR
link. Do not wait, poll, or merge; the claim stays on the issue, which carries
the open PR, so later fires skip it until a human merges. The line
"Ready to merge. Reply ..." becomes "Ready to merge: a human merges from the
PR." Detail in [unattended.md](unattended.md).
