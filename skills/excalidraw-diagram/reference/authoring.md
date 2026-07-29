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
CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT} node docs/diagrams/gen-thing.js
```

```js
const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) throw new Error("run with CLAUDE_PLUGIN_ROOT=<path to aiworx-excalidraw plugin>");
const { authorDiagram } = await import(`${root}/tools/author.js`);

await authorDiagram({
  out: "docs/diagrams/thing.excalidraw",
  build: async ({ measure, wrap, palette, PROSE, CODE }) => {
    // one call, many strings — each returns the real rendered size
    const [title, code] = await measure([
      { text: "the formula pass", fontSize: 28, fontFamily: PROSE },
      { text: "enrich_formulas_openai()", fontSize: 16, fontFamily: CODE },
    ]);

    // wrap to a pixel width and get the height the block will occupy
    const body = await wrap("Long explanatory prose …", 420, { fontSize: 18 });

    const cardHeight = 24 + title.height + 12 + body.height + 24;   // measured, not guessed
    return [ /* skeleton using title.width, body.text, cardHeight */ ];
  },
});
```

`measure` batches: pass every string at once rather than calling per string.
`wrap` measures word widths, fills lines greedily, then measures the finished
block so the caller sizes cards from the width the renderer will produce.

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

Free text wrapped to a width is the one thing no gate can check: `check.js` sees
bound text overflowing its container and elements escaping their frame, but two
siblings that merely sit on top of each other are legal geometry. So wrap to the
distance to the *next drawn thing* — a mock, an icon, a swatch — not to the card's
inner width, and confirm it in the frame render.

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

1. Emit each panel's contents at a known `x`, tracking the lowest `y` reached.
2. Create each frame afterwards with `children`, letting it fit what it contains.

Keep the frames' `x` positions on a fixed pitch wide enough for the widest panel,
and give each frame a `name` that states the claim it lands — the name shows in
the app's frame list and in per-frame renders.

An arrow that crosses from one panel to the next stays **unbound**. A frame's
auto-fit counts anything bound to one of its children as its own, so binding
across a panel boundary stretches both frames over the gap until they overlap —
which `check.js` reports as overlapping frames, not as a binding problem.

## Round-tripping a human-edited file

```js
const { withExcalidraw } = await import(`${process.env.CLAUDE_PLUGIN_ROOT}/tools/browser.js`);

await withExcalidraw(async (ex) => {
  const { elements } = await ex.restore(JSON.parse(readFileSync(file, "utf8")));
  // elements now have refreshed text dimensions and repaired bindings
});
```

`restore` runs with `refreshDimensions` and `repairBindings`, which recomputes
text sizes and reconnects arrows after hand edits. Use it before programmatic
edits to a file a human has touched.
