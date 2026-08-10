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

**Problem code**:
The stable kebab-case identifier the gate attaches to one kind of defect (e.g. `frame-escape`). The set is append-only; codes are a public contract.
_Avoid_: error code, rule id

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

**Fan**:
One source, one arrow per target, every arrow leaving one united origin on the
source's facing edge and landing spread across its own target's. `fanOut` writes
one; the spread is a band centred on each landing edge, never hand-accumulated
offsets.
_Avoid_: spray, splay, one-to-many arrows

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
Inserting a library item into a diagram with freshly regenerated ids so repeated insertions never collide.
_Avoid_: import, paste

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

**House pair**:
The two permitted fonts: one for prose, one for code. Any other font family fails the gate.

**Role**:
A named palette slot an element's colors are chosen by. Authors pick roles, never raw hex.
_Avoid_: color, swatch

### Rendering session

**Warm / re-warm**:
Loading the fonts into the browser session before any text is measured; re-warming when text introduces glyphs the warmed faces do not cover.

**Fingerprint / stale bundle**:
The hash stamped into the committed browser bundle over its exact inputs. A mismatch means the bundle is stale and every browser call refuses to run.
_Avoid_: checksum, version stamp
