# Excalidraw Authoring

Authoring `.excalidraw` diagrams that argue visually, with measured text and mechanical verification. One context, four consumers: the skill, the tools, the gate, and the docs. A term is settled here and spelled out by each consumer where its own readers need it — the shipped skill in particular, which travels without this repo and so carries its own definitions. So renaming a term here updates all four in the same change.

## Language

### Diagram kinds

**Sketch**:
A diagram small enough to author and verify as a single scene (roughly ≤ 80 elements).
_Avoid_: drawing, doodle

**Band**:
A diagram built as a horizontal row of frames, produced by a generator and verified frame by frame.
_Avoid_: strip, storyboard

**Panel**:
One frame's worth of content in a band — the unit an author reads, judges, and revises.
_Avoid_: slide, section

**Frame**:
The containment and verification unit. Every frame renders to its own PNG; elements must sit inside exactly one frame in a framed diagram.

### Verification

**Gate**:
The mechanical check that accepts or refuses a diagram before it ships. Refusal is per problem, never taste.
_Avoid_: linter, validator
_Not_: the **version gate** (`tools/version-gate.js`), which judges the plugin package rather than a diagram — always spell that one out in full.

**Problem code**:
The stable kebab-case identifier the gate attaches to one kind of defect (e.g. `frame-escape`). The set is append-only; codes are a public contract.
_Avoid_: error code, rule id

**Kind**:
The machine-readable file-level code a `DocumentError` carries — `unreadable`, `empty-file`, `invalid-json`, `not-excalidraw` — set by the one loader (`readExcalidrawDocument` in `tools/document.js`) and mapped by check.js into its `error.code` output contract. Named `kind`, not `code`, so it never collides with Node's own `err.code`.
_Avoid_: error code (that is check's output field), category

**Clearance**:
How far an element's ink stops short of the nearest edge of the frame containing it — negative when the ink pokes out. `clearance(outer, inner)` in `tools/geometry.js` is the one measurement; containment and the frame-edge inset both read it, so escaping a frame and crowding its border are one number judged at two thresholds.
_Avoid_: margin, padding (that is the render flag), gap (that is the arrow standoff)

**Stray**:
An element sitting off-canvas — far enough from every other element that it reads as
left behind rather than placed. Strays fail the gate. Merely sitting outside every
frame is not a stray: titles, legends and captions legitimately do, and the gate
counts them (`stats.outsideAll`) instead of refusing them.
_Avoid_: orphan

**What/where/next**:
The bar every thrown error meets: what failed, where (the file, element id, or call at fault), and the one next action — a command or an instruction, never a link. The three are fields on `NamedError` and compose the message as `where: what — next`; `tests/error-messages.js` enforces them.
_Avoid_: error format, message template

**Isomorphism test**:
The authoring judgment that the picture's structure mirrors the idea's structure — if the visual shape does not match the argument, restructure the diagram, not the styling.

### Authoring

**Skeleton**:
The author-supplied element description handed to the converter before it becomes real Excalidraw elements.
_Avoid_: template, draft element

**Ingestion**:
Turning a diagram someone already wrote in another notation — today a mermaid
flowchart — into house material. The parse is kept (nodes, edges, labels,
shapes); the source's own positions, colours and text metrics are dropped,
because they were computed with the metrics this pipeline replaces. `fromMermaid`
is the one ingestion path, and what it returns goes straight into `graph`.
_Avoid_: import, conversion

**Layout group**:
A `stack`/`column`/`row` positioning construct. It places children but is not an Excalidraw group and cannot be an arrow target.
_Avoid_: group (unqualified)

**Last mover**:
The outermost layout call that still shifts a given shape — in a band, the
band-level `row` that spreads the panels, not the panel's own stacks. Layout
groups place by mutating their children, so anything holding coordinates it wrote
for itself — `via` waypoints, a frame sized by hand — belongs after its shapes'
last mover. A deferred arrow and a frame listing `children` are settled later
still, so their creation order is free.
_Avoid_: final placement, outer row

**Deferred arrow**:
The arrow `arrowBetween` returns: it holds its two endpoints by reference and
takes its geometry from a resolve pass the authoring pipeline runs once the build
is done, so no later mover can leave it behind. Id, bindings, label and style are
carried from the moment it is written; only the path waits.
_Avoid_: lazy arrow, unresolved arrow

**Facing edge**:
The cross-axis edge of a shape an arrow leaves from or arrives at, picked by the
axis of the wider separation. `originAt`/`landAt` name a point along it as a
fraction — `0` its low-coordinate end, `1` its high end — in place of the overlap
centre the arrow would otherwise take.
_Avoid_: near side, anchor edge

**Fan-out**:
One source, one arrow per target, every arrow leaving one united origin on the
source's facing edge and landing spread across its own target's. `fanOut` writes
one; the spread is a band centred on each landing edge, never hand-accumulated
offsets. The shape the skill's pattern catalogue names for one-to-many.
_Avoid_: fan (unqualified), spray, splay, one-to-many arrows

**Graph**:
Nodes and the edges between them, laid out by an engine rather than by hand —
what `graph` takes and what ELK's `layered` algorithm arranges into layers. A
*chart* is the other thing entirely: measured data drawn to scale, where the
author owns every coordinate. Say graph only where edges decide the placement.
_Avoid_: diagram (unqualified), network, chart

**Bound label**:
Text bound to an arrow — its `containerId` names the arrow, and `arrowBetween`'s
`label:` option writes one. The house form for on-arrow text: the renderer masks
the arrow's own path behind the label's box, so its own line never strikes it.
The mask covers only that arrow — a *different* arrow crossing the label is still
a defect. The pipeline re-centers a bound label onto its arrow on every pass, so
a hand-moved one snaps back by design; a label that must sit off the line is
unbound free text instead (clear `containerId` and the arrow's `boundElements`
entry).
_Avoid_: arrow label (unqualified), floating label

**Splice**:
Inserting a library item into a diagram with freshly regenerated ids so repeated
insertions never collide. It inserts the item verbatim unless asked to drop the
item's own text outside the house pair — which is what a real community item
labels itself with, and what the gate refuses.
_Avoid_: import, paste

**Library index**:
The published list of community `.excalidrawlib` files behind
libraries.excalidraw.com — one JSON array, one entry per library. `source`
(`<author>/<name>.excalidrawlib`) is the handle: it is the only field every entry
carries and it is the path the file downloads from, so `id` and `itemNames`, which
many entries omit, are reported but never required. The index states no tags,
which is why a search reads the name, the item names and the description.
`tools/library.js` searches it and downloads one file; the splice stays the only
insertion path.
_Avoid_: registry, catalogue, repository

**Library cache**:
Where a fetched index and every downloaded library live on disk —
`$XDG_CACHE_HOME/aiworx-excalidraw/libraries/`, or whatever
`EXCALIDRAW_LIBRARY_CACHE` names. Outside the checkout by definition: a user's
downloads are not the repo's, and verification never dirties a tracked file. A
week old is fresh; past that a search refreshes it, and refuses rather than
serving aged data when the network cannot.
_Avoid_: store, local copy

**Orthogonal route**:
An arrow path made only of axis-aligned segments, computed by the authoring call
(`route: "orthogonal"`) rather than hand-written as waypoints. It owns the gap
between the two shapes it connects and turns inside it, so it crosses neither —
but it avoids nothing else. Upstream's `elbowed` element flag is a different
thing and stays inert.
_Avoid_: elbow arrow, right-angle connector

### Style

**Register**:
The per-diagram set of finish choices — roughness, stroke style, stroke width, fill style, arrowheads — held consistent across the whole picture. Set once via `register:` on the authoring call; a per-element value overrides it where the register must be broken deliberately.
_Avoid_: theme, style preset

**Output preset**:
The named display surface a diagram is authored for — `fit`, `doc-inline`,
`doc-wide`, `slide-16x9`, `social-og` — set once with `preset:` on the authoring
call, the way a register sets finish. It fixes two things at once: the `surface`
(width and height, in px) the build lays out into, and the type ramp. `fit` names
no surface and is the default, so a build that asks for no preset is the build it
always was. `render.js --preset` is the framing half on its own — it grows an
export's canvas to the surface's aspect ratio and touches no text, because by
then the type is already set.
_Avoid_: size, format, layout preset

**Type ramp**:
The three text sizes a preset moves together — `title`, `label`, `sublabel` —
handed to the build as `ramp`. Card and frame sizes come from measured text, so
raising the ramp before anything is measured widens the cards that hold it and
the layout follows; scaling a finished export instead enlarges the whitespace
along with the words and lands back where it started. `sublabel` is the rung a
bare-string arrow label takes.
_Avoid_: font scale, text size preset

**House pair**:
The two permitted fonts: one for prose, one for code. Any other font family fails the gate.

**Role**:
A named palette slot an element's colors are chosen by. Authors pick roles, never raw hex.
_Avoid_: color, swatch

**House palette**:
The shipped AIWorx palette, `brand/palette.json` — what every consumer gets when no brand override exists.
_Avoid_: default palette, base palette

**Brand override**:
A project's own strokes-only palette file, `.excalidraw-brand.json`, discovered by walking up from the working directory. The full palette is derived from it in memory on every read — fills by the house OKLCH rule, grey neutralized — and verified against the same contrast claims; a file that fails refuses the run (`invalid-brand-override`), never falls back silently. `{ "defaults": "accepted" }` records the explicit decision to keep the house palette.
_Avoid_: custom palette, theme override

### Rendering session

**Warm / re-warm**:
Loading the fonts into the browser session before any text is measured; re-warming when text introduces glyphs the warmed faces do not cover.

**Fingerprint / stale bundle**:
The hash stamped into the committed browser bundle over its exact inputs. A mismatch means the bundle is stale and every browser call refuses to run.
_Avoid_: checksum, version stamp
