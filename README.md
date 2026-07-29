# AIWorx Excalidraw plugin

A Claude Code plugin for authoring `.excalidraw` diagrams that teach — with **real
text metrics** and a **headless render-and-inspect loop**, so layout defects are
caught by looking at the picture rather than guessed at from JSON.

## Install

```bash
/plugin marketplace add gharib89/aiworx-excalidraw-plugin
/plugin install aiworx-excalidraw@aiworx
/reload-plugins
```

Then, once per installation:

```bash
npm install --omit=dev   # playwright-core only; the render bundle is committed
```

Rendering uses your **system Chrome** (no browser download). Set `CHROME_PATH` if
it isn't at one of the usual locations.

## Why this exists

Generating Excalidraw JSON by hand or from a script means guessing how wide text
will be. Guess wrong and text overflows its container — visible only after
rendering. This plugin measures text with the Excalidraw library itself, inside a
real browser, and lays out from those measurements.

Two traps it handles, both verified in `tools/smoke.js`:

1. **Fonts are not registered on import.** `exportToSvg` inlines `@font-face`
   rules but never adds them to `document.fonts`, so every family measures as one
   fallback face and all families measure *identically*. Layout computed that way
   overflows the moment the real font renders.
2. **Embedded fonts are subset to the rendered glyphs.** Warming with a short
   sample leaves most characters still falling back. The warm-up therefore covers
   printable ASCII and re-warms whenever an unseen glyph appears.

## Commands

```bash
npm test                          # gate fixtures + palette checks + browser smoke suite
npm run smoke                     # browser smoke suite alone
npm run bundle                    # rebuild dist/excalidraw-page.js from node_modules
node tools/check.js d.excalidraw  # geometry gate — exits non-zero listing every defect
node tools/render.js d.excalidraw # writes d.svg + one PNG per frame
```

`npm test` runs on every push via GitHub Actions and writes only to a temporary
directory — verification never touches tracked files.

## Layout

```
.claude-plugin/     plugin + marketplace manifests
skills/excalidraw-diagram/   SKILL.md and reference material
tools/
  author.js         authoring API: measured wrapping, frame binding, build-and-write
  check.js          geometry gate: duplicate ids, frame overlap/escape, text overflow, dead bindings
  page.js           browser-side Excalidraw entry (measure, convert, export)
  browser.js        headless-Chromium driver around page.js
  render.js         .excalidraw → SVG + per-frame PNGs
  smoke.js          browser smoke suite proving measurement, conversion and export
  palette.js        derives brand/palette.json and verifies every contrast claim
  bundle.js         builds the committed dist/ bundle, fonts inlined
tests/              gate fixture suite: planted-defect files + tests/gate.js runner
dist/               committed browser bundle
brand/              AIWorx palette
examples/           worked generator (gen-example.js) and its committed output
```

## License

MIT. Design methodology is original to this repo.
