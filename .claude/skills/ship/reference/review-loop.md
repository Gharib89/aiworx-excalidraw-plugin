# Phase 7: driving every reviewer to convergence

The profile's `## Reviewers` lists zero or more reviewers. Each has the login(s)
it posts under, a `Trigger:`, `Gating:`, an optional `Instructions:` file, and
per trigger: `Request:` and `Cap:` (on-request), `Resolve:` (on-push). The
**trigger fixes the loop, convergence and cap**; the bot's brand fixes nothing.
Zero reviewers: the phase-4 self-review plus green CI is the review gate; skip
this phase. Phase-4 self-review plus green CI is the gate in every other case
too; reviewer rounds are a second pair of eyes.

A reviewer re-reads the **whole PR** each round: treat every round's output as
a fresh read of the committed tree, not a conversation.

## Shared mechanics

- **Poll with `poll-pr <pr> --await-review <login>`**, inline, bounded,
  foreground. It returns one JSON: head sha, mergeable, checks, reviews keyed
  to the **current head** (a review on an older commit does not count) with
  `substantive`, threads with resolved state, and `reviewer_blocked`.
  `done: false` means the window closed first: re-run to extend, never a
  background monitor. The poll is the landing signal only; before triage, read
  the round's review body and threads from the same payload.
- **A round is a review with a body.** A reviewer's reply to one thread posts
  as a review row of its own (current head, empty body), so answering round N
  manufactures rows that look like round N+1 arriving. Only `substantive: true`
  counts; hold any hand check to that bar.
- **Triage, don't apply**, at the judgment tier, with phase 4's definition:
  harden rather than rip out capability, verify nits against the pinned
  versions, reject known non-issues with a one-line reason. The two rejection
  rails apply: check repo-existence claims against `origin/HEAD`, and judge a
  claim separately from the evidence it cites. Check the reviewer's
  `Instructions:` file when a finding contradicts it (a host may truncate that
  file; cite it when declining). A valid finding outside the issue is an
  adjacent find: file it, and disposition the thread with the link. That is
  also the honest answer to a gating reviewer.
- **Batch fixes into one push per round**, then reply on every thread
  (`fixed in <sha>`, or the decline and its reason). Every push spends review
  quota and CI minutes, and an on-push reviewer's round.
- **Per-reviewer accountability.** Each reviewer gets its own block in the
  merge summary and its own line in the PR body's `## Review` section
  (`update-pr-body` at phase-7 exit): `converged`,
  `converged, override needed`, or `degraded: <reason>`, plus the round count.

## By trigger

### `auto-once`

Fires once on PR creation; nothing to request and **never re-requested**. Wait
for it to land with `poll-pr --await-review <login>`; if a round arrives before
you poll, that is the round. Triage it once, push the fixes, reply on each
thread. **Converged** when every thread is dispositioned. A later push does not
bring it back; a lint or flake fix after convergence needs nothing from it.

### `on-push`

Re-reviews every push; rounds are free and uncapped. After each push, wait for
a review **landed on the current head**; silence on the head is never quiet.
Triage, batch-fix, push, reply on each thread. Once **every** thread carries a
disposition, and only then, use the reviewer's `Resolve:` mechanism
(`resolve-thread`, or the comment the profile names) to resolve them.
**Converged** when a review has landed on the current head with nothing
actionable and every thread is dispositioned and resolved. A fix pushed after
convergence gets re-read on its own: wait for quiet on the new head again.
When `poll-pr` reports `threads: unavailable`, this reviewer's exit is
`degraded: unreachable` and the run proceeds; the other triggers read reviews
and comments, which stay readable.

### `on-request`

Nothing arrives until asked. `request-review <pr> <login>` issues the request
and **reads it back** from the host's own record (the mechanic knows that the
login you request and the login you read back can differ, and that an empty
requested-reviewers list proves nothing). One request yields one round; the
reviewer does not re-review on push, so each round after the first is a new
request against the corrected tree. Loop: request, poll, triage, batch-fix,
push, reply on each thread, request again. **Converged** when the latest round
has nothing actionable and every thread from all rounds is dispositioned.
**Cap** is the profile's `Cap:`, required, no default: a round at the cap that
is still substantive is a shape problem more rounds will not fix; exit
`degraded: cap-hit` and leave the call to the human. Small lane: exactly one
round. A lint or flake fix after convergence earns no new request.

## Degraded exits: fixed vocabulary, per reviewer

Degraded means the reviewer did not finish its job; it proceeds to the merge
gate on green CI and never hands back on its own, in either lane. The human
reads the reason and decides.

| Reason | Detection |
|---|---|
| `never-queued` | on-request: no request event on the host's record after one retry. Do not spend a second poll window on it. |
| `blocked` | queued, then a quota or rate-limit comment from the reviewer (`reviewer_blocked` non-null), and the poll window closed. Non-null with `done: false` means waiting, not missing. |
| `silent` | queued, no review on the current head within the bounded wait. |
| `infra-error` | a review whose body is only an error notice with zero comments, twice. Not feedback. |
| `cap-hit` | on-request cap reached with the latest round still substantive. |
| `unreachable` | no host path to the reviewer from this environment, or thread state could not be read (`threads: unavailable`). |

## Gating reviewer with a declined finding

A `Gating: yes` reviewer can hold the merge on a finding you decline. Every
thread dispositioned, the declined finding cited with evidence, build still
red: the exit is `converged, override needed`. Not degraded, because the
reviewer ran; the human overrides the policy or accepts the finding at the
merge gate.

## Worked examples

Brand-level detail lives in the host adapters; these show the mapping only.

- **GitHub Copilot as `on-request`**: request per round, cap from the
  profile. Two identities behind one reviewer: the request names one login,
  the review posts under another, and the check run a third; the mechanics
  match each surface to its own name. Copilot enabled as an automatic review
  by a repository ruleset is `auto-once` instead.
- **CodeRabbit as `on-push`**: reviews every push; `Resolve:` is its resolve
  comment, posted once after every thread carries a reply.
- **Claude Code on GitHub Actions as `on-push`**: reviews every push through a
  workflow; no thread-resolution mechanism, so `Resolve:` reads `None.` and
  convergence rests on dispositioned threads and a quiet head.
- **Claude Code on Azure Pipelines as `on-push`, `Gating: yes`**: a build
  validation policy that fails the build on a critical finding; threads are
  Azure DevOps PR threads with `fixed | closed` status; a declined critical is
  `converged, override needed`.
