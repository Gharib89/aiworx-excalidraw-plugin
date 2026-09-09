# Coding standards

The standards every change in this repo is reviewed against. The `code-review` skill's Standards axis and every automated reviewer read this file; the ship profile names it under `## Coding standards`.

## Enforced by tooling

- No linter, formatter or type checker: the test suite, the clean-tree check and bundle reproducibility are the whole CI gate (`.github/workflows/ci.yml`).
- `tests/test-targets.js`: every suite under `tests/` is wired into exactly one of `test:fast` or `test:browser`, and `test` is exactly `test:fast && test:browser`.
- `tests/drawn-commands.js` and `tests/band-bytes.js`: every committed example band draws the CLIs' real flag inventory and regenerates byte-identical.
- `tools/version-gate.js` (CI `plugin` leg): a PR touching `skills/`, `tools/`, `dist/`, `brand/` or `.claude-plugin/` carries a version bump.
- `tools/fingerprint.js`: `dist/excalidraw-page.js` is stamped with the hash of its inputs; `tools/browser.js` refuses a stale bundle.
- `claude plugin validate . --strict` (CI `plugin` leg) against a pinned CLI.

## Written standards

- `CLAUDE.md` intro: plain Node >= 18 ESM, no build step for consumers, system Chrome.
- `CLAUDE.md` `## Bundle discipline`: what counts as a bundle input and the same-change rebuild rule.
- `CLAUDE.md` `## Keep docs in sync with code`: the artifacts coupled to a change and which are written for an agent.
- `CLAUDE.md` `## Release`: the version ships with the change; squash subjects are Conventional Commits scoped by area.
- `CONTEXT.md`: the ubiquitous language, including derived element identity.

## Conventions a reviewer should know

- Suites are plain Node scripts, `tests/<area>.js`, run directly with `node`; a per-OS claim also goes into `test:os`.
- `test:fast` stays Chrome-free: importing `tools/browser.js` is fine, a successful launch is not.
- Dependencies are pinned; a reviewer nit against a newer API is checked against the installed version first.
