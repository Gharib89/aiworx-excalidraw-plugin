# aiworx-excalidraw-plugin

Claude Code plugin: author `.excalidraw` diagrams with real text metrics and headless visual verification. See `README.md` for architecture and `skills/excalidraw-diagram/SKILL.md` for the authoring workflow.

Plain Node ≥18 ESM, no build step for consumers: the browser bundle (`dist/excalidraw-page.js`) is **committed** and fingerprint-stamped — `tools/browser.js` refuses a stale one. No TypeScript, no linter, no formatter gate — the test suite, the clean-tree check, and bundle reproducibility are the whole CI gate. Rendering drives the machine's **system Chrome** (`CHROME_PATH` overrides discovery).

## Commands

```bash
npm ci --omit=dev                 # runtime deps (playwright-core) — all a checkout needs to run the tests
npm ci                            # + dev deps (esbuild, @excalidraw/excalidraw, react) — needed only to rebundle
npm test                          # full suite: layout, wrap, gate, dark, failure paths, CLIs, palette, author API, browser smoke
node tests/<area>.js              # one suite file directly (e.g. tests/gate.js) — they're plain Node scripts
npm run bundle                    # rebuild dist/ from tools/page.js
node tools/check.js d.excalidraw  # mechanical gate on a diagram; --json for machines
```

CI (`.github/workflows/ci.yml`): `npm test` on a **3-OS matrix** (ubuntu / macos / windows — browser discovery and path handling are per-OS claims) + a **clean-tree check** (verification must never dirty tracked files) + a **bundle job** (rebuild from the locked toolchain, smoke it, gate the clean fixture). A red macOS/Windows leg with a green Linux leg is a real signal, not a flake.

## Bundle discipline

Touching a **bundle input** — `tools/page.js`, `tools/bundle.js`, or a lockfile-resolved version of `@excalidraw/excalidraw` / `react` / `react-dom` / `esbuild` (that's exactly what `tools/fingerprint.js` hashes) — requires `npm run bundle` and committing the rebuilt `dist/` **in the same change**; otherwise the stamped fingerprint mismatches and every browser call refuses to run.

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
- **`skills/excalidraw-diagram/`** — the shipped skill (SKILL.md + reference/). Update it when tool behavior, gate rules / problem codes, CLI flags, or the authoring workflow change. **Self-contained**: it ships to plugin users who don't have the repo — never link a shipped skill file to a repo path; inline what's needed.
- **No CHANGELOG** — history lives in Conventional-Commit squash subjects.

## Release

Manual. Bump the version in **both** `package.json` and `.claude-plugin/plugin.json` (the lockfile carries package.json's number), commit as `chore(release): X.Y.Z`. Squash-merge PRs with the PR title as the Conventional-Commit subject (`feat(gate): …`, `fix(author): …`); scope by area (gate, author, fonts, browser, skill, ci, examples). Minor for genuinely new capability, patch for fixes and polish.

## Code review

**No automated reviewer** (no Copilot ruleset, no CodeRabbit). Review = a deliberate self-review (`code-review` skill) on the diff + green CI. Don't skim it — nothing runs behind it.

## Agent skills

### Shipping an issue

`/ship <issue>` (`.claude/skills/ship/`) drives an issue to a merge-ready PR unattended, stopping at a human merge gate. It claims via `ready-for-agent` → `agent-working`, works in a worktree, and squash-merges on approval. Its `scripts/local-gate.sh` mirrors the CI checks locally.

### Issue tracker

Issues live in GitHub Issues on `Gharib89/aiworx-excalidraw-plugin` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, plus `agent-working` (claimed by `/ship`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
