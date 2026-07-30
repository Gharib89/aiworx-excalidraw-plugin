# Authoring

## The skeleton format

Describe elements loosely and let `convertToExcalidrawElements` fill the rest —
ids, seeds, versions, roundness, bound-text geometry, arrow bindings, frame
extents. A skeleton element needs only what makes it distinct.

```js
[
  { type: "rectangle", id: "parse", x: 0, y: 0, width: 200, height: 90,
    strokeColor: p.roles.local.stroke, backgroundColor: p.roles.local.fill,
    label: { text: "parse", fontSize: 20, fontFamily: 6 } },

  { type: "rectangle", id: "api", x: 420, y: 0, width: 200, height: 90,
    strokeColor: p.roles.remote.stroke, backgroundColor: p.roles.remote.fill,
    label: { text: "describe()", fontSize: 20, fontFamily: 6 } },

  // start/end bind to elements by id: the arrow keeps its gap and follows edits
  { type: "arrow", x: 210, y: 45, start: { id: "parse" }, end: { id: "api" } },

  // free-floating text needs no container
  { type: "text", x: 0, y: 120, text: "images_scale = 2.0", fontSize: 16, fontFamily: 3 },

  // a frame sizes itself around its children and binds them via frameId
  { type: "frame", children: ["parse", "api"], name: "1 · stages" },
]
```

`label` on a shape produces a bound text element with `containerId` set and the
text sized and centred. A frame listing `children` computes its own extent with
padding, so panel height follows content instead of a guessed constant.

`roundness` is per shape kind: `{ type: 3 }` rounds a rectangle's corners,
`{ type: 2 }` smooths a polyline's. Smoothing is wrong wherever the corner *is*
the content — plot axes become a curve, a reading-order zigzag becomes an S — so
a `line` or multi-point `arrow` that must stay angular needs `roundness: null`.

The app's elbow router does not run in the converter: an arrow given
`elbowed: true` keeps the flag but stays a straight two-point line. An
orthogonal route is therefore written out as explicit `points`, with
`roundness: null` to keep its corners.

## Measuring

A generator never hardcodes the plugin's install path — it differs per machine
and per user, and a band's generator is committed. Load the tools through the
environment instead, and run the script with the variable set (in a skill bash
block `${CLAUDE_PLUGIN_ROOT}` already resolves):

```bash
CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node docs/diagrams/gen-thing.js
```

An install path is also allowed to contain spaces and to start with a Windows
drive letter, so paths cross the URL boundary through `node:url` — `pathToFileURL`
going out to an import specifier, `fileURLToPath(import.meta.url)` coming back to
a filesystem path. `URL.pathname` is not a path: it keeps `%20` for a space and
prefixes `C:` with a slash, and the read fails later, somewhere else.

```js
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) throw new Error("run with CLAUDE_PLUGIN_ROOT=<path to aiworx-excalidraw plugin>");
const { authorDiagram } = await import(pathToFileURL(join(root, "tools/author.js")).href);

await authorDiagram({
  out: "docs/diagrams/thing.excalidraw",
  build: async ({ measure, wrap, palette, PROSE, CODE, row, column, box, arrowBetween }) => {
    // one call, many strings — each returns the real rendered size
    const [title, code] = await measure([
      { text: "the formula pass", fontSize: 28, fontFamily: PROSE },
      { text: "enrich_formulas_openai()", fontSize: 16, fontFamily: CODE },
    ]);

    // wrap to a pixel width and get the height the block will occupy
    const body = await wrap("Long explanatory prose …", 420, { fontSize: 18 });

    return [ /* skeleton or layout groups using the measurements */ ];
  },
});
```

`measure` batches: pass every string at once rather than calling per string.
`wrap` measures word widths, fills lines greedily, then re-measures every line
and repairs any that render wider — a word that alone exceeds the width is
broken mid-word — so the returned block **never exceeds the requested width**.

`authorDiagram` is hardened at the door and at the exit. A build that returns
nothing, a non-array, or an element of an unknown type is rejected with a
`SkeletonError` before any conversion. The finished document then runs through
the same rules as `check.js` **in-process, before the file is written**: a
defective build throws a `GateError` listing every defect and writes nothing.
The output directory is created for you.

## Composing layout

Hand-accumulated pixel offsets (`y + title.height + 28 + body.height + …`)
silently drift as panels gain elements. Compose placement instead
(tools/layout.js, all passed into `build`):

```js
// items are skeletons carrying width/height — measure text first
const card = box(                       // rectangle padded around content
  column([head, bodyText, codeText], { gap: [12, 14] }),
  { padding: 20, id: "cpu", strokeColor: p.roles.local.stroke,
    backgroundColor: p.roles.local.fill, roundness: { type: 3 } },
);
const band = column([titleEl, row([cardA, cardB], { gap: 60 })], { gap: 28 });

// the arrow owns the gap: it leaves cardA 10px out, stops 10px short of cardB,
// with explicit points — the converter does not run the app's elbow router
const link = arrowBetween(cardA, cardB, { standoff: 10, strokeColor: p.grey.stroke });

return [band, link, { type: "frame", children: [/* ids */], name: "1 · claim" }];
```

- `column` / `row` / `stack` place items along one axis: `gap` is a number or a
  per-pair array, `align` is `start | center | end` across the other axis.
  Helpers return a group that places like an element, so rows nest in columns;
  `authorDiagram` flattens groups back into elements.
- `box` sizes a rectangle from its content plus padding and exposes the
  rectangle as `.shape`, so `arrowBetween` can bind boxes directly.
- `arrowBetween` needs *placed* shapes — call it after the stacks that move
  them. Where the two shapes' cross ranges overlap the arrow runs level through
  the overlap's centre. A routed path goes in as `via: [[x, y], …]` waypoints
  (absolute) and keeps its corners with `roundness: null` set for you.
- Malformed input — empty items, a gap array of the wrong length, an item
  without measured width/height — throws a `LayoutError` naming the problem.

Wrapping a code block breaks the snippet, so code is measured and never wrapped
— which inverts the usual sizing: measure the widest code line first and let the
card width follow it, then wrap the prose to what is left.

```js
const widest = Math.max(...(await measure(codeLines.map(
  (text) => ({ text, fontSize: 16, fontFamily: CODE })))).map((m) => m.width));
const CARD_W = Math.ceil((widest + 2 * PAD + 20) / 20) * 20;
```

Labels *on* a drawing collide with it. Regions of a mocked page, cells of a
table, bars of a chart stack with no gap between them, so a label placed above
one lands on its neighbour. Put the labels in a column beside the drawing, one
slot each, and run a dashed leader to the thing each names — and route a leader
that would cross a sibling around it, not through it.

Free text wrapped to the wrong width collides with its neighbours: `check.js`
flags two free texts sitting on each other, but text landing on a drawing is
legal (labels sit on shapes all the time) and only the render shows it. So wrap
to the distance to the *next drawn thing* — a mock, an icon, a swatch — not to
the card's inner width, and confirm it in the frame render.

## Real assets: images and library items

An image element renders from bytes in the document's `files` dictionary, not
from a path — a diagram travels as one file. The `image` helper (in `build`)
reads the bytes, stores them as a data URL keyed by content hash (the same file
placed twice travels once), and returns a placeable skeleton element:

```js
const logo = await image(`${root}/brand/AIWorx_logo.png`, { id: "logo", width: 180 });
// Every supported format sizes itself from its bytes: give width OR height to
// scale proportionally, both to force, neither for intrinsic size. PNG reads its
// own header; .jpg, .gif, .webp and .svg are decoded by the page's browser,
// which is why `image` is async and must be awaited.
```

An unreadable file or unsupported format is an `AssetError` before anything is
written, as are bytes the browser cannot decode and an SVG that states no size
of its own (no width/height, no `viewBox` — give both dimensions for those). The
gate independently rejects any image whose bytes are missing from the files
dictionary.

Community library items — cloud icons, stick figures, UI kits from
[libraries.excalidraw.com](https://libraries.excalidraw.com) — splice in
programmatically (also exported from `tools/author.js` for use outside `build`):

```js
const figure = spliceLibraryItem(`${root}/examples/stick-figure.excalidrawlib`,
  { item: 0, at: [0, 0] });   // item: index or name; at: top-left corner
row([logo, figure], { gap: 56, align: "end" });          // places like any item
frame.children = ["logo", ...figure.ids];                // fresh ids, per splice
```

Every id — element and group — is regenerated per splice, so one item can be
placed twice without collision; bindings and `boundElements` that point outside
the item are dropped rather than left dangling for the gate to reject. The
helper accepts v1 and v2 `.excalidrawlib` files and throws a `LibraryError`
naming what's wrong (unparseable file, no such item). Items containing text
still face the gate: fonts outside the house pair and low-contrast text fail,
by design.

## Why measurement happens in a browser

The Excalidraw library needs a DOM even for `convertToExcalidrawElements`, and
text metrics are only right when a real browser measures them. Two traps the
toolchain already handles, both covered by `tools/smoke.js`:

- `exportToSvg` inlines `@font-face` rules but never registers them with
  `document.fonts`, so every family measures as one fallback face and all
  families measure *identically*.
- Those inlined fonts are subset to the glyphs actually rendered, so a short
  warm-up leaves most characters falling back.

The warm-up covers printable ASCII and re-warms when an unseen glyph appears. New
glyphs — arrows, check marks, box drawing — are therefore safe to use.

## Generator shape for a band

A band's panels have content-driven heights, so build in two passes:

1. Compose each panel's contents with the layout helpers — measured text into
   `column`/`box` cards, cards into a `row` — so heights follow content.
2. Create each frame afterwards with `children`, letting it fit what it contains.

Keep the frames' `x` positions on a fixed pitch wide enough for the widest panel,
and give each frame a `name` that states the claim it lands — the name shows in
the app's frame list and in per-frame renders.

An arrow that crosses from one panel to the next stays **unbound**. A frame's
auto-fit counts anything bound to one of its children as its own, so binding
across a panel boundary stretches both frames over the gap until they overlap —
which `check.js` reports as overlapping frames, not as a binding problem.

## Round-tripping a human-edited file

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/revise.js" docs/diagrams/thing.excalidraw   # [--no-svg]
```

One command re-enters the pipeline: the file is restored with `refreshDimensions`
and `repairBindings` (text metrics recomputed with the real fonts, dangling
arrow bindings dropped), frame membership the geometry no longer supports is
cleared and re-inferred, the human's `appState` is preserved, image bytes no live
element references are pruned from the `files` dictionary, and the same
in-process gate runs before the file — and its refreshed SVG — is rewritten in
place. A file that isn't a parseable Excalidraw document is rejected with a
`DocumentError`; a revision that would fail the gate throws a `GateError`. Both
exit 1 and write nothing; a bad invocation exits 2 with a `UsageError`.

From inside a generator, the same round-trip is one call:

```js
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) throw new Error("run with CLAUDE_PLUGIN_ROOT=<path to aiworx-excalidraw plugin>");
const { reviseDiagram } = await import(pathToFileURL(join(root, "tools/author.js")).href);

await reviseDiagram({ file: "docs/diagrams/thing.excalidraw" });
```
