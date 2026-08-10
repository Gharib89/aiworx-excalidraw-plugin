---
name: excalidraw-diagram
description: Author, revise and render .excalidraw diagrams with measured text and per-frame visual verification. Use whenever the user wants something drawn or visualized — a diagram, architecture picture, flow, or whiteboard sketch — even if they never say "Excalidraw"; when they ask to change, restyle or extend an existing .excalidraw file; or when they want one rendered to SVG or PNG.
---

# Excalidraw diagrams

A diagram **argues**. Its structure carries the claim; the words only label what
the shapes already say. A grid of equal boxes with text in them displays
information and argues nothing.

Two kinds of work, and naming which one you are doing decides everything after:

- A **sketch** — up to ~80 elements, one screen, hand-placed. The `.excalidraw`
  file is the source of truth; humans edit it afterwards in the app or VS Code.
- A **band** — a teaching diagram, hundreds of elements, a left-to-right row of
  frames each explaining one idea. A generator script is the source of truth and
  the `.excalidraw` is its build artifact.

## Step 1 — name the kind, list the panels

Say which kind this is. For a **band**, write the panel list first: one line per
frame, in reading order, each naming the single idea that frame lands.

Done when the kind is named and, for a band, every panel has a one-line claim.

## Step 2 — map each idea to a shape that means it

For every panel or major concept, choose the visual pattern whose *behaviour*
mirrors the idea: a fan-out for one-to-many, a funnel for aggregation, two pages
side by side for a coordinate flip, a bar chart for a measured result. Read
[reference/patterns.md](reference/patterns.md) for the pattern set, shape
meanings, and how much text belongs in a container.

Apply the **isomorphism test**: strip every label, and the remaining structure
still carries the argument. When a panel fails it, choose a different pattern.

Done when each panel names a pattern distinct from its neighbours' and passes the
isomorphism test.

## Step 3 — build it from measured text

Text width comes from the library, never from a character-count estimate: a
guess produces layouts that overflow only once the real font renders. Card and
frame sizes derive from those measurements.

See [reference/authoring.md](reference/authoring.md) — it opens with the build
context inventory, one row per member `build` receives, and goes on to the
skeleton format, the measurement API, the layout helpers
(`stack`/`column`/`row`/`box`/`arrowBetween`/`fanOut` — no hand-accumulated
pixel offsets), real assets (`image` embeds bytes in the files dictionary;
`spliceLibraryItem` inserts a community `.excalidrawlib` item with fresh ids),
and the generator shape for a band — compose, place, then bind, in that order.

Four options in there carry most of the leverage, and a session that misses them
rebuilds by hand what already exists:

- `arrowBetween(a, b, { route: "orthogonal" })` computes an elbow's points for
  you — the app's elbow router never runs in the converter.
- `standoff` is the gap an arrow keeps from both shapes it spans.
- `label: { text, strokeColor: palette.ink }` gives an edge label ink of its own.
  A label inherits the arrow's `strokeColor` by default, so a role-coloured
  arrow fails step 4's contrast rule through its own label.
- A frame lists its `children` by id and then sizes itself around them. One
  without that list is a `SkeletonError` at the door.

Done when the `.excalidraw` file exists and every card, column and frame size
traces to a measurement or an explicit constant — with no character-width factors.

## Step 4 — pass the gate

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/check.js" path/to/diagram.excalidraw
node "${CLAUDE_PLUGIN_ROOT}/tools/check.js" a.excalidraw b.excalidraw   # batch: worst exit code wins
node "${CLAUDE_PLUGIN_ROOT}/tools/check.js" a.excalidraw --json         # one machine-readable report
```

The gate refuses per problem, never per taste. Its rules cover file integrity,
geometry including rotation, arrow bindings and crossings, text contrast in both
themes, and the house font pair.
[reference/problem-codes.md](reference/problem-codes.md) is the whole vocabulary:
every code with its `elements` order and extra fields, the `--json` report shape,
and the argument and exit-code conventions all three CLIs share. Codes are
append-only, so machine handling keys on `code` and the `message` prose carries
no contract.

`authorDiagram` and `reviseDiagram` already run these rules in-process and
refuse to write a failing file, so a generator's output arrives pre-gated; the
CLI is for files that got here another way, and as the proof after hand edits.

Done when it exits 0.

## Step 5 — look at every frame

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/render.js" path/to/diagram.excalidraw --out /tmp/dg
```

This writes the SVG plus one PNG per frame, numbered in reading order. **Read
every frame PNG**, one at a time. JSON hides overlap, clipping and crowding;
the picture shows them.

When iterating on one frame, re-render just it instead of the whole band:
`--frame 3`. Other knobs: `--dark` (dark-theme export), `--padding N`,
`--background COLOR`. Invalid values fail loudly with a `UsageError`.

`--padding` pads the whole-picture SVG only: Excalidraw zeroes padding when
exporting a frame, so every frame PNG crops exactly at the frame border. Content
flush with that border renders clipped — which step 4 already refuses as
`frame-edge-crowding`, so the fix is clearance inside the frame rather than a
flag here.

For each frame, check the composition against the claim from step 1, then hunt
the catalogue in [reference/anti-patterns.md](reference/anti-patterns.md) — the
defects there are legal geometry the gate cannot see.

You have been staring at the coordinates, so you will see what you meant, not
what renders. **Four or more frames: dispatch a fresh subagent for the
read-back** — hand it the PNGs and the step 1 panel list: *"For each frame, name
the claim you read from the picture alone, then list mechanical defects —
overlap, clipping, crowding, arrows missing their target."* For three frames or
fewer, your own pass above is the read-back.

A frame whose read-back claim differs from the panel list has failed the
isomorphism test — send it back to step 2, where the pattern is chosen, rather
than nudging its geometry here.

Done when every frame has been viewed, each defect found is either fixed or
named as a deliberate choice, any fix has re-passed the step 4 gate, and, at
four or more frames, a fresh subagent has read every frame back.

## Step 6 — ship the right files

A **band** commits the generator, the `.excalidraw` and one `.svg` beside it —
GitHub renders SVG, so the diagram is viewable in the browser. A **sketch**
commits the `.excalidraw` and its `.svg`. Frame PNGs stay local; they are review
output.

When a human has edited a committed file, run it back through the pipeline —
one command restores metrics and bindings, re-gates, and rewrites the file and
its SVG:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/revise.js" path/to/diagram.excalidraw
```

`--no-svg` rewrites the `.excalidraw` alone. A file that isn't a parseable
Excalidraw document is rejected with a `DocumentError`, a revision that would
fail the gate with a `GateError`, and neither writes anything. Revise also drops
image bytes no element references any more, so deleting an image by hand shrinks
the file instead of carrying its data URL forever. From inside a
generator, call `reviseDiagram` directly (see
[reference/authoring.md](reference/authoring.md)).

Done when the files the kind calls for are committed, no frame PNG is among them,
and any hand-edited file has been back through `revise.js`.

## House style

Colour encodes one meaning each, from `brand/palette.json`:

| role | means |
|---|---|
| `local` | runs locally, on this machine |
| `artifact` | an artifact or output |
| `pass` | a check that passed, a gate held |
| `remote` | leaves the machine — API or model call |
| `decision` | a decision, a threshold, a trap |
| `fail` | what goes wrong |
| `grey` | scaffolding, structure, labels |

Prose and labels use `fontFamily: 6` (Nunito); code, JSON and file paths use
`fontFamily: 3` (Cascadia). Both ship with Excalidraw and embed on export, so the
diagram renders identically for anyone. A family naming a system font — Helvetica
among them — substitutes per machine and reflows the layout.

Finish — roughness, stroke style, stroke width, fill style, arrowheads — is a
**register** chosen once per diagram and set once, with `register:` on the
`authorDiagram` call; opacity stays per element, because depth is the one cue
that has to vary. [reference/patterns.md](reference/patterns.md) is what each
value means, [reference/authoring.md](reference/authoring.md) the option itself.

[reference/palette.md](reference/palette.md) carries the exact values, how the
palette is verified, and why it survives the dark export unchanged.

## When the skill misbehaves

The installed plugin is a cached copy that can lag this repo — a session then
loads stale skill text against newer expectations. When a documented flag is
rejected, an error appears that this text does not mention, or behaviour
contradicts these docs, compare the running copy's version
(`.claude-plugin/plugin.json` under `${CLAUDE_PLUGIN_ROOT}`) with the repo's
before debugging further, and update the plugin if they differ.
