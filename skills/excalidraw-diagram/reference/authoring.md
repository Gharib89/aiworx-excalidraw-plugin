# Authoring

## The build context

`build` receives one object holding everything a generator needs — measurement,
the palette, the layout helpers, the asset helpers. Destructure the members you
use. This table is the whole surface; the sections below detail each one.

| member | call | gives back | detail |
|---|---|---|---|
| `measure` | `await measure([{ text, fontSize, fontFamily }, …])` | one `{ width, height }` per item, at the real rendered size | [Measuring](#measuring) |
| `wrap` | `await wrap(text, maxWidth, { fontSize, fontFamily })` | `{ text, width, height, lines }`, never wider than `maxWidth` | [Measuring](#measuring) |
| `palette` | constant | the brand palette: `roles`, `grey`, `ink`, `canvas`, `fontFamily` | [palette.md](palette.md) |
| `PROSE` | constant | the `fontFamily` of the house prose face | [palette.md](palette.md) |
| `CODE` | constant | the `fontFamily` of the house code face | [palette.md](palette.md) |
| `stack` | `stack(items, { direction, gap, align, x, y })` | a group placing its items along one axis | [Composing layout](#composing-layout) |
| `column` | `column(items, opts)` | `stack` fixed to `direction: "column"` | [Composing layout](#composing-layout) |
| `row` | `row(items, opts)` | `stack` fixed to `direction: "row"` | [Composing layout](#composing-layout) |
| `box` | `box(child, { padding, ...shapeProps })` | a group exposing its sized rectangle as `.shape` | [Composing layout](#composing-layout) |
| `arrowBetween` | `arrowBetween(a, b, { standoff, route, via, label, ...style })` | a deferred arrow spanning both shapes, placed once every mover has run | [Composing layout](#composing-layout) |
| `flatten` | `flatten(nodes)` | the elements inside nested groups, unrolled flat | [Composing layout](#composing-layout) |
| `image` | `await image(path, { width, height, ...props })` | an image element; the bytes land in the document's `files` | [Real assets](#real-assets-images-and-library-items) |
| `spliceLibraryItem` | `spliceLibraryItem(path, { item, at })` | a group whose `.ids` are the item's fresh element ids | [Real assets](#real-assets-images-and-library-items) |

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
`roundness: null` to keep its corners — which is what
`arrowBetween(a, b, { route: "orthogonal" })` computes for you.

Authored ids survive to the written file — the converter runs with
`regenerateIds: false` — so a gate error names the generator's own ids and
traces straight back to code. What the converter would silently mangle is a
`SkeletonError` at the door instead: a reused id, an arrow carrying
`startBinding`/`endBinding`/`fixedPoint` (bind with `start: { id }` /
`end: { id }`), an arrow whose `start`/`end` is an inline id-less shape the
converter cannot bind. Arrows bound to images and frames do work: the converter
alone crashes on those targets, so the pipeline lifts the bindings out and
stitches them back onto the converted elements.

## Measuring

A generator never hardcodes the plugin's install path — it differs per machine
and per user, and a band's generator is committed. Pass the path in at the
invocation instead, as the script's first argument (in a skill bash block
`${CLAUDE_PLUGIN_ROOT}` already resolves to it):

```bash
node docs/diagrams/gen-thing.js "${CLAUDE_PLUGIN_ROOT}"
CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node docs/diagrams/gen-thing.js   # equivalent
```

Reach for the argument form: it survives a Bash permission allowlist, because
after substitution the command line starts with `node`, which a `Bash(node:*)`
rule admits, while an environment-variable prefix reads as a compound command
and is denied — as is every `export` or `$VAR` workaround. The environment form
stays documented so an already-committed generator keeps running unchanged.
Supply one or the other: a generator reads `CLAUDE_PLUGIN_ROOT` first and the
argument only when that is unset, so a stale variable beats a good argument.

An install path is also allowed to contain spaces and to start with a Windows
drive letter, so paths cross the URL boundary through `node:url` — `pathToFileURL`
going out to an import specifier, `fileURLToPath(import.meta.url)` coming back to
a filesystem path. `URL.pathname` is not a path: it keeps `%20` for a space and
prefixes `C:` with a slash, and the read fails later, somewhere else.

```js
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT ?? process.argv[2];
if (!root) throw new Error("gen-thing.js: no plugin root — run `node docs/diagrams/gen-thing.js <path to aiworx-excalidraw plugin>`, or set CLAUDE_PLUGIN_ROOT to it");
const { authorDiagram } = await import(pathToFileURL(join(root, "tools/author.js")).href);

await authorDiagram({
  out: "docs/diagrams/thing.excalidraw",
  build: async ({ measure, wrap, palette, PROSE, CODE, row, column, box, arrowBetween, flatten }) => {
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

## The finish register

Finish is chosen once per diagram, not per element. `register:` sets it once and
it reaches every element it governs:

```js
await authorDiagram({
  out: "docs/diagrams/thing.excalidraw",
  register: { roughness: 1, fillStyle: "solid", strokeWidth: 2 },
  build: async (ctx) => [ /* … */ ],
});
```

| property | governs | accepts |
|---|---|---|
| `roughness` | rectangle, ellipse, diamond, arrow, line, freedraw | `0`, `1`, `2` |
| `strokeStyle` | the same | `"solid"`, `"dashed"`, `"dotted"` |
| `strokeWidth` | the same | any positive number |
| `fillStyle` | rectangle, ellipse, diamond, line | `"solid"`, `"hachure"`, `"cross-hatch"` |
| `startArrowhead` | arrow | `null`, `"arrow"`, `"triangle"`, `"diamond"`, `"circle"`, `"bar"` |
| `endArrowhead` | arrow | the same |

See [patterns.md](patterns.md) for what each value *means* — the register is the
mechanism, that file is the vocabulary.

Three things to know:

- **The register is a default, not a law.** An element that sets the property
  itself keeps its own value, which is how a deliberate break stays sayable —
  `roughness: 0` on the one panel carrying real numbers, `endArrowhead: null` on
  a plain connector in a flow of arrows. Setting it to `null` or `0` counts as
  setting it; only an absent property is filled. Elements from
  `spliceLibraryItem` carry their author's finish as their own properties, so a
  spliced item keeps the look it was drawn with — strip the property to hand it
  to the register.
- **It governs only what it lists.** Text, frames and images are untouched by
  the stroke properties, and arrowheads only ever reach arrows.
- **A typo is an error, not a no-op.** An unknown property or an
  out-of-vocabulary value throws a `SkeletonError` naming the property, the
  value and the accepted set, before any browser work — `register: { stroke_width: 2 }`
  fails loudly rather than silently changing nothing.

Omit `register` and every element keeps whatever it set for itself, exactly as
before. `withAuthoring`'s `author()` takes it too, per diagram — a band whose
panels share one finish passes the same register to each.

## Many diagrams in one run

Each `authorDiagram` call launches and closes its own headless browser (~1–2 s).
A generator writing several diagrams — a band split into files, a set of panels —
wraps them in one session instead:

```js
const { withAuthoring } = await import(pathToFileURL(join(root, "tools/author.js")).href);

await withAuthoring(async (author) => {
  for (const panel of panels) {
    await author({ out: `docs/diagrams/${panel.slug}.excalidraw`, build: panel.build });
  }
});
```

`author` takes exactly the options `authorDiagram` takes and returns the same
result. Every diagram is still gated before its own write, so a `GateError`
names one diagram and the session stays usable for the rest — catch it inside the
callback to keep going. Font warming accumulates across the session: a glyph that
first appears in the last diagram re-warms the page, and everything measured
before it still measures the same. Use `authorDiagram` for a single diagram; it
is the same code path with the session opened for you.

`Promise.all(panels.map(...))` is safe but buys nothing: the diagrams are queued
and run one at a time, because the page's font warming is only correct with a
single call in flight — concurrent warms leave a measurement on the fallback
face, which is the drift the measuring exists to avoid. The saving is the launch,
not parallelism.

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

// the arrow owns the gap: it leaves cardA 10px out, stops 10px short of cardB.
// add route: "orthogonal" for an elbow instead of a diagonal.
const link = arrowBetween(cardA, cardB, { standoff: 10, strokeColor: p.grey.stroke });

return [band, link, { type: "frame", children: [/* ids */], name: "1 · claim" }];
```

- `column` / `row` / `stack` place items along one axis: `gap` is a number or a
  per-pair array, `align` is `start | center | end` across the other axis.
  Helpers return a group that places like an element, so rows nest in columns;
  `authorDiagram` flattens groups back into elements.
- `box` sizes a rectangle from its content plus padding and exposes the
  rectangle as `.shape`, so `arrowBetween` can bind boxes directly.
- `flatten` unrolls nested groups back into their elements. A frame's
  `children` wants flat element ids, so list them with
  `flatten(band).map((el) => el.id)` instead of re-walking the group by hand —
  and give every element the frame should own an id, because an id-less
  element cannot be claimed.
- `arrowBetween` returns a **deferred arrow**: it holds both shapes by reference
  and takes its path from a resolve pass `authorDiagram` runs after your build
  returns, so a `row` that shifts either shape later still finds the arrow
  waiting. Write it wherever it reads best — before, between or after the movers,
  all three give one answer. The arrow carries its id, bindings, label and style
  from the moment you write it, so a frame can list it in `children` and the
  finish register reaches it as usual. Its size arrives with its path, so return
  an arrow beside a group rather than as an item inside one — `column`/`row`
  place by size, and a deferred arrow has none yet.
  Where the two shapes' cross ranges overlap
  the arrow runs level through the overlap's centre. A hand-written path goes in
  as `via: [[x, y], …]` waypoints and keeps its corners with `roundness: null`
  set for you — those coordinates are **absolute** and yours, the one part the
  resolve pass takes as given, so write them after the last mover or recompute
  them from the shapes' final positions.
- Options are checked where you wrote them: an unknown `route`, `route` with
  `via`, a label with no text, a non-numeric `standoff`, an unbindable group —
  each is a `LayoutError` from the call itself. What needs the finished
  coordinates waits for the resolve pass and names the arrow's id when it
  refuses, so give an arrow an `id` and the refusal traces straight back to the
  line that wrote it.
- `route: "orthogonal"` computes that path instead of asking you to write it:
  the arrow leaves the source level, jogs once across the middle of the gap, and
  arrives level at the target — axis-aligned throughout, corners kept. Where the
  run is already level there is no slope to remove, so the route adds no
  waypoint and the arrow stays the straight two-point line it already was.

  The **wider** of the two separations picks the axis, the same rule the direct
  arrow already follows: shapes further apart horizontally than vertically leave
  and arrive sideways and jog vertically at the mid-line; the taller-apart pair
  does the opposite. So the way to control an elbow's shape is the placement, not
  a flag.

  ```js
  arrowBetween(cardA, cardB, { standoff: 10, route: "orthogonal" });
  ```

  The elbow always turns inside the gap, so it cannot cross either shape it
  connects. It does **not** avoid anything *else*: a third shape parked in that
  gap is still crossed, exactly as a direct arrow would cross it, and the gate's
  `arrow-crossing` still refuses it — move the shape or write the path with
  `via`. `route` and `via` together are a `LayoutError`, and `"orthogonal"` is
  the only route there is.
- `arrowBetween` anchors on the same rotation-aware bounds the gate uses, so an
  arrow to a shape carrying an `angle` reaches its *turned* extent rather than
  the upright box it was authored in. Those bounds are the rotated *bounding
  box*, so at a right angle the arrow meets the edge, while at an oblique one it
  stops on the box a little clear of the slanted edge — check the render when a
  diagram leans on rotated shapes.
- `box` refuses an `angle`: it places its content by translation alone, so a
  rotation would turn the rectangle and leave the content upright and clear of
  it. Passing a non-zero (or non-finite) `angle` is a `LayoutError`; `angle: 0`
  is the no-op default and still passes. To rotate a labelled shape, put the
  text *on* the shape instead — a rectangle carrying both `angle` and
  `label: { text }` — because the converter rotates bound text with its
  container:

  ```js
  { type: "rectangle", id: "turned", x: 0, y: 0, width: 160, height: 60,
    angle: Math.PI / 4, strokeColor: p.roles.local.stroke,
    label: { text: "rotated", fontFamily: 6, strokeColor: p.grey.stroke } }
  ```
- An arrow binds to a real element, so each end must be one. A `box` works
  because it exposes its rectangle — but only if that rectangle has an `id`. A
  plain `column`/`row` group exposes no element at all, so passing one is a
  `LayoutError`: an unbound arrow would pass the gate and then come loose from
  the shape on the first edit in the app. Give the box an `id`, or wrap the
  column in one:

  ```js
  const card = box(column([head, body], { gap: 12 }), { padding: 20, id: "card" });
  arrowBetween(other, card, { standoff: 10 });   // binds through card.shape.id
  ```
- `label` annotates the edge: `arrowBetween(a, b, { label: "writes" })` binds
  measured text to the arrow at 16px in the house prose font. Pass an object —
  `{ label: { text: "12 ms", fontSize: 20, fontFamily: CODE } }` — to override.
  The label is centred on the path and drawn over whatever is behind it, so a
  label wider than a short arrow is normal; the gate does not treat that as
  overflow (a shape clips its text, a line does not), which means a label
  running close to a neighbour is a thing to check in the render.
  A label inherits the arrow's `strokeColor` and is scored as text on whatever
  lies behind it — in both themes, every run — so a role-coloured arrow (pass
  green, decision gold) usually fails 4.5:1 through its own label. Give the
  label ink of its own: `{ label: { text: "writes", strokeColor: palette.ink } }`.
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
naming what's wrong (unparseable file, no such item, an item holding nothing but
deleted elements). Items containing text
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

A band's panels have content-driven widths and heights, so every panel reaches
its final coordinates only once the whole band is placed. Build in two passes:

1. **Compose** each panel whole, at its own local origin — measured text into
   `column`/`box` cards, cards into a `row`, `arrowBetween` across them, a frame
   listing their ids. Arrows are deferred and a frame fits its `children` at
   conversion, so both settle on the coordinates the panel ends up with.
2. **Place** every body with one band-level `row`, which sets the pitch from the
   real widths. This is the **last mover**: it shifts every element inside every
   panel.

What the last mover still binds is anything you compute coordinates for by hand:
`via` waypoints, a frame you size yourself instead of listing `children`, and the
cross-panel connector below. Write those after the row, from the placed bodies'
own `x`/`y`/`width`/`height`:

```js
const text = async (t, o = {}) => {
  const [m] = await measure([{ text: t, fontSize: 16, fontFamily: PROSE, ...o }]);
  return { type: "text", text: t, width: m.width, height: m.height,
           fontSize: 16, fontFamily: PROSE, strokeColor: p.ink, ...o };
};

// 1 · compose — every panel whole, at its own local origin
const panels = [];
const extras = [];
for (const [i, s] of specs.entries()) {
  const head = await text(s.head, { id: `p${i}-head`, fontSize: 20 });
  const from = box(await text(s.from, { id: `p${i}-from-t` }),
    { padding: 16, id: `p${i}-from`, strokeColor: p.roles.local.stroke,
      backgroundColor: p.roles.local.fill, roundness: { type: 3 } });
  const to = box(await text(s.to, { id: `p${i}-to-t` }),
    { padding: 16, id: `p${i}-to`, strokeColor: p.roles.artifact.stroke,
      backgroundColor: p.roles.artifact.fill, roundness: { type: 3 } });
  const body = column([head, row([from, to], { gap: 80, align: "center" })], { gap: 24 });
  // give the arrow an id, so the frame can claim it and a refusal names it
  extras.push(arrowBetween(from, to, { standoff: 10, id: `p${i}-arr`,
    strokeColor: p.grey.stroke, endArrowhead: "triangle" }));
  panels.push({ body, name: s.name,
    frame: { type: "frame", name: s.name,
             children: [...flatten(body).map((el) => el.id), `p${i}-arr`] } });
}

// 2 · place — the last mover, one row across the whole band
row(panels.map((pl) => pl.body), { gap: 200, align: "start" });

// a panel-to-panel connector is hand-placed, so it comes after the last mover
panels.slice(1).forEach(({ body: right }, i) => {
  const left = panels[i].body;
  const x = left.x + left.width + 60;                   // 60px clear of each body
  const span = right.x - 60 - x;                        // so keep the band gap above 120
  // panels are top-aligned, so run the connector through the centre they share
  const y = (Math.max(left.y, right.y) + Math.min(left.y + left.height, right.y + right.height)) / 2;
  extras.push({ type: "arrow", id: `cross-${i}`, roundness: null,
    x, y, width: span, height: 0, points: [[0, 0], [span, 0]],
    strokeColor: p.grey.stroke, endArrowhead: "triangle" });
});

return [...panels.map((pl) => pl.body), ...extras, ...panels.map((pl) => pl.frame)];
```

Give each frame a `name` that states the claim it lands — the name shows in the
app's frame list and in per-frame renders. Inset the cross-panel connector far
enough to clear both frames' fitted extents — a frame fits about 10px outside
its children, so clear the bodies by more than that. A connector reaching into a
frame it does not belong to is `unbound-over-frame`.

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

Every error these tools throw reads **what / where / next** — composed as
`where: what — next`, with *where* the file, the element id, or the call at
fault, and *next* a single command or instruction. So the message alone is
enough to retry: read its trailing clause and do exactly that.

From inside a generator, the same round-trip is one call:

```js
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT ?? process.argv[2];   // guarded as in Measuring
const { reviseDiagram } = await import(pathToFileURL(join(root, "tools/author.js")).href);

await reviseDiagram({ file: "docs/diagrams/thing.excalidraw" });
```
