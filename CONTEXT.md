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

**Container**:
A shape whose outline encloses another shape's outline — a boundary drawn around what it groups (an account, a VPC, a cluster). Arrows crossing it do so by design, so a measurement that reads "an arrow passing near an unrelated shape" reads past it. A container is still a node: enclosure is what it does to the arrows over it, not a different kind of thing.
_Avoid_: group, boundary box, backdrop (that is a plate)
_Not_: a **frame**, which is the containment unit the export crops to.

**Plate**:
A shape with no visible stroke, sitting under text as backing. It carries no meaning of its own, so no measurement counts it as a node — sizes, hues and node uniformity read past it.
_Avoid_: background, backdrop, mask

### Verification

**Gate**:
The mechanical check that accepts or refuses a diagram before it ships. Refusal is per problem, never taste.
_Avoid_: linter, validator
_Not_: the **version gate** (`tools/version-gate.js`), which judges the plugin package rather than a diagram — always spell that one out in full.

**Problem code**:
The stable kebab-case identifier the gate attaches to one kind of defect (e.g. `frame-escape`). The set is append-only; codes are a public contract.
_Avoid_: error code, rule id

**Fidelity ledger**:
The account `revise.js` prints of what a round-trip changed beyond what was asked
— text remeasured, bindings and frame membership repaired, bound labels
re-centered, elements purged, image payloads pruned. Its codes are a third
namespace beside the gate's element-level and file-level ones: same append-only
contract, same entry shape, but an entry reports a repair the pass made rather
than a defect it refuses over. A pass that changed nothing says so in one line —
silence would read as a no-op. `reviseDiagram` returns the ledger; only the CLI
prints it.
_Avoid_: change log, audit trail, diff report

**Advisory**:
A measurement the gate reports without refusing — how far the picture sits from
a house rule (arrow–arrow crossings, aspect against the preset, clearance between
arrows), never a taste judgment. Every advisory carries the number and the bound
it was judged against, so an author revises against numbers rather than prose; a finding that reports a co-occurrence rather than a quantity — two arrows crossing, `pass` and `fail` on one canvas — names the elements instead, and invents no number.
Same entry shape and append-only code contract as a problem, its own namespace: a
diagram with advisories still passes, and the exit code never reads them.
Thresholds are house constants, retuned by a change rather than a knob. The same
measurement scores the benchmark corpus.
_Avoid_: warning, hint, lint, finding (unqualified), advisory tier (*tier* is the rubric's word)

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
still, so their creation order is free; an **engine route** is held relative to
its graph group and settles with them, so it too is free of this rule.
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

**Reading order**:
The order a reader meets a graph's nodes — which one leads, which closes, and
which way a layer runs across. It belongs to the author, not the engine: `graph`
takes the order `nodes` was listed in as its tie-break (*model order*) and takes
`entry` / `exit` to *pin* a node to the first or last layer. A cycle still costs
one reversed edge; what these decide is **which** edge gives way.
_Avoid_: flow direction (that is `direction`), rank, precedence

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

**Engine route**:
The path `graph` reads back off the layout engine and gives an edge: the bends and
the two ports ELK left when it placed the nodes. Held relative to the graph group,
so a later mover carries it, and settled with the deferred arrow — as against
`via`, whose waypoints are the author's own absolute coordinates. It goes around
the nodes the engine placed, which no other route can. Placing an endpoint by hand
revokes it, and so does moving a node out from under it.
_Avoid_: ELK route, auto-route, computed waypoints

**Corridor**:
The space the layout engine reserves around every node for the routes that pass
it — where an **engine route** runs and turns. Its width is `graph`'s `edgeGap`
across the flow and `edgeLayerGap` along it, both 10px by default; widening one
buys an edge label room to sit beside a node rather than on it. Corridors are
the engine's to spend, like the bend count a `placement` strategy trades: a
fraction (`originAt`/`landAt`) reaches none of them, it only revokes the route.
Distinct from **clearance**, which measures ink already drawn, and from `gap` /
`layerGap`, which space the nodes rather than the routes between them.
_Avoid_: channel, lane, edge margin

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

**Brand onboarding**:
The once-per-project exchange that produces a brand override: the skill's first step finds no `.excalidraw-brand.json`, asks the user whether to adopt a brand, mines colors from the source they name, maps them onto the six roles hue-nearest with red/green/blue pinned by convention, and validates the written file with `tools/palette.js`. The agent is the extraction engine; the contrast rules are the arbiter. The file's existence ends the ask — a declined onboarding writes `{ "defaults": "accepted" }`.
_Avoid_: brand setup, palette wizard, first-run prompt

### Rendering session

**Warm / re-warm**:
Loading the fonts into the browser session before any text is measured; re-warming when text introduces glyphs the warmed faces do not cover.

**Fingerprint / stale bundle**:
The hash stamped into the committed browser bundle over its exact inputs. A mismatch means the bundle is stale and every browser call refuses to run.
_Avoid_: checksum, version stamp

### Benchmark

**Brief**:
The user prompt a benchmark case is rendered from — a realistic paragraph naming the components, the audience and the target surface, and nothing about layout, pattern, colour or shape. Frozen once a baseline exists: a change is a new brief, never an edit.
_Avoid_: prompt, scenario, test case

**Benchmark corpus**:
The fixed set of briefs a change to the skill or tools is judged on, before against after.
_Avoid_: examples (the showcase), fixtures (planted defects)

**Bench run**:
One rendering of the whole corpus under one plugin version and one model. Run-to-run noise is expected, so a score that moves between versions is re-run once before it counts.
_Avoid_: eval, benchmark (unqualified)

**Baseline**:
The bench run under the version the corpus was frozen at — what every later run is compared against.
_Avoid_: before, golden

**Rubric**:
The ranked set of house rules the benchmark corpus is scored against, before
against after. Tier A rules score pass/fail per brief; Tier B is prose the
read-back judges without counting; Tier C is rejected or deferred with its reason.
_Avoid_: checklist, style guide, criteria (unqualified)

**House rule**:
One checkable statement in the rubric, carrying its delivery channel — skill prose,
an advisory, or a layout primitive. A rule may ride more than one channel.
_Avoid_: guideline, best practice, anti-pattern (the retired catalogue's word)

**Grade**:
The judged half's verdict for one brief — the half no advisory measures. A
grader that never authored the picture reads its rendered frames blind and
names the claim it sees, then scores each judged Tier A rule pass/fail/n-a
with a line of evidence and judges Tier B in prose. A grade is a pair, scene
and rubric version, never a property of a bench run: the scenes are frozen, so
either side is re-graded under a later rubric for cents.
_Avoid_: score (unqualified), review, read-back (that is the in-run subagent)
