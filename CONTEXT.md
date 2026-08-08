# Excalidraw Authoring

Authoring `.excalidraw` diagrams that argue visually, with measured text and mechanical verification. One context: the vocabulary below is used by the skill, the tools, the gate, and the docs.

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
An element that sits outside every frame in a framed diagram. Strays fail the gate.
_Avoid_: orphan

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

### Style

**Register**:
The per-diagram set of finish choices — roughness, stroke style, stroke width, arrowheads — held consistent across the whole picture.
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
