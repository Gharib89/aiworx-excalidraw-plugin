# Ship profile

Schema: 1

Every repo-specific fact `/ship` needs, one section per axis. Fourteen `##` headings, always present and in this order; a defaulted axis reads `None.` or `Default.`, never an omitted heading. Facts sit on `Label:` lines; the prose under a heading explains and never carries a fact. Vocabulary: the `ship` skill's source repo, `Gharib89/skills`, `CONTEXT.md`.

## Host

Host: github

Repo `Gharib89/aiworx-excalidraw-plugin`, derived from the origin remote. Auth is the ambient `gh` login.

## Worktree

Carry: None.
Bootstrap: None.

Nothing gitignored is needed to run the tests. Dependency install belongs to the local gate (`npm ci --omit=dev`, full `npm ci` only when a bundle input changed). Rendering drives the machine's system Chrome; `CHROME_PATH` overrides discovery.

## Local gate

Location: scripts/local-gate.sh
Small node: one suite file under `tests/`, run as a plain Node script, e.g. `tests/gate.js`
Tripwires: a change to a bundle input (`tools/page.js`, `tools/bundle.js`, `tools/fonts.js`, or a lockfile move inside the bundled closure) needs `npm run bundle` and the rebuilt `dist/` committed in the same change before the gate runs

The gate rebuilds the bundle itself when an input changed and fails `bundle:reproducible` if the committed `dist/` differs, so a forgotten rebuild is caught, not silently shipped. The `fingerprint` gate refuses a stale stamp in every lane. The macOS and Windows legs of `test` cannot run here; they are CI's alone.

## CI

Legs: test: `npm test` on ubuntu plus `npm run test:os` on macos and windows (a 3-OS matrix; a red macOS or Windows leg with a green Linux leg is a real signal), and the clean-tree check (verification must never dirty tracked files)
Legs: plugin: `node tools/version-gate.js` on PRs, then `claude plugin validate . --strict` against a pinned CLI
Legs: bundle: rebuild `dist/` from the locked toolchain, byte-compare against the committed one, smoke it, gate the clean fixture
Legs: secrets: `gitleaks/gitleaks-action` over the pushed or PR commits, the CI counterpart of the local gate's `secrets` gate
No-checks legal: no; `ci.yml` has no `paths:` filter, every PR runs all four
Push policy: Default.

One workflow, `.github/workflows/ci.yml`, `pull_request` and `push` on `main`. No other workflow exists.

## Reviewers

### Copilot

Login: `Copilot` on the `review_requested` timeline event, `copilot-pull-request-reviewer[bot]` on the review it posts
Trigger: on-request
Request: `request-review` mechanic (POST `requested_reviewers` with `copilot-pull-request-reviewer[bot]`; read the round back off the issue timeline, never off `requested_reviewers`, which is always empty for Copilot)
Cap: 2
Resolve: None.
Gating: no
Instructions: None.

A round takes two to four minutes and Copilot never re-reviews on push: every round is requested. It does not know this repo's pinned dependency versions; verify each finding against them before acting. CLAUDE.md `## Code review` carries the hand-driven recipe for sessions outside `/ship`.

## Coding standards

docs/contributing/coding-standards.md

## Verification

None.

Nothing in the repo talks to a remote system. The browser suites already drive real Chrome inside `npm test`, which the local gate runs.

## Versioning and changelog

Tooling: manual
Reads: `.claude-plugin/plugin.json` `version`, moved together with `package.json` and the lockfile by `node tools/bump-version.js [patch|minor|major]`
In-PR requirement: a PR touching `skills/`, `tools/`, `dist/`, `brand/` or `.claude-plugin/` carries its own bump; the `plugin` leg's `node tools/version-gate.js --base origin/main` enforces it. Minor for new capability, patch for fixes. A PR touching none of those needs no bump.
Subject constraints: Conventional Commit squash subject scoped by area (`gate`, `author`, `fonts`, `browser`, `skill`, `ci`, `examples`), e.g. `fix(author): ...`. No CHANGELOG; history is the squash subjects.

## PR

Template: .github/pull_request_template.md

## Public surface

The surface is wider than the API. Enumerated, so the small lane's "no public-surface change" key is judged against this list:

- the CLIs `tools/check.js`, `tools/render.js`, `tools/revise.js`: flags (`tools/cli-flags.js` is the inventory) and `--json` output shapes
- the author API exported for programmatic use
- gate rules and problem codes (`skills/excalidraw-diagram/reference/problem-codes.md`)
- the shipped skill `skills/excalidraw-diagram/` (SKILL.md and reference/), which ships to plugin users without a checkout
- the palette under `brand/`
- the bundle inputs (`tools/page.js`, `tools/bundle.js`, `tools/fonts.js`) and the committed `dist/`
- `examples/` bands: a command or flag change lands in every band that draws it

## Triage

File as an issue labelled `needs-triage`.

## Docs sync

Targets: README.md, skills/excalidraw-diagram/, CONTEXT.md, examples/ (regenerated, never edited; `git diff examples/` shows whether a change reached a picture)
Agent-facing: skills/excalidraw-diagram/, CLAUDE.md, CONTEXT.md, docs/agents/, .claude/skills/

CLAUDE.md `## Keep docs in sync with code` explains each target.

## Current docs

Sources: context7
Pinned: `@excalidraw/excalidraw` 0.18.1, `playwright-core` 1.62.0, `esbuild` ^0.25

## Cloud lane

PR cap: 3
Bootstrap: None.
