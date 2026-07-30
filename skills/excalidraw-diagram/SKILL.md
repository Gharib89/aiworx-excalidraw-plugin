---
name: excalidraw-diagram
description: Author and revise .excalidraw diagrams that argue visually, with measured text and per-frame visual verification. Use whenever the user wants something drawn or visualized — a diagram, architecture picture, flow, whiteboard sketch, or visual explainer — even if they never say "Excalidraw"; when they ask to change, restyle or extend an existing .excalidraw file; or when they want one rendered to SVG or PNG.
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

Done when each panel names a distinct pattern and passes the isomorphism test.

## Step 3 — build it from measured text

Text width comes from the library, never from a character-count estimate: a
guess produces layouts that overflow only once the real font renders. Card and
frame sizes derive from those measurements.

See [reference/authoring.md](reference/authoring.md) for the skeleton format, the
measurement API, the layout helpers (`column`/`row`/`box`/`arrowBetween` — no
hand-accumulated pixel offsets), real assets (`image` embeds bytes in the files
dictionary; `spliceLibraryItem` inserts a community `.excalidrawlib` item with
fresh ids), and the generator shape for a band.

Done when the `.excalidraw` file exists and every card, column and frame size
traces to a measurement or an explicit constant — with no character-width factors.

## Step 4 — pass the gate

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/check.js" path/to/diagram.excalidraw
```

`authorDiagram` and `reviseDiagram` already run these rules in-process and
refuse to write a failing file, so a generator's output arrives pre-gated; the
CLI is for files that got here another way, and as the proof after hand edits.
Structure: a file
that isn't an Excalidraw document, unknown or degenerate elements, duplicate
ids, bindings pointing at deleted elements, images whose bytes are missing.
Geometry (rotation included): overlapping frames, bound text larger than its
container, elements escaping their frame or sitting over one without belonging
to it, free texts on top of each other, arrows crossing shapes they aren't
bound to, arrowheads buried inside their target, off-canvas strays. Style:
text failing 4.5:1 contrast against the fill it sits on, fonts outside the
house pair.

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

For each frame, check the composition against the claim from step 1, then hunt
the catalogue in [reference/anti-patterns.md](reference/anti-patterns.md) — the
defects there are legal geometry the gate cannot see.

You have been staring at the coordinates, so you will see what you meant, not
what renders. For a band beyond a few frames, hand the PNGs and the step 1
panel list to a fresh subagent: *"For each frame, name the claim you read from
the picture alone, then list mechanical defects — overlap, clipping, crowding,
arrows missing their target."* A frame whose read-back claim differs from the
panel list fails step 2, not step 5.

Done when every frame has been viewed, each defect found is either fixed or
named as a deliberate choice, and any fix has re-passed the step 4 gate.

## Step 6 — ship the right files

A **band** commits the generator, the `.excalidraw` and one `.svg` beside it —
GitHub renders SVG, so the diagram is viewable in the browser. A **sketch**
commits the `.excalidraw` and its `.svg`. Frame PNGs stay local; they are review
output.

When a human has edited a committed file, run it through `reviseDiagram` (see
[reference/authoring.md](reference/authoring.md)): one call restores metrics
and bindings, re-gates, and rewrites the file and its SVG.

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

Finish — roughness, fill style, arrowheads, opacity as depth — is a register
chosen once per diagram; see [reference/patterns.md](reference/patterns.md).

See [reference/palette.md](reference/palette.md) for the exact values and how the
palette is verified.
