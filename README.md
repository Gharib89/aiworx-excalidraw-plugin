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
npm install --omit=dev   # playwright-core and elkjs; the render bundle is committed
```

Both load on first use, so skipping this says so by name at the first render or
revise (playwright-core) and at the first `graph` layout (elkjs) —
`MissingDependencyError` carries the command above rather than a bare
module-resolution error. `check.js` needs no dependencies at all.

Rendering uses your **system Chrome** (no browser download) and finds it for you
on macOS, Windows and Linux. Set `CHROME_PATH` to point at a specific executable
— it takes precedence over anything discovered.

### Stay current: enable auto-update once

Claude Code auto-updates only its own first-party marketplaces, so a plugin
installed from `aiworx` stays at the version you installed until you say
otherwise — and a session then loads stale skill text against newer tools. Turn
it on once:

`/plugin` → **Marketplaces** → **aiworx** → **Enable auto-update**

Updates apply on the next start. To move a copy right now instead:

```bash
/plugin marketplace update aiworx
/plugin update aiworx-excalidraw
```

CI keeps the version honest from the other side: `tools/version-gate.js` refuses
a pull request that changes what an install loads — anything under `skills/`,
`tools/`, `dist/`, `brand/` or `.claude-plugin/` — without a strictly greater
version in `.claude-plugin/plugin.json` and `package.json`. `node
tools/bump-version.js [patch|minor|major]` moves both, plus the lockfile.

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

A generator can start from mermaid rather than from scratch: `fromMermaid` parses
a mermaid flowchart with the official converter and returns house-built nodes and
edges for `graph` to lay out. The converter's own positions, colours and text
metrics are discarded — they are computed with the metrics this pipeline exists
to replace — so an ingested diagram is measured, laid out, palette-styled and
gated like any other.

## Commands

```bash
npm test                          # everything: npm run test:fast, then npm run test:browser
npm run test:fast                 # ~12s, no Chrome: layout + wrap + gate fixtures + dark theme + library index + palette
npm run test:browser              # the rest, suites run in parallel: failure paths, render/revise CLIs, author API, assets, browser smoke
npm run test:os                   # what the macOS/Windows CI legs run: test:fast + the Chrome-discovery and path-handling suites
npm run smoke                     # browser smoke suite alone
npm run bundle                    # rebuild dist/ (bundle + loader page) from node_modules
node tools/check.js d.excalidraw  # mechanical gate — exits non-zero listing every defect
node tools/check.js a.excalidraw b.excalidraw --json   # many files at once; --json for hooks and CI
node tools/check.js d.excalidraw --preset slide-16x9   # score the advisories against the surface it was authored for
node tools/render.js d.excalidraw # writes d.svg + one PNG per frame, numbered in reading order
node tools/revise.js d.excalidraw # round-trips a hand-edited file: metrics, bindings, gate, file + SVG, ledger
node tools/library.js aws         # search the community icon libraries; --json for the machine-readable form
node tools/library.js --download childishgirl/aws-architecture-icons.excalidrawlib   # prints the cached path
node tools/bump-version.js minor  # moves plugin.json + package.json + lockfile together
node tools/version-gate.js --base origin/main   # what CI asks: did plugin content change without a bump?
```

`check.js` takes any number of files: each is reported, and the exit code is the
worst one seen — 2 if an input could not be read at all, 1 if any file failed the
rules, 0 if every file is clean. `--json` replaces the human output with one
document (`{ ok, files: [{ file, ok, error?, problems, advisories, stats }] }`)
covering every file, for pre-commit hooks and CI aggregation; the exit codes are
the same either way. Every problem code, with its `elements` order and per-code
fields, is listed in `skills/excalidraw-diagram/reference/problem-codes.md` — the
vocabulary is append-only and `tests/problem-codes.js` fails when a rule lands
without publishing its code.

Beside the problems, every file that reaches the rules carries its
**advisories** (`tools/advise.js`): measurements against the house rules —
arrow–arrow crossings, aspect against the preset, arrow clearance, bends, font
floors, stroke weight, hue count, `pass`/`fail` by hue alone, panel width drift
across a band — reported on stdout after the stats line and never refused over,
so the exit code never reads them. A quantity finding carries the value it
measured and the bound it was judged against; a presence finding (a crossing, a
`pass`/`fail` told apart by hue alone, an arrow thinner than its shape) names
the elements involved. `--preset <name>` names the surface the diagram was
authored for; nothing in a written scene records it, so without the flag the
aspect and font-floor measurements stay silent. The same measurement scores the
benchmark corpus: `tests/advisories-baseline.js` pins `check.js --json` over
`bench/runs/<version>/` as a snapshot, so a retuned threshold shows as a diff.

`revise.js` takes `--no-svg` to rewrite the `.excalidraw` alone. It exits 2 on a
bad invocation and 1 on a document the pipeline refuses — unparseable, foreign,
or failing the gate — writing nothing in either case.

Every successful pass ends with its **fidelity ledger**: what the round-trip
recomputed, repaired or dropped that you did not ask for — remeasured text,
repaired bindings and frame membership, bound labels re-centered onto their
arrows (a hand-moved one snaps back by design), purged elements, and image
payloads nothing references any more, with the bytes they cost. All of it used to
happen in silence, which read as a no-op; a pass that genuinely changed nothing
now says so in one line. `--json` prints the same ledger as one document
(`{ file, svg, elements, frames, changed, entries }`) instead of prose — a
refusal prints no ledger, since there was no rewrite to account for. The ledger
codes share the append-only contract and the entry shape of the gate's problem
codes and are listed beside them in
`skills/excalidraw-diagram/reference/problem-codes.md`.

`render.js` follows the same two codes: 2 for a bad invocation, 1 for an input it
cannot read, parse, or find any elements in. Both it and `revise.js` print every
refusal as `ErrorName: message` — never a stack trace, whatever fails beneath
them (a stale bundle, no Chrome, an uninstalled checkout).

`library.js` is discovery in front of the authoring API's `spliceLibraryItem`,
which stays the only way an item enters a diagram. A search matches the query,
case-insensitively, against a library's name, its item names and its description —
the published index carries no tags — and ranks a name match above the rest. Each
hit prints its `source` handle, which is what `--download` takes; `--download`
prints the resolved absolute path of the cached `.excalidrawlib`, and that path is
what the splice reads.

The index is cached for a week under `$XDG_CACHE_HOME/aiworx-excalidraw/libraries/`
(`EXCALIDRAW_LIBRARY_CACHE` overrides the location outright), and so is every
library downloaded, so authoring stays offline after the first fetch — the same
no-CDN discipline the vendored fonts follow. `--refresh` re-fetches in either
mode. `--stale` belongs to a search alone — it accepts an index older than a week
when the network cannot refresh it, which otherwise refuses rather than serving
month-old data in silence; passing it with `--download`, which reads no index, is
refused rather than ignored. A search that matches nothing is an answer, not a
failure, and exits 0.

Note that real community libraries label their items in Excalidraw's own faces,
which are outside the house pair, so a diagram that splices one by default is
refused by the gate with `foreign-font`. Splice it with `text: "drop"` and the
item's own labels stay out, leaving the pictogram for you to label with measured
house-pair text.

All four CLIs share one argument vocabulary. Any argument starting with `-` that
is not a known flag is rejected as a typo (exit 2, naming the argument) rather
than read as a file name — `-dark` is not `--dark`. Without that guard a mistyped
flag becomes a bogus file path, or, when a real file is named alongside it, is
silently dropped and you get the wrong output with no diagnostic. A value flag
will not swallow one either: `--out -dark` is a flag left without a value, not a
directory named `-dark`. `--` ends the flags, which is how a path that really does
start with a dash stays reachable.

The two exit-code conventions differ deliberately. `check.js` reports the worst
code across every file it was given, so "a file could not be read" (2) has to
outrank "a file failed the rules" (1) — otherwise one unreadable file in a batch
would hide behind another file's rule failure. The single-file CLIs have nothing
to mask: an unreadable document is a refusal like any other (1), and 2 stays
reserved for an invocation that never named a file to work on.

`render.js` iteration knobs — invalid values are rejected with a `UsageError`:

```bash
node tools/render.js d.excalidraw --frame 3          # re-render just frame 3, skip the band
node tools/render.js d.excalidraw --dark             # export with Excalidraw's dark theme
node tools/render.js d.excalidraw --padding 40       # export padding in px
node tools/render.js d.excalidraw --background "#0d1117"
node tools/render.js d.excalidraw --preset slide-16x9  # frame every export to 16:9
```

`--preset` grows the canvas around the picture until it matches the named
surface's aspect ratio, centring the content. It never scales anything: the type
size belongs to the preset the diagram was *authored* with (`preset:` on
`authorDiagram`, which sets the font sizes before the text is measured, so the
cards grow with it), and rescaling the finished export would undo exactly that.
The names are shared by all three — `preset:` on `authorDiagram`, `render.js
--preset`, and `check.js --preset`, which scores the advisories against the
surface — `fit` (the default, no target surface), `doc-inline`, `doc-wide`,
`slide-16x9`, `social-og`.

[`examples/example-dark.svg`](examples/example-dark.svg) is the committed `--dark`
render of the example band.

The palette itself is overridable per project: a strokes-only
`.excalidraw-brand.json` at a consumer project's root (discovered by walking up
from the working directory) re-colours every role. Fills and grey are derived
from it by the same OKLCH rule the house palette uses and verified against the
same contrast claims on every read; an override that fails them refuses the run
(`invalid-brand-override`) instead of silently falling back to house colours.
`node tools/palette.js <file>` preflights a candidate override. Fonts stay the
house pair — they sit under bundle discipline.

Nothing adopts a brand silently either way: the skill's first step checks for the
file and, when a project has none, asks once whether to onboard a brand (from a
URL, from local token files, or from pasted hexes) or keep the house colours.
Either answer writes `.excalidraw-brand.json` — the declined one as
`{ "defaults": "accepted" }` — so the file's existence is the whole record and
the question is asked once per project, not once per session.

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
  author.js         authoring API: measured wrapping, frame binding, images, library splicing, diagram-level finish register and output preset, in-process gate, one-session batches, revise round-trip
  layout.js         layout composition: stack/row/column, padded boxes, one uniform width across a set, arrows that own the gap, fans that spread their landings, graphs laid out in layers by ELK and routed on the paths it returns (anchored on geometry.js bounds)
  mermaid.js        mermaid flowchart ingestion: the official converter's parse tree, rebuilt as house nodes and edges for layout.js's graph()
  check.js          mechanical gate, CLI face of verify.js: exits non-zero listing every defect, both themes scored
  verify.js         the gate's rules: file integrity, geometry (rotation-aware), arrows, contrast, fonts
  geometry.js       one bounds definition shared by the gate, the frame binder and arrow anchoring
  color.js          colour maths shared by the gate's contrast rule and palette.js, dark-theme filter included
  page.js           browser-side Excalidraw entry (measure, convert, export, parse mermaid)
  browser.js        headless-Chromium driver around page.js; Chrome loads the bundle off disk via dist/index.html
  render.js         .excalidraw → SVG + per-frame PNGs; --frame/--dark/--padding/--background/--preset knobs
  presets.js        the output presets: each name's target surface and its type ramp, shared by author.js and render.js
  revise.js         revise round-trip, CLI face of author.js: metrics, bindings, gate, file + SVG in place, fidelity ledger
  library.js        find and download a community icon library, CLI face of library-index.js
  library-index.js  the libraries.excalidraw.com index: fetch, week-long disk cache, search by name/item/description, download
  smoke.js          browser smoke suite proving measurement, conversion, export and raster survival
  palette.js        derives brand/palette.json and verifies every contrast claim; preflights a brand override file
  brand.js          brand override: discovers .excalidraw-brand.json up from cwd, derives the full palette from its
                    strokes, verifies it, refuses invalid ones — the one palette path every consumer loads through
  bundle.js         builds the committed dist/ bundle, its loader page and its vendored fonts, stamped with a source fingerprint
  fonts.js          the Excalidraw font families dist/ vendors, so nothing is fetched at render time
  fingerprint.js    content hash tying dist/ to its sources; browser.js refuses a stale bundle
  plugin-version.js which paths reach an install, and whether the version moved — the version gate's decision logic
  version-gate.js   CLI face of plugin-version.js: reads the two refs out of git, refuses an unbumped content change
  bump-version.js   moves the version in plugin.json, package.json and the lockfile together
  document.js       one .excalidraw loader shared by check, render and revise: read, parse, shape-check, DocumentError with a machine kind
  errors.js         the shared NamedError base every tool error derives from, plus UsageError, DocumentError and BrandOverrideError
                    every error states what failed, where, and the one next action: "where: what — next action"
tests/              geometry + verifyDocument units, layout units, gate fixtures, failure paths, render + revise CLI, author API suites
dist/               committed browser bundle, the loader page Chrome navigates to, and fonts/ — the vendored woff2 files
                    Excalidraw would otherwise fetch from a CDN, so measuring and rendering work offline
brand/              AIWorx palette
examples/           worked generator (gen-example.js) and its committed output
```

## License

MIT. Design methodology is original to this repo.
