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

Skip it and the first render or revise says so by name — `MissingDependencyError`
carries the command above rather than a bare module-resolution error. `check.js`
needs no dependencies at all.

Rendering uses your **system Chrome** (no browser download) and finds it for you
on macOS, Windows and Linux. Set `CHROME_PATH` to point at a specific executable
— it takes precedence over anything discovered.

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
   printable ASCII and re-warms whenever an unseen glyph appears. A warm whose
   faces fail to load or apply throws a `FontIntegrityError` and leaves the
   previous warm intact — the next call re-warms from scratch.

## Commands

```bash
npm test                          # layout + gate fixtures + dark theme + failure paths + render/revise CLIs + palette + author API + assets + browser smoke
npm run smoke                     # browser smoke suite alone
npm run bundle                    # rebuild dist/excalidraw-page.js from node_modules
node tools/check.js d.excalidraw  # mechanical gate — exits non-zero listing every defect
node tools/check.js a.excalidraw b.excalidraw --json   # many files at once; --json for hooks and CI
node tools/render.js d.excalidraw # writes d.svg + one PNG per frame, numbered in reading order
node tools/revise.js d.excalidraw # round-trips a hand-edited file: metrics, bindings, gate, file + SVG
```

`check.js` takes any number of files: each is reported, and the exit code is the
worst one seen — 2 if an input could not be read at all, 1 if any file failed the
rules, 0 if every file is clean. `--json` replaces the human output with one
document (`{ ok, files: [{ file, ok, error?, problems, stats }] }`) covering
every file, for pre-commit hooks and CI aggregation; the exit codes are the same
either way. Any argument starting with `-` that is not a known flag is rejected
as a typo rather than read as a file name; a path that really does start with a
dash goes after `--`.

`revise.js` takes `--no-svg` to rewrite the `.excalidraw` alone. It exits 2 on a
bad invocation and 1 on a document the pipeline refuses — unparseable, foreign,
or failing the gate — writing nothing in either case.

`render.js` follows the same two codes: 2 for a bad invocation, 1 for an input it
cannot read, parse, or find any elements in. Both it and `revise.js` print every
refusal as `ErrorName: message` — never a stack trace, whatever fails beneath
them (a stale bundle, no Chrome, an uninstalled checkout).

`render.js` iteration knobs — invalid values are rejected with a `UsageError`:

```bash
node tools/render.js d.excalidraw --frame 3          # re-render just frame 3, skip the band
node tools/render.js d.excalidraw --dark             # export with Excalidraw's dark theme
node tools/render.js d.excalidraw --padding 40       # export padding in px
node tools/render.js d.excalidraw --background "#0d1117"
```

[`examples/example-dark.svg`](examples/example-dark.svg) is the committed `--dark`
render of the example band.

Dark exports are gated, not assumed. Excalidraw's dark theme is one CSS filter
chain on the root `<svg>` — `invert(93%) hue-rotate(180deg)` — so every dark
colour is a pure function of its light one. `tools/palette.js` therefore runs
every contrast check against both themes, and `check.js` scores a diagram's own
colours against both themes on every run — each `low-contrast` problem names
the theme it failed under. The filter is not contrast-preserving: it compresses
some opposing hue pairs, so a pair can clear 4.5:1 light and fail it dark.
`tests/dark.js` pins the maths against Chrome's own filter pipeline.

`npm test` runs on every push via GitHub Actions and writes only to a temporary
directory — verification never touches tracked files.

## Layout

```
.claude-plugin/     plugin + marketplace manifests
skills/excalidraw-diagram/   SKILL.md and reference material
tools/
  author.js         authoring API: measured wrapping, frame binding, images, library splicing, in-process gate, one-session batches, revise round-trip
  layout.js         layout composition: stack/row/column, padded boxes, arrows that own the gap
  check.js          mechanical gate, CLI face of verify.js: exits non-zero listing every defect, both themes scored
  verify.js         the gate's rules: file integrity, geometry (rotation-aware), arrows, contrast, fonts
  geometry.js       one bounds definition shared by the gate and the frame binder
  color.js          colour maths shared by the gate's contrast rule and palette.js, dark-theme filter included
  page.js           browser-side Excalidraw entry (measure, convert, export)
  browser.js        headless-Chromium driver around page.js
  render.js         .excalidraw → SVG + per-frame PNGs; --frame/--dark/--padding/--background knobs
  revise.js         revise round-trip, CLI face of author.js: metrics, bindings, gate, file + SVG in place
  smoke.js          browser smoke suite proving measurement, conversion, export and raster survival
  palette.js        derives brand/palette.json and verifies every contrast claim
  bundle.js         builds the committed dist/ bundle, fonts inlined, stamped with a source fingerprint
  fingerprint.js    content hash tying dist/ to its sources; browser.js refuses a stale bundle
  errors.js         the shared NamedError base every tool error derives from, plus UsageError and DocumentError
tests/              layout units, gate fixtures, failure paths, render + revise CLI, author API suites
dist/               committed browser bundle
brand/              AIWorx palette
examples/           worked generator (gen-example.js) and its committed output
```

## License

MIT. Design methodology is original to this repo.
