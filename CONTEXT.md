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
A `column`/`row` positioning construct. It places children but is not an Excalidraw group and cannot be an arrow target.
_Avoid_: group (unqualified)

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
