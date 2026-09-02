# aiworx-excalidraw-plugin

Claude Code plugin: author `.excalidraw` diagrams with real text metrics and headless visual verification. See `README.md` for architecture and `skills/excalidraw-diagram/SKILL.md` for the authoring workflow.

Plain Node ≥18 ESM, no build step for consumers: the browser bundle (`dist/excalidraw-page.js`) is **committed** and fingerprint-stamped — `tools/browser.js` refuses a stale one. No TypeScript, no linter, no formatter gate — the test suite, the clean-tree check, and bundle reproducibility are the whole CI gate. Rendering drives the machine's **system Chrome** (`CHROME_PATH` overrides discovery).

## Commands

```bash
npm ci --omit=dev                 # all a checkout needs to run the tests
npm ci                            # + dev deps — needed only to rebundle
npm test
npm run test:fast                 # ~12s, launches no Chrome — the iteration loop
npm run test:browser              # the Chrome-dependent rest
node tests/<area>.js              # one suite directly (e.g. tests/gate.js) — plain Node scripts
npm run bundle                    # rebuild dist/ from tools/page.js
node tools/bump-version.js minor  # moves plugin.json + package.json + lockfile together
node tools/version-gate.js --base origin/main   # what CI asks before it lets a content change merge
bench/run.sh [slug]               # a bench run: the benchmark corpus rendered headlessly at this version — manual, paid, not CI; bench/README.md
```

CI (`.github/workflows/ci.yml`): `npm test` on a **3-OS matrix** (ubuntu / macos / windows — browser discovery and path handling are per-OS claims) + a **clean-tree check** (verification must never dirty tracked files) + a **bundle job** (rebuild from the locked toolchain, byte-compare against the committed `dist/`, smoke it, gate the clean fixture) + a **plugin job** (the version gate below, plus `claude plugin validate . --strict` against a pinned CLI). A red macOS/Windows leg with a green Linux leg is a real signal, not a flake.

A **new suite must be wired into `test:fast` or `test:browser`** — `tests/test-targets.js` fails on one that is in neither, in both, or missing from disk, and it pins `test` to exactly `test:fast && test:browser` so the split can never narrow the gate. `test:fast` stays Chrome-free: `tests/chromeless.js` (in `test:browser`) re-runs every fast suite with `CHROME_PATH` pointed at nothing. Importing `tools/browser.js` is fine — only a *successful launch* breaks the fast target.

## Bundle discipline

Touching a **bundle input** — `tools/page.js`, `tools/bundle.js`, `tools/fonts.js`, or any lockfile move inside the transitive closure of the bundled roots (`@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, `react`, `react-dom`, `esbuild` and everything they pull in — exactly what `tools/fingerprint.js` hashes) — requires `npm run bundle` and committing the rebuilt `dist/` **in the same change**; otherwise the stamped fingerprint mismatches and every browser call refuses to run. `dist/` ships three things — the bundle, `dist/index.html` (the loader page Chrome navigates to, which also points Excalidraw at the local fonts), and `dist/fonts/` (the woff2 files `tools/fonts.js` names, vendored so measuring and rendering reach no CDN) — and `.gitignore` un-ignores them **by name**, so any new `dist/` path needs its own un-ignore line or it is silently left uncommitted.

## Branch & worktree discipline

The main checkout (`~/wip/projects/aiworx-excalidraw-plugin`) may be shared by concurrent agent sessions — **never develop in it directly**. Any feature or bug fix happens in a **git worktree on a fresh branch**:

1. `EnterWorktree` (or `git worktree add`), branch named `<type>/<slug>[-<issue>]`.
2. `npm ci --omit=dev` in the worktree — node_modules is not shared; full `npm ci` only when rebundling.
3. All work, commits, and the PR happen from that branch.
4. Remove the worktree after merge.

In the shared checkout itself: read-only work and small docs-only commits to `main`. Before **any** git mutation anywhere: `git branch --show-current && git status -sb` first, and stage with explicit paths, never `git add -A`.

## Keep docs in sync with code

Every user-visible change ships its docs in the **same** change:

- **README.md** — capability, flag, or install changes.
- **`skills/excalidraw-diagram/`** — the shipped skill (SKILL.md + reference/). Update it when tool behavior, gate rules / problem codes, CLI flags, or the authoring workflow change. It is **self-contained**: it ships to plugin users who don't have the repo, so inline what a reader without a checkout needs and keep every link inside `skills/`.
- **`CONTEXT.md`** — the ubiquitous language. Renaming a term there updates every consumer in the same change; the file states which they are.
- **`examples/`** — a band **draws** commands on canvas, so correcting one means regenerating the artifact rather than editing a file. A command or flag change lands in every band that draws it: grep the generators for it, then re-run each one whose text moved. `tests/drawn-commands.js` walks every committed band and holds its drawn flags to the CLIs' real inventories (`tools/cli-flags.js`) — a band left behind goes red in `test:fast`.
- **History** lives in Conventional-Commit squash subjects; this repo keeps no CHANGELOG.

The documents **written for an agent** are the shipped skill, this file, `CONTEXT.md` and `docs/agents/`. Edit those through the `writing-for-agents` skill, which carries the levers. README and code comments are prose for humans and take an ordinary edit.

## Release

**The version ships with the change, not after it.** An install is a cached copy that refreshes when the marketplace's version moves, so content merged under the version an install already has never reaches it. A PR that touches what a session loads — `skills/`, `tools/`, `dist/`, `brand/`, `.claude-plugin/` — carries its own bump: run `node tools/bump-version.js [patch|minor|major]` (it moves `package.json`, `.claude-plugin/plugin.json` and the lockfile together, which is the agreement CI checks) and commit the result **in that PR**. Minor for genuinely new capability, patch for fixes and polish — the part stays your judgment, the arithmetic is the helper's. `node tools/version-gate.js --base origin/main` answers before CI does. A PR that touches none of those surfaces needs no bump.

Squash-merge PRs with the PR title as the Conventional-Commit subject (`feat(gate): …`, `fix(author): …`); scope by area (gate, author, fonts, browser, skill, ci, examples).

## Code review

**GitHub Copilot reviews on request** — it is a requested reviewer, not a webhook, so a PR sits unreviewed until someone asks. One POST makes the request; the second call reads it back:

```bash
PR=219
gh api -X POST "repos/{owner}/{repo}/pulls/$PR/requested_reviewers" \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
gh api "repos/{owner}/{repo}/issues/$PR/timeline" --paginate \
  --jq '.[] | select(.event == "review_requested") | .requested_reviewer.login'   # read it back
```

**Read the request back off the timeline, not off `requested_reviewers`.** Copilot never appears in `requested_reviewers` — that array comes back `[]` on a request that queued perfectly and delivered a review three minutes later, so reading it proves nothing, and calling that *unavailable* aborts a round already on its way. The `review_requested` event is the durable proof, and it names the reviewer **`Copilot`** while the review it eventually posts is authored by **`copilot-pull-request-reviewer[bot]`** — two identities for one reviewer, so match whichever the endpoint you are reading actually uses.

A round takes **two to four minutes**. No `review_requested` event means the request never landed: retry once, then treat the reviewer as unavailable and mark the exit degraded.

Copilot posts **one review per request** and does not re-review on push. After a round of fixes, request again — that is what makes the next round, and it is why rounds are counted rather than assumed.

**Drive it until converged, soft cap four rounds.** Converged = the latest round returns nothing actionable, every thread from all rounds is dispositioned, and CI is green. A round 4 that is still substantive is a shape problem more rounds won't fix — stop and mark the exit **degraded** rather than push a fifth round.

**Triage every comment.** Copilot does not know this repo's constraints: verify every nit against the **pinned** dependency versions, harden rather than rip out capability, and reject known non-issues with a one-line reason. Record a disposition per comment.

Copilot is a second pair of eyes. **The gate** is a deliberate self-review (`code-review` skill) on the diff plus green CI — give it the same attention as the code it covers.

## Agent skills

`/ship <issue>` (`.claude/skills/ship/`) drives an issue to a merge-ready PR unattended, stopping at a human merge gate. It claims via `ready-for-agent` → `agent-working`, works in a worktree, squash-merges on approval, and releases the claim on merge — or hands the issue back to `needs-triage` if it stops blocked. Its `scripts/local-gate.sh` mirrors the CI checks locally.

- **Issues** live in GitHub Issues on `Gharib89/aiworx-excalidraw-plugin`, driven with `gh`. Command recipes, the number space PRs share with issues, and the wayfinder map/child conventions: `docs/agents/issue-tracker.md`.
- **Triage labels**: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, plus `agent-working` — a `/ship` claim rather than a triage state. Its lifecycle, and how to clear one a dead run left behind: `docs/agents/triage-labels.md`.
- **Domain** is single-context — `CONTEXT.md` and `docs/adr/` at the repo root. How a skill should read them before exploring, and what to do when its output contradicts an ADR: `docs/agents/domain.md`.
