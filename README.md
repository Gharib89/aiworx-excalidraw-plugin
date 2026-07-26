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
   rules but never adds them to `document.fonts`, so every family measures as the
   serif fallback and all families measure *identically*. Layout computed that way
   overflows the moment the real font renders.
2. **Embedded fonts are subset to the rendered glyphs.** Warming with a short
   sample leaves most characters still falling back. The warm-up therefore covers
   printable ASCII and re-warms whenever an unseen glyph appears.

## Commands

```bash
npm run bundle    # rebuild dist/excalidraw-page.js from node_modules
node tools/smoke.js               # verification gate — 18 checks, exits non-zero on failure
node tools/render.js d.excalidraw # writes d.svg + one PNG per frame
```

## Layout

```
.claude-plugin/     plugin + marketplace manifests
skills/excalidraw-diagram/   SKILL.md and reference material
tools/              page.js (browser side), browser.js (driver), render.js, smoke.js, bundle.js
dist/               committed browser bundle
brand/              AIWorx palette
```

## License

MIT. Design methodology is original to this repo.
