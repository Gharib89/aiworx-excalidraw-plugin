# Converter contracts in `@excalidraw/excalidraw` 0.18.1

Research for [#39](https://github.com/Gharib89/aiworx-excalidraw-plugin/issues/39). Answers the four
questions about `convertToExcalidrawElements` from the actual library source, plus the experiments
that settle each one.

## How the source was read

The npm package ships only bundles (`dist/prod`, `dist/dev`) and `.d.ts`. **The dev bundle carries
full source maps with `sourcesContent`** — the original TypeScript, not the minified output. Every
line number below is a line in that recovered source, which is the upstream file of the same name
under `packages/excalidraw/` at the v0.18.1 tag:

```js
// node one-liner used to extract
const m = JSON.parse(fs.readFileSync("dist/dev/index.js.map"));
fs.writeFileSync("transform.ts", m.sourcesContent[m.sources.indexOf("../../data/transform.ts")]);
```

| recovered file | source map | upstream path |
| --- | --- | --- |
| `transform.ts` (792 lines) | `dist/dev/index.js.map` | `packages/excalidraw/data/transform.ts` |
| `binding.ts`, `newElement.ts`, `typeChecks.ts`, `textElement.ts`, `utils.ts`, `fractionalIndex.ts` | `dist/dev/chunk-4FTI6OG3.js.map` | `packages/excalidraw/element/*.ts`, `packages/excalidraw/*.ts` |

The public type is already decisive on the option surface:

```ts
// dist/types/excalidraw/data/transform.d.ts (last line)
export declare const convertToExcalidrawElements: (
  elementsSkeleton: ExcalidrawElementSkeleton[] | null,
  opts?: { regenerateIds: boolean },
) => OrderedExcalidrawElement[];
```

Experiments were run against a scratch esbuild bundle of `dist/prod/index.js` exposing raw
`convertToExcalidrawElements` / `restore` / `exportToSvg` in headless Chrome (same engine as
`tools/browser.js`). Results quoted inline.

---

## 1. Ids — `{ regenerateIds: false }` preserves author ids. Verdict: **fixable today, no remap table needed.**

`transform.ts:494-512`:

```ts
export const convertToExcalidrawElements = (
  elementsSkeleton: ExcalidrawElementSkeleton[] | null,
  opts?: { regenerateIds: boolean },
) => {
  ...
  for (const element of elements) {
    let excalidrawElement: ExcalidrawElement;
    const originalId = element.id;
    if (opts?.regenerateIds !== false) {
      Object.assign(element, { id: randomId() });   // randomId() === nanoid()
    }
```

Note the polarity: the guard is `!== false`, so **omitting `opts` regenerates**. `tools/page.js:198`
calls `convertToExcalidrawElements(skeleton)` with no second argument, which is exactly why every id
in our output is a fresh nanoid.

Verified (`regenerateIds: false`, ids `a`/`b`/`fr`/`ar` all kept, frame children and arrow bindings
still resolved):

```json
[{"id":"a","type":"rectangle","frameId":"fr"},
 {"id":"b","type":"rectangle","frameId":"fr"},
 {"id":"fr","type":"frame","x":-10,"y":-10,"w":280,"h":60}]

[{"id":"ar","type":"arrow","startBinding":{"elementId":"a","focus":0,"gap":10},
                           "endBinding":{"elementId":"b","focus":0,"gap":10}}]
```

Caveats when switching the plugin to `regenerateIds: false`:

- **A skeleton element with no `id` still gets a nanoid** — `_newElementBase` does
  `id: rest.id || randomId()` (`newElement.ts:126`). So author ids must be supplied for every
  element we want to trace, not just the bound ones.
- **Duplicate author ids silently drop elements.** `transform.ts:626-635`:
  ```ts
  const existingElement = elementStore.getElement(excalidrawElement.id);
  if (existingElement) {
    console.error(`Duplicate id found for ${excalidrawElement.id}`);
  } else { elementStore.add(excalidrawElement); ... }
  ```
  Measured: three rects with ids `d`, `d`, `z` produce two elements (`d`, `z`) and one
  `console.error`. Nothing throws. `tools/author.js`'s `validateSkeleton` should enforce id
  uniqueness before we rely on this flag.
- Ids leak into the written file, so they should stay stable/meaningful across a re-author.

**If we keep regenerating**, the mapping *is* recoverable by position, though the library never
returns its internal `oldToNewElementIdMap` (`transform.ts:504`, `:632-634`).
`ElementStore.excalidrawElements` is a `Map` (`transform.ts:469`) and `getElements()` is
`syncInvalidIndices(Array.from(this.excalidrawElements.values()))` (`transform.ts:479-481`);
`syncInvalidIndices` (`fractionalIndex.ts:188-198`) mutates indices only and `return elements` —
**it never reorders**. The first pass inserts skeleton elements in skeleton order; later passes
insert generated elements (bound labels, implicitly-created start/end shapes) under new keys, which
Map insertion order appends at the end. Measured for `[rect+label, arrow(bound,label), rect]`:

```json
[{"id":"r1","type":"rectangle"}, {"id":"ar","type":"arrow"}, {"id":"r3","type":"rectangle"},
 {"id":"vJJ4ELmqp7PjZNIALblos","type":"text"},     // r1's label
 {"id":"NVn9GNNzwSiXgjP4bYyLc","type":"text"},     // ar's label
 {"id":"d6aDd90ptQ9dvYN13d_-F","type":"ellipse"}]  // ar's implicit `end` shape
```

So `zip(skeleton[i], output[i])` for `i < skeleton.length` is a valid remap table — **but only when
no element was dropped for a duplicate id**, since a drop shifts every subsequent index. Guard it
with a length/type check, or just prefer `regenerateIds: false`.

## 2. Image bindings — the crash is in the transform layer only. Verdict: **library gap (skeleton API), not a core limitation.**

The crash is two steps. First, `bindLinearElementToElement` switches over the resolved start type and
handles only three shapes (`transform.ts:299-322`):

```ts
} else {
  switch (startType) {
    case "rectangle":
    case "ellipse":
    case "diamond": {
      startBoundElement = newElement({ x: startX, y: startY, width, height,
                                       ...existingElement, ...start, type: startType });
      break;
    }
    default: {
      assertNever(linearElement as never, `Unhandled element start type "${start.type}"`, true);
    }
  }
}

bindLinearElement(linearElement, startBoundElement as ExcalidrawBindableElement, "start", elementsMap);
```

`assertNever(..., softAssert = true)` **does not throw** (`utils.ts`):

```ts
export const assertNever = (value: never, message: string | null, softAssert?: boolean): never => {
  if (!message) { return value; }
  if (softAssert) { console.error(message); return value; }
  throw new Error(message);
};
```

so `startBoundElement` stays `undefined` and control falls straight into `bindLinearElement`, whose
first use of the argument is a property read (`binding.ts:477-488`):

```ts
export const bindLinearElement = (
  linearElement, hoveredElement: ExcalidrawBindableElement, startOrEnd, elementsMap,
): void => {
  if (!isArrowElement(linearElement)) { return; }
  const binding: PointBinding | FixedPointBinding = {
    elementId: hoveredElement.id,      // <-- TypeError: Cannot read properties of undefined
```

That is the exact pair we observe: page `console.error: Unhandled element start type "undefined"`
followed by the thrown `Cannot read properties of undefined (reading 'id')`. The message says
`"undefined"` because it prints `start.type` (the *skeleton's* type, absent when binding by `id`)
while the switch tested `startType` (the *resolved* type). Note the `end` branch has the same bug
with the message fixed (`transform.ts:391-395` prints `endType`).

Reproduced, three ways, all fatal:

| skeleton | page console | result |
| --- | --- | --- |
| `image` element + `arrow{start:{id:"img"}}` | `Unhandled element start type "undefined"` | throws |
| `arrow{start:{type:"image",fileId}}` | `Unhandled element start type "image"` | throws |
| `frame` + `arrow{start:{id:"fr"}}` | `Unhandled element start type "undefined"` | throws |

**Frames, embeddables and iframes crash identically** — the gap is wider than images.

By design or bug? Both, and the design half is only in the skeleton types. `ValidLinearElement`
explicitly excludes image (`transform.ts:70-111` for `end`, `:112-153` for `start`):

```ts
type: Exclude<ExcalidrawBindableElement["type"],
              "image" | "text" | "frame" | "magicframe" | "embeddable" | "iframe">;
```

But the core considers images fully bindable (`typeChecks.ts:145-162`):

```ts
export const isBindableElement = (element, includeLocked = true): element is ExcalidrawBindableElement =>
  element != null && (!element.locked || includeLocked === true) &&
  (element.type === "rectangle" || element.type === "diamond" || element.type === "ellipse" ||
   element.type === "image" || element.type === "iframe" || element.type === "embeddable" ||
   element.type === "frame" || element.type === "magicframe" ||
   (element.type === "text" && !element.containerId));
```

So arrow→image binding is a first-class scene concept the *editor* supports; only the programmatic
skeleton converter refuses it. Regardless of intent, **soft-asserting and then dereferencing the
`undefined` result is a bug**: a documented "unsupported" would return early or throw a named error,
not a `TypeError` from three frames deeper.

### Workaround that works today

Bindings cannot be authored declaratively (see §3), but they can be *stitched after convert*, which
is entirely in our control since `tools/author.js:412` already post-processes the converted array
(`bindToFrames`). For an image target: convert with the arrow unbound, then set
`arrow.startBinding = { elementId: imgId, focus, gap }` and push `{ id: arrowId, type: "arrow" }`
onto the image's `boundElements`. Verified that convert accepts an `image` + arrow pair without a
`start` key and returns both elements cleanly (`C4` case) — the crash only comes from the `start`/
`end` skeleton keys.

### Upstream status

Unfixed on master and there is no release past 0.18.1 — see [Upstream](#upstream-checked-aug-2026).

## 3. Bound-arrow routing — explicit `points` are **not** discarded. Verdict: **the observed re-route is not the converter.**

Nothing in the convert path recomputes an arrow's path from its bindings. The arrow branch spreads
the skeleton *after* the defaults, so author `points` win (`transform.ts:546-562`):

```ts
case "arrow": {
  const width = element.width || DEFAULT_LINEAR_ELEMENT_PROPS.width;
  const height = element.height || DEFAULT_LINEAR_ELEMENT_PROPS.height;
  excalidrawElement = newArrowElement({
    width, height, endArrowhead: "arrow",
    points: [pointFrom(0, 0), pointFrom(width, height)],
    ...element,            // author points override the default two-point path
    type: "arrow",
  });
  Object.assign(excalidrawElement, getSizeFromPoints(excalidrawElement.points));
```

`bindLinearElement` only *reads* the points — `calculateFocusAndGap` (`binding.ts:701-726`) derives
`focus`/`gap` from the existing edge points and stores them in the binding; it calls
`mutateElement(linearElement, { startBinding | endBinding })` and nothing else (`binding.ts:513-515`).

The **only** mutation the converter makes to a bound arrow's geometry is a ±0.5px nudge of the first
and last point so the endpoints don't sit exactly on the bound shape (`transform.ts:418-459`):

```ts
// Update start/end points by 0.5 so bindings don't overlap with start/end bound element coordinates.
const endPointIndex = linearElement.points.length - 1;
const delta = 0.5;
const newPoints = cloneJSON<readonly LocalPoint[]>(linearElement.points);
if (points[end][0] > points[end-1][0]) { newPoints[0][0] = delta; newPoints[end][0] -= delta; }
...
Object.assign(linearElement, { points: newPoints });
```

Measured, a 4-point dog-leg bound at both ends:

```
skeleton points [[0,0],[0,120],[-290,120],[-290,230]]
convert         [[0,0.5],[0,120],[-290,120],[-290,229.5]]     (bound and unbound identical)
restore         [[0,0],[0,119.5],[-290,119.5],[-290,229]]     x/y shifted 0.5, shape unchanged
exportToSvg     path data byte-identical between the bound and unbound variants
```

Labels don't change this either: the same dog-leg with `label:{text:"lbl"}` came back with the same
points. `redrawTextBoundingBox` (`textElement.ts:74-95`) can widen an arrow *container*
(`mutateElement(container, { width: nextWidth })` when the label is wider than the arrow), which
changes the element's stated `width` without changing its points — worth knowing because our gate
reads bounds, but it is not a re-route and it did not trigger in the cases measured.

**So the `BUG WORKAROUND` comments in `examples/plugin-tour/gen-plugin-tour.js:110-112` and
`:147-150` are mis-attributed.** Whatever moved those diagonals, `convertToExcalidrawElements` did not:
`convert → restore(refreshDimensions, repairBindings) → exportToSvg` on bound vs geometry-only
endpoints produced identical paths. The likely real cause is in our own `arrowBetween`
(`tools/layout.js:176-229`), which picks its axis from `dxGap` vs `dyGap` and routes centre-to-centre
when the shapes' cross-ranges don't overlap (`tools/layout.js:193-209`) — the panel-3 comment at
`gen-plugin-tour.js:141-143` already describes exactly that failure mode. Recommend re-testing the
tour with bindings restored before we keep a workaround (and its comment) that blames the library.

Related contract, worth stating because it bites the obvious alternative: **`startBinding` /
`endBinding` / `fixedPoint` supplied directly in the skeleton are silently dropped.**
`newArrowElement` hard-nulls them after spreading the base (`newElement.ts:503-515`):

```ts
return {
  ..._newElementBase<ExcalidrawArrowElement>(opts.type, opts),
  points: opts.points || [], lastCommittedPoint: null,
  startBinding: null, endBinding: null,          // author-supplied bindings lost here
  startArrowhead: opts.startArrowhead || null, endArrowhead: opts.endArrowhead || null,
  elbowed: false,
};
```

Measured: a skeleton arrow with `startBinding:{elementId:"a",focus:0,gap:1,fixedPoint:[1,0.5]}` comes
back with `startBinding: null`. Only the `start` / `end` skeleton keys create bindings, and they only
ever produce plain `{elementId, focus, gap}` bindings — except for `elbowed: true` arrows, where
`bindLinearElement` takes the `calculateFixedPointForElbowArrowBinding` branch (`binding.ts:489-499`)
and *does* produce `fixedPoint` bindings with `focus: 0, gap: 0`. Elbow arrows are the one case where
the stored points are advisory: the elbow router recomputes the path from the fixed points on any
later mutation.

## 4. Option surface — one option, `regenerateIds`, and we pass none.

`opts?: { regenerateIds: boolean }` is the complete surface — the `.d.ts` above, and `opts` is
referenced exactly once in the whole function body (`transform.ts:510`). No `preserveIds`, no
binding/routing/frame switches. Everything else is per-element skeleton properties.

Current call site, `tools/page.js:193-199`:

```js
window.__ex = {
  convert: async (skeleton) => {
    await ensureFonts(skeletonTexts(skeleton));
    return convertToExcalidrawElements(skeleton);      // no opts -> ids regenerated
  },
```

marshalled by `tools/browser.js:151` (`convert: (skeleton) => page.evaluate(...)`, no opts parameter)
and consumed by `tools/author.js:412`. Also called opts-less at `tools/page.js:60` (font warm-up) and
`tools/page.js:109` (`measureText`) — neither cares about ids.

**The one change worth making:** thread an `opts` argument through
`page.js` → `browser.js` → `author.js` and pass `{ regenerateIds: false }`, with id-uniqueness
enforced in `validateSkeleton`. That alone fixes observation (a): gate errors would name the author's
own ids. Nothing in `opts` addresses (b) or (c).

Other non-option contracts found while reading, relevant to the plugin:

- **Frame children must resolve or convert throws** (`transform.ts:734-743`):
  ```ts
  element.children.forEach((id) => {
    const newElementId = oldToNewElementIdMap.get(id);
    if (!newElementId) { throw new Error(`Element with ${id} wasn't mapped correctly`); }
  ```
  Confirmed: a frame naming an unknown child throws `Element with nope wasn't mapped correctly`.
  `oldToNewElementIdMap` is only populated for skeleton elements that *had* an `id`
  (`transform.ts:632-634`), so a frame can only ever reference explicitly-id'd children — true with
  or without `regenerateIds: false`.
- **Binding by id rebuilds the target**: `newElement({ ...existingElement, ...start, type: startType })`
  (`transform.ts:304-312`) constructs a *new* object for the bound shape and re-`add`s it under the
  same id. `_newElementBase` copies a fixed whitelist of fields, so any property outside it (and
  `seed`/`versionNonce`) is not carried across. Ours all survive today, but it explains why bound
  shapes come back with different nonces.
- Frame geometry is auto-computed from children with 10px padding unless x/y/width/height are given
  (`transform.ts:760-778`).

---

## Upstream (checked Aug 2026)

**Still unfixed on master, and there is no release after 0.18.1 to upgrade to.**

- `npm view @excalidraw/excalidraw dist-tags` → `latest: 0.18.1`. Master's own
  `packages/excalidraw/package.json` still says `0.18.0` pending the next cut, and the `## Unreleased`
  section of `packages/excalidraw/CHANGELOG.md` says nothing about skeleton bindings or image
  support. So "fixed in a later version" is not on the table.
- The file moved to
  [`packages/element/src/transform.ts`](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/transform.ts)
  in the monorepo restructure (PR #9285, Mar 2025), but the switch is byte-for-byte the same three
  cases + soft `assertNever`, and `ValidLinearElement` still carries the same
  `Exclude<..., "image" | "text" | "frame" | "magicframe" | "embeddable" | "iframe">`. The commit
  history of that file (21 commits back to 2023) never touches the case list — it has only ever
  supported `rectangle | ellipse | diamond` since the skeleton binding feature landed in
  [PR #6546](https://github.com/excalidraw/excalidraw/pull/6546) (Aug 2023).
- No issue quotes the exact strings (`"Unhandled element start type"` /
  `Cannot read properties of undefined (reading 'id')`) — searched `repo:excalidraw/excalidraw` issues
  and PRs. The closest acknowledged one is
  [issue #8118](https://github.com/excalidraw/excalidraw/issues/8118), "Add new elements such as
  images programmatically", **open since Jun 2024**, where maintainer `dwelle` states:

  > While it's not possible to do so using the Skeleton API right now, you can still add images using
  > `addFiles` in combination with `updateScene`.

  i.e. the upstream-sanctioned workaround is exactly the one in §2 — build the image element and the
  arrow's `startBinding`/`endBinding` yourself, outside the skeleton converter.
- Master's `isBindableElement` / `ExcalidrawBindableElement` still include `image`, `iframe`,
  `embeddable`, `frame`, `magicframe`, which is what the interactive canvas hit-tests against — so
  dragging an arrow onto an image in the editor works today. Confirms the restriction is a
  self-imposed skeleton-layer limitation, not a rendering or interaction one.

**Verdict:** long-standing unimplemented feature gap (3 years), acknowledged by maintainers, no fix in
any release or on master. Treat as permanent for our purposes and work around it locally.

---

## Recommendations

1. Pass `{ regenerateIds: false }` and enforce unique author ids in `validateSkeleton`. Highest
   value, lowest risk — it is the whole of question 1.
2. Don't build a positional remap table unless we keep regenerating; if we do, assert
   `output[i].type === skeleton[i].type` for the prefix, because a duplicate id silently drops an
   element and shifts the rest.
3. For image/frame targets, stitch `startBinding`/`endBinding` + `boundElements` after convert in
   `author.js` rather than using the `start`/`end` skeleton keys. Consider a guard in
   `validateSkeleton` that rejects `start`/`end` referencing a non-rectangle/ellipse/diamond, so the
   failure names the element instead of surfacing as a `TypeError` from inside the page.
4. Re-test the plugin-tour bound arrows and drop the `BUG WORKAROUND` comments if they reproduce
   clean — the converter preserves explicit points through convert, restore and export.
