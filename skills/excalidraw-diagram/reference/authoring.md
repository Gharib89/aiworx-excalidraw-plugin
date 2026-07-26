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

## Measuring

```js
import { authorDiagram } from "<plugin>/tools/author.js";

await authorDiagram({
  out: "docs/diagrams/thing.excalidraw",
  build: async ({ measure, wrap, palette, mark, PROSE, CODE }) => {
    // one call, many strings — each returns the real rendered size
    const [title, code] = await measure([
      { text: "the formula pass", fontSize: 28, fontFamily: PROSE },
      { text: "enrich_formulas_openai()", fontSize: 16, fontFamily: CODE },
    ]);

    // wrap to a pixel width and get the height the block will occupy
    const body = await wrap("Long explanatory prose …", 420, { fontSize: 18 });

    const cardHeight = 24 + title.height + 12 + body.height + 24;   // measured, not guessed
    return [ /* skeleton using title.width, body.text, cardHeight, mark({...}) */ ];
  },
});
```

`measure` batches: pass every string at once rather than calling per string.
`wrap` measures word widths, fills lines greedily, then measures the finished
block so the caller sizes cards from the width the renderer will produce.

## Why measurement happens in a browser

The Excalidraw library needs a DOM even for `convertToExcalidrawElements`, and
text metrics are only right when a real browser measures them. Two traps the
toolchain already handles, both covered by `tools/smoke.js`:

- `exportToSvg` inlines `@font-face` rules but never registers them with
  `document.fonts`, so every family measures as the serif fallback and all
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

## Round-tripping a human-edited file

```js
import { withExcalidraw } from "<plugin>/tools/browser.js";

await withExcalidraw(async (ex) => {
  const { elements } = await ex.restore(JSON.parse(readFileSync(file, "utf8")));
  // elements now have refreshed text dimensions and repaired bindings
});
```

`restore` runs with `refreshDimensions` and `repairBindings`, which recomputes
text sizes and reconnects arrows after hand edits. Use it before programmatic
edits to a file a human has touched.

## Mermaid for genuine graphs

For a flowchart or sequence diagram where auto-layout is adequate, generate the
elements from Mermaid instead of placing them:

```js
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
const { elements } = await parseMermaidToExcalidraw("flowchart LR\n A[PDF] --> B[Docling]");
```

The result is a uniform box-and-arrow grid — right for a graph, wrong for a
teaching panel, which is the whole reason bands are laid out deliberately.
