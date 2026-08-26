# ELK `layered` options that move layout quality — research notes (#188)

Wayfinder child of #183 (graph-aesthetics lane). Question: which `layered`
options move the aesthetics the lane names, what does `tools/layout.js graph()`
set today, what is worth exposing, and could ELK's orthogonal routing supply the
arrow paths instead of the per-arrow `route: "orthogonal"`.

## Version pin and sources

- `package-lock.json` pins **`elkjs` 0.12.0**. The elkjs releases page states
  each release is "Based on ELK &lt;same version&gt;", so the engine is
  **ELK 0.12.0** — the current ELK release (`v0.12.0` tag published
  2026-07-22, per `gh api repos/eclipse-elk/elk/releases`). The reference site
  therefore documents the pinned version; every enum name cited below was also
  grepped for in the installed `node_modules/elkjs/lib/elk.bundled.js`
  (`MEDIAN_LAYER_SWEEP`, `SCC_CONNECTIVITY`, `GREEDY_MODEL_ORDER`,
  `BF_MODEL_ORDER`, `LEFT_RIGHT_CONNECTION_LOCKING`, `layerUnzipping`,
  `NODE_SIZE_WHERE_SPACE_PERMITS` — all present).
- Primary sources, all read for this note (Context7 `/websites/eclipse_dev_elk`
  and `/kieler/elkjs`, plus direct fetches):
  - Algorithm page with the full option/default table:
    https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
  - Per-option pages under https://eclipse.dev/elk/reference/options/ (cited
    inline as `options/<id>`).
  - Enum Javadoc in the ELK sources (`plugins/org.eclipse.elk.alg.layered/src/
    org/eclipse/elk/alg/layered/options/*.java`, `plugins/org.eclipse.elk.core/
    src/org/eclipse/elk/core/options/*.java`) and the metadata file
    `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/Layered.melk`
    (descriptions and `requires` clauses).
  - ELK blog, "Layered" phase walk-through (2025-08-21):
    https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html
  - elkjs README and JSON format / coordinate-system pages:
    https://github.com/kieler/elkjs,
    https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html,
    https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/coordinatesystem.html
  - Release notes 0.11.0 / 0.12.0:
    https://eclipse.dev/elk/downloads/releasenotes/release-0.11.0.html,
    https://eclipse.dev/elk/downloads/releasenotes/release-0.12.0.html
- Empirical checks ran the pinned engine directly (script in the session
  scratchpad, results reproduced in "Probe results" below).

## What `graph()` sets today

`tools/layout.js` `graph(nodes, edges, { direction = "down", gap = 40,
layerGap = 60, ...arrowDefaults })` hands ELK exactly four root options:

| ELK option | value | from |
|---|---|---|
| `elk.algorithm` | `"layered"` | fixed |
| `elk.direction` | `DOWN` / `RIGHT` | `direction` (`"down"` \| `"right"`; anything else is a `LayoutError`) |
| `elk.spacing.nodeNode` | `gap` (default 40) | within-layer spacing |
| `elk.layered.spacing.nodeNodeBetweenLayers` | `layerGap` (default 60) | layer-to-layer spacing |

Everything else runs at the `layered` defaults. The ones that decide the picture
(from the algorithm page's default table):

- `edgeRouting = ORTHOGONAL` (the layered algorithm overrides the core
  `UNDEFINED` default: `supports org.eclipse.elk.edgeRouting = EdgeRouting.ORTHOGONAL`
  in `Layered.melk`). This matters twice: ELK is *already* routing every edge
  orthogonally and reserving corridors for them, and it flips
  `nodePlacement.favorStraightEdges` to `true` ("For an orthogonal style it is
  set to true, for all other styles to false").
- `cycleBreaking.strategy = GREEDY`, `layering.strategy = NETWORK_SIMPLEX`,
  `crossingMinimization.strategy = LAYER_SWEEP` with
  `greedySwitch.type = TWO_SIDED` (auto-activated below
  `greedySwitch.activationThreshold = 40` nodes), `nodePlacement.strategy =
  BRANDES_KOEPF` with `bk.edgeStraightening = IMPROVE_STRAIGHTNESS`,
  `thoroughness = 7`, `mergeEdges = false`, `separateConnectedComponents = true`,
  `compaction.postCompaction.strategy = NONE`, `spacing.edgeNode = 10`,
  `spacing.edgeEdge = 10`, `spacing.edgeNodeBetweenLayers = 10`,
  `spacing.edgeEdgeBetweenLayers = 10`, `padding = 12`, `randomSeed = 1`.

How the output is consumed:

- Nodes: `laid.children[i].x/y` only, `Math.round`ed, then pulled flush to the
  origin (ELK's 12px root padding is subtracted by min-x/min-y). Node sizes are
  passed in and never changed (`nodeSize.constraints` is empty by default, which
  the reference defines as "a node's size is already fixed and should not be
  changed").
- Edges: ELK's `sections` (`startPoint`, `bendPoints`, `endPoint`, `container`)
  are **discarded**. Each edge becomes a deferred `arrowBetween(source, target,
  { ...arrowDefaults, ...opts })`, so the arrow's endpoints are recomputed at
  `resolveArrows` time from the shapes' facing edges (overlap-centre or
  `originAt`/`landAt`), `standoff` applies, and any path comes from `via` or
  `route: "orthogonal"` (`elbow()`: leave level, one jog at the gap mid-line,
  arrive level).
- Determinism: ELK runs with `randomSeed = 1`; two runs of the same graph give
  identical `x/y/width/height/sections` — the only run-to-run difference is the
  internal `$H` hash ELK stamps on objects it is handed, which `graph()` avoids
  by feeding it a throwaway plain graph. The "byte-identical regenerate" claim in
  the code comment holds.

Docs (`skills/excalidraw-diagram/reference/authoring.md` "Laying out a graph")
state the same: "These four are the whole option surface: the algorithm is
always `layered`, and raw ELK options do not pass through."

## Option table

Defaults are the layered algorithm's as printed on its reference page. "Cost"
is what the primary source says or what the probe showed; where the source is
silent that is said.

### Spacing

| Option (`org.eclipse.elk.` prefix dropped) | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `spacing.nodeNode` | 20 | "The minimal distance to be preserved between each two nodes" — within a layer (`options/org-eclipse-elk-spacing-nodeNode`). **Already exposed as `gap`.** | Only a minimum: a long edge's dummy node sits between two real nodes and its own spacing (`edgeNode`) governs there, so neighbours of a corridor end up ~2×`edgeNode` apart, tighter than `gap` (probe: `gap: 40` yielded a 21px node-to-node gap around the skipping edge). |
| `layered.spacing.nodeNodeBetweenLayers` | 20 | "The spacing to be preserved between any pair of nodes of two adjacent layers." **Already exposed as `layerGap`.** | Edge bends live in this band; too small and orthogonal jogs stack against nodes. |
| `spacing.edgeNode` | 10 | "Spacing to be preserved between nodes and edges" — used for edges *crossing* a node's layer (i.e. long-edge corridors). | Widens the corridor a layer-skipping edge needs → pushes the layer's nodes apart (probe: 10→30 widened the drawing 285→325px). |
| `layered.spacing.edgeNodeBetweenLayers` | 10 | "spacing to be preserved between nodes and edges that are routed next to the node's layer" (the between-layer band). | Adds to the between-layers gap (probe: 10→30 grew height 288→298 and pushed the first bend further from the node). |
| `spacing.edgeEdge` | 10 | "Spacing to be preserved between any two edges … somewhat easily satisfied for the segments of orthogonally drawn edges, harder for general polylines or splines." | Parallel corridors spread wider. |
| `layered.spacing.edgeEdgeBetweenLayers` | 10 | "between pairs of edges that are routed between the same pair of layers" (the horizontal jog runs). | Separates stacked jogs so two edges never share a run. |
| `spacing.componentComponent` | 20 | Gap between disconnected components when `separateConnectedComponents = true` (default). | Only matters for a forest / several islands. |
| `padding` | 12 | Root inset. `graph()` already cancels it by pulling nodes flush. | none |

### Cycle breaking (phase 1)

| Option | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `layered.cycleBreaking.strategy` | `GREEDY` | "looks for cycles … determines which edges to reverse … Reversed edges will end up pointing to the opposite direction of regular edges." Values (Javadoc): `GREEDY` "greedy heuristic to minimize the number of reversed edges" (blog: "uses random decisions on ties"); `DEPTH_FIRST` DFS "uses the edge order as the iteration order"; `MODEL_ORDER` "respecting the initial ordering in the model file … used to identify backwards edges"; `GREEDY_MODEL_ORDER` greedy "but uses the model order as a tie-breaker"; `SCC_CONNECTIVITY` Tarjan SCCs then in-/out-degree ("quadratic runtime compared to the other approaches" — blog); `SCC_NODE_TYPE`, `DFS_NODE_ORDER`, `BFS_NODE_ORDER` (node-order variants); `INTERACTIVE` (needs prior positions). | Which edge gives way decides the reading order of a cyclic graph. `MODEL_ORDER` / `*_NODE_ORDER` make the **listing order of `nodes`/`edges` the tie-break**, which is what authoring.md today says nothing can do. |
| `layered.layering.layerConstraint` (per **node**) | `NONE` | "Determines a constraint on the placement of the node regarding the layering": `FIRST` "put into the first layer", `LAST` "put into the last layer" (`*_SEPARATE` are "used internally"). | Pins an entry/exit node regardless of cycle breaking — probe: constraining `u` `FIRST` in the cycle s→t→u→s moved it to the top layer and re-layered the rest. Cheap and exact. |

### Layering (phase 2)

| Option | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `layered.layering.strategy` | `NETWORK_SIMPLEX` | `NETWORK_SIMPLEX` "layered with minimal edge length"; `LONGEST_PATH` "according to the longest path to any sink"; `LONGEST_PATH_SOURCE` "…to any source"; `COFFMAN_GRAHAM` "restrict the number of original nodes in any layer" (advanced, pair with `coffmanGraham.layerBound`); `MIN_WIDTH`, `STRETCH_WIDTH` (experimental, width-reducing); `BF_MODEL_ORDER` / `DF_MODEL_ORDER` (experimental, follow model order); `INTERACTIVE`. | Default minimises total edge length (fewest layer-skips). `LONGEST_PATH*` is cheaper and stacks sources/sinks at one end — probe: it put `d` in the last layer beside `c` instead of beside `b`, widening the drawing (285→304px) and lengthening `a→d`. |
| `layered.layering.nodePromotion.strategy` | `NONE` | "Reduces number of dummy nodes after layering phase (if possible)" (Nikolov variants, percentage caps, model-order variants). | Fewer long edges → fewer corridors and bends, at the cost of taller/wider layers. Advanced. |
| `layered.layerUnzipping.strategy` | `NONE` | Splits a layer "into multiple sublayers while maintaining the existing ordering" — added in 0.11/0.12 (release notes: "layer splitting"). | For very wide layers only. |

### Crossing minimisation (phase 3)

| Option | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `layered.crossingMinimization.strategy` | `LAYER_SWEEP` | `LAYER_SWEEP` "sweeps through the layers, trying to minimize the crossings locally … Barycenter heuristic"; `MEDIAN_LAYER_SWEEP` "uses medians of node weights … In all other aspects, it behaves like LAYER_SWEEP" (new in 0.11.0); `NONE` "no crossing minimization. This requires to also set GreedySwitchType to off" — keeps the input order; `INTERACTIVE`. | Barycenter vs median is a coin-flip on real graphs (both are the classic Sugiyama heuristics); `NONE` + `considerModelOrder` is how you make listing order the layout order. |
| `layered.thoroughness` | 7 (lower bound 1) | "How much effort should be spent to produce a nice layout." Drives the number of layer-sweep iterations/random restarts. | Runtime vs crossings; **no effect on a graph too small to have alternatives** (probe: 1 and 50 gave identical output on 4 nodes). Worth raising only for dozens of nodes. |
| `layered.crossingMinimization.greedySwitch.type` | `TWO_SIDED` | "executed after the regular crossing minimization as a post-processor": `ONE_SIDED` "Only consider crossings to one side of the free layer"; `TWO_SIDED` "both sides"; `OFF`. | Already on for graphs under `activationThreshold` (40 nodes; "A '0' enforces the activation"). Exposing it buys nothing for sketch-sized graphs. |
| `layered.considerModelOrder.strategy` | `NONE` | "Preserves the order of nodes and edges in the model file if this does not lead to additional edge crossings": `NODES_AND_EDGES`, `PREFER_EDGES` ("node ordering is only used as a secondary criterion"), `PREFER_NODES`. | Makes `nodes`/`edges` listing order the tie-break for left-to-right placement — a **symmetry/predictability** lever the author controls by list order, free of crossings cost by definition. |
| `layered.crossingMinimization.forceNodeModelOrder` | `false` | "The node order given by the model does not change to produce a better layout … assumes … considerModelOrder.strategy to NODES_AND_EDGES." | Hard version: may add crossings. |

### Node placement (phase 4)

| Option | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `layered.nodePlacement.strategy` | `BRANDES_KOEPF` | `BRANDES_KOEPF` "groups nodes to blocks which result in straight edges" (four alignments, balanced or smallest-height); `NETWORK_SIMPLEX` "auxiliary graph and the NetworkSimplex algorithm to calculate a balanced placement with straight long edges"; `LINEAR_SEGMENTS` "aligns long edges using linear segments … pendulum method"; `SIMPLE` "Very simple and very fast … centers all nodes vertically" (blog: "not intended for serious use"); `INTERACTIVE`. | Probe on the 4-node graph: BK left the layer-skipping edge with two bends; `NETWORK_SIMPLEX` and `LINEAR_SEGMENTS` made it dead straight by shifting `a`. `NETWORK_SIMPLEX` is the slowest (network simplex per placement) but the straightest; `SIMPLE` centres every layer — the "symmetry" look, at the price of bends on every off-centre edge. |
| `layered.nodePlacement.favorStraightEdges` | auto (`true` under `ORTHOGONAL`) | "Favor straight edges over a balanced node placement." Requires BK or NETWORK_SIMPLEX. | `false` recentres (balances) blocks and reintroduces jogs (probe: `a→c` regained a bend). |
| `layered.nodePlacement.bk.edgeStraightening` | `IMPROVE_STRAIGHTNESS` | "tries to increase the number of straight edges at the expense of diagram size." | Already on. `NONE` gives a tighter but bendier drawing. |
| `layered.nodePlacement.bk.fixedAlignment` | `NONE` | "use a certain alignment (out of its four) instead of the one producing the smallest height, or the combination of all four" (`LEFTUP`, `RIGHTUP`, `LEFTDOWN`, `RIGHTDOWN`, `BALANCED`). Requires BK. | `BALANCED` is the symmetric choice; the four corners bias the whole drawing toward one side. |
| `layered.nodePlacement.networkSimplex.nodeFlexibility` | `NONE` | "Aims at shorter and straighter edges" by letting ports move (`PORT_POSITION`) or nodes grow (`NODE_SIZE*`). | Node growth would change measured node sizes — incompatible with "nodes arrive already measured". |
| `layered.nodePlacement.linearSegments.deflectionDampening` | 0.3 | Damping for the pendulum method. | Tuning knob only for LINEAR_SEGMENTS. |
| `layered.priority.straightness` (per **edge**) | 0 | "how important it is to keep an edge straight, i.e. aligned with one of the two axes … evaluated during node placement." | Lets one edge (the spine) win straightness; free. Siblings `priority.shortness`, `priority.direction`. |

### Edge routing (phase 5)

| Option | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `edgeRouting` | `ORTHOGONAL` (layered override of core `UNDEFINED`) | `ORTHOGONAL` axis-aligned sections with bend points; `POLYLINE` straight segments between layers (`polyline.slopedEdgeZoneWidth` = 2.0 softens bends near layer edges); `SPLINES` "bend point list … must be interpreted as control points for a piecewise cubic spline" (`splines.mode`: `CONSERVATIVE` "properly routed around the nodes but feels rather orthogonal", `SLOPPY` default "fewer control points … may result in edges overlapping nodes"). | Changing it changes node placement too (`favorStraightEdges` flips; probe: POLYLINE gave fractional y and a different `a`), and the house discards the sections anyway — so today it can only make placement *worse*. |
| `layered.mergeEdges` | `false` | "Edges that have no ports are merged so they touch the connected nodes at the same points … all such incoming edges share an input port, and all outgoing edges share an output port." | One origin per node (fan-out look, probe: `ab`/`ac`/`ad` all left `a` at x=72) instead of one port per edge spread along the side. |
| `layered.unnecessaryBendpoints` | `false` | "Adds bend points even if an edge does not change direction." | Only relevant if sections are read. |
| `layered.feedbackEdges` | `false` | "Whether feedback edges should be highlighted by routing around the nodes." | Reversed-edge routing style; only relevant if sections are read. |
| `portConstraints` (per **node**) | `UNDEFINED` (behaves as FREE) | `FREE` "All ports are free"; `FIXED_SIDE`; `FIXED_ORDER` "side … and the order of ports is fixed for each side"; `FIXED_RATIO`; `FIXED_POS`. | Requires modelling ports — the house has no ports (an arrow binds to a shape, and `originAt`/`landAt` pick the point). Not applicable without a port model. |
| `nodeSize.constraints` (per **node**) | empty set | "Empty size constraints specify that a node's size is already fixed and should not be changed"; `NODE_LABELS`, `PORTS`, `PORT_LABELS`, `MINIMUM_SIZE` let ELK grow nodes. | Must stay empty: node sizes are measured upstream and `place()` moves without resizing. |

### Compaction and the rest

| Option | Default | Documented effect | Cost / trade-off |
|---|---|---|---|
| `layered.compaction.postCompaction.strategy` | `NONE` | "whether and how post-process compaction is applied": `LEFT`, `RIGHT`, `LEFT_RIGHT_CONSTRAINT_LOCKING`, `LEFT_RIGHT_CONNECTION_LOCKING` ("Yields better results for average edge length"), `EDGE_LENGTH` ("instead of minimizing the width it minimizes edge length"). Advanced. | Compacts along the layer axis (the direction ELK calls "horizontal", i.e. between layers) after routing — shortens the drawing where layers have slack. No effect on the 4-node probe; pays on wide graphs. Operates on the orthogonal-routed graph. |
| `layered.compaction.connectedComponents` | `false` | Compacts disconnected components together. | Only for forests. |
| `separateConnectedComponents` | `true` | "Whether each connected component should be processed separately" — islands laid out independently then packed (`aspectRatio` 1.6 guides packing). | `false` layers all islands in one grid, which keeps a shared reading direction. |
| `layered.highDegreeNodes.treatment` | `false` | "Makes room around high degree nodes to place leafs and trees." | Star-shaped graphs only. |
| `layered.wrapping.strategy` | `OFF` | Splits a long layering into side-by-side chunks with wrapped edges. | For a preset that clamps width; heavy. |
| `randomSeed` | 1 | "If the value is 0, the seed shall be determined pseudo-randomly." | Keep at 1 — it is the determinism guarantee. |

## Probe results (elkjs 0.12.0, the pinned engine)

Graph: `a→b→c`, `a→c` (skips `b`'s layer), `a→d`; 120×48 nodes; `DOWN`;
`nodeNode 40`, `nodeNodeBetweenLayers 60` — i.e. exactly `graph()`'s options.

- **Default = ORTHOGONAL**: identical output with and without
  `elk.edgeRouting: ORTHOGONAL`. Layer 2 holds `d`(x 12–132), the corridor for
  `a→c` at x=142, `b`(x 153–273): ELK reserved a 21px channel (2×`edgeNode` +
  1px edge) *between* the nodes and routed the skipping edge through it, with two
  bends at y=80. The house's straight arrow for the same edge runs from `a`'s
  facing edge at the overlap centre (x=132) to `c` — exactly along `d`'s right
  edge here, and through `d` or `b` for any less lucky placement.
- **Bidirectional pair** `a⇄b`: ELK reversed one edge, stacked the nodes, and gave
  the two edges **distinct ports** (x=52 and x=92). The house draws both on one
  line — the `text-struck-by-arrow` case authoring.md documents.
- **`mergeEdges: true`** collapsed `a`'s three outgoing edges onto one port
  (x=72) — the fan-out look — and moved `a` flush left.
- **`nodePlacement` `NETWORK_SIMPLEX` / `LINEAR_SEGMENTS`**: `a→c` became a
  single vertical section (no bends) by moving `a` 40px right;
  `favorStraightEdges: false` under BK reintroduced a bend; `SIMPLE` centred each
  layer and gave the skipping edge **four** bends.
- **`layering: LONGEST_PATH`**: `d` dropped to the last layer beside `c`
  (sink-anchored), width 285→304.
- **`thoroughness` 1 vs 50**, **`postCompaction: LEFT`**: no difference on a graph
  this small.
- **Cycle** `s→t→u→s`: `GREEDY`, `DEPTH_FIRST` and `MODEL_ORDER` all reversed
  `u→s` (s on top). `layerConstraint: FIRST` on `u` moved `u` to the top and
  re-layered `s`,`t` below it — a direct answer to authoring.md's "Nothing in the
  option surface picks which edge gives way".
- **Determinism**: two runs differ only in the `$H` hash ELK stamps on the input
  objects; every coordinate and section is identical.

## Candidate exposure set

Principle: expose what an author can reason about as a **picture property**,
keep the engine's internals (phases, heuristics) behind it, and expose nothing
that changes node sizes or needs a port model the house lacks. Ranked by how
much picture it moves per line of surface.

1. **Reading-order pins — `layerConstraint` per node** (`{ first: [node], last: [node] }`
   or a per-node `layer: "first" | "last"` in a node-options slot). Aesthetic:
   the entry state sits at the top / left, the terminal state at the bottom /
   right, cycles or not. It is the only lever that fixes the documented
   "a cycle costs you the reading order" caveat exactly, and it is a single
   per-node ELK option (`elk.layered.layering.layerConstraint`). Recommend.
2. **Listing order as tie-break — `considerModelOrder.strategy: NODES_AND_EDGES`**
   (an `order: "as-listed"` boolean). Aesthetic: siblings appear left-to-right
   in the order the author listed them, when that costs no crossings —
   symmetry the author can steer, and a stable answer for `fromMermaid`, whose
   node order is the mermaid source order. Pair it with
   `cycleBreaking.strategy: GREEDY_MODEL_ORDER` so a cyclic graph's tie-break is
   also the listing order. Zero crossings cost by definition. Recommend.
3. **Straightness vs balance — `nodePlacement.strategy`** exposed as a
   two-value `placement: "straight" | "balanced"` (`NETWORK_SIMPLEX` vs BK with
   `favorStraightEdges: false` / `bk.fixedAlignment: BALANCED`). Aesthetic:
   bends. The probe shows `NETWORK_SIMPLEX` removing every bend on a spine that
   BK jogs; "balanced" centres blocks for the symmetric look. `LINEAR_SEGMENTS`
   behaved like NETWORK_SIMPLEX on the probe and `SIMPLE` is documented as not
   for serious use — neither needs a name. Recommend, second tier: since the
   house draws straight arrows anyway, what the author sees is whether centres
   line up — which is exactly what "straight" delivers.
4. **Corridor spacing — `spacing.edgeNode` and `spacing.edgeNodeBetweenLayers`**
   (one `edgeGap` number, applied to both). Aesthetic: how far a skipping edge
   stays from the nodes it passes, and how far the first bend sits from a node.
   Only pays off once the house reads ELK's routes (see verdict) or when an
   author writes `via` waypoints along the corridor ELK left; today it only
   widens the drawing. Defer until routing is read back.
5. **`mergeEdges`** as `fanOut: true` on the graph: one departure point per
   node, matching the house `fanOut` vocabulary. Aesthetic: the fan-out pattern
   instead of ports spread along a side. Only observable once routes are read
   back (the house already leaves arrows from the overlap centre); defer with 4.
6. **`thoroughness`** — expose only as an internal ramp with node count (e.g.
   7 below 40 nodes, higher above), never as an author option: it is a
   runtime/quality dial with no picture meaning and no effect on sketch-sized
   graphs.

Do **not** expose: `edgeRouting` (POLYLINE/SPLINES only degrade placement
while the sections are discarded, and would change `favorStraightEdges`
behind the author's back); `portConstraints` and `nodeSize.*` (no port model,
sizes are measured upstream); `crossingMinimization.strategy` and
`greedySwitch.*` (heuristic choice with no author-visible semantics —
`NONE` is subsumed by exposure 2); `layering.strategy` (default already
minimises edge length; the alternatives only redistribute sources/sinks);
`randomSeed` (determinism guarantee); `compaction.postCompaction.*`,
`wrapping.*`, `highDegreeNodes.*`, `layerUnzipping.*` (large-graph tools
outside the ≤ ~80-element sketch ceiling and the one-idea-per-frame band).

Every exposed option must keep `graph()`'s contract: nodes measured upstream,
positions rounded to whole pixels, output byte-identical on regenerate. All six
above do.

## Verdict: can ELK's orthogonal routing supply the arrow paths?

**Yes, mechanically — but only as a source of `via` waypoints, and it is a
change to what `graph()` returns rather than a swap for `route: "orthogonal"`.**

What the evidence says:

- ELK already routes orthogonally and **already reserves a corridor** between
  the nodes of a skipped layer (dummy nodes with `edgeNode` spacing on both
  sides). Reading `sections[0].startPoint / bendPoints / endPoint` back would
  give every layer-skipping edge a path that avoids the intermediate nodes by
  construction — the case that today ends in `arrow-crossing` and a hand-written
  `via`. Coordinates come back in the root's frame (`container: "root"` for a
  flat graph), so the same origin shift `graph()` applies to nodes applies to
  the points.
- The per-arrow `route: "orthogonal"` is not what gets replaced. It only ever
  produces a **single mid-gap jog** between two shapes; it knows nothing about a
  third shape, and by its own comment it is safe precisely because it stays
  inside the gap the `usable` check vouched for. ELK's route does the thing
  `route` cannot: go *around*. So the honest framing is: `graph()` gains a
  `route: "engine"` (or does it by default) that fills each arrow's `via` with
  ELK's bend points, and `route: "orthogonal"` stays the two-shape helper.

What has to be reconciled — none of it is a blocker, all of it is work:

1. **Endpoints.** ELK's `startPoint`/`endPoint` sit on the node border at the
   port ELK chose (one port per edge, spread along the side — the probe shows
   `a`'s three edges leaving at x=72/102/132). `resolveArrow` recomputes
   endpoints from the shapes (overlap-centre or `originAt`/`landAt`) and adds
   `standoff`. Feeding only the **bend points** as `via` and letting
   `resolveArrow` keep the endpoints leaves a kink where ELK's first segment
   meets the house's endpoint. The clean version derives `originAt`/`landAt`
   from ELK's port position (fraction along the facing edge) so the first and
   last segments stay axis-aligned, then applies standoff along that axis.
   That also fixes the **two-way pair** for free — ELK gives the two edges
   distinct ports (x=52 / x=92 in the probe), so the return leg no longer runs
   over the label of the outgoing one.
2. **Deferred arrows and movers.** ELK's coordinates are valid only for the
   node positions it produced. `arrowBetween` is deferred so that a later mover
   (composing `g` into a band) still resolves correctly. Bend points would need
   to be stored **relative to the group** (or to the source node) and
   translated at resolve time; and if an author hand-moves one node after
   `graph()`, the stored route is stale. Rule: the route is honoured while the
   nodes move as a group; a node moved on its own falls back to the direct
   arrow (or refuses — the gate will say `arrow-crossing` anyway).
3. **Gate compatibility.** The gate walks the polyline and checks depth inside
   unrelated solid shapes (`verify.js` rule 9). ELK's routes clear nodes by
   `edgeNode` (10px default), well above the 2px run tolerance, and the segments
   are axis-aligned so `segmentLengthInsideShape` is exact. `arrow-buried` /
   `text-struck-by-arrow` are unaffected because endpoints and labels stay
   house-owned. Nothing in the gate needs to change; `arrow-crossing` becomes
   rare for engine-routed graphs rather than a documented expectation.
4. **Labels.** Bound labels centre on the arrow's own path; ELK's edge-label
   placement (`edgeLabels.*`) is not needed and should stay off — labels remain
   house-measured and house-placed.
5. **Rounding.** ELK returns fractional bend coordinates under some placers
   (POLYLINE gave `122.73…`; ORTHOGONAL with the default BK placer gave
   integers, `SIMPLE` gave `.5` values).
   Round bend points as nodes are rounded, and the byte-identical regenerate
   holds.
6. **Corridor width vs `gap`.** With routes read back, `spacing.edgeNode`
   becomes visible (exposure 4) and an author who asked for `gap: 40` will see
   two nodes 21px apart flanking a corridor. Either document it or set
   `edgeNode` from `gap` (e.g. `gap / 2` each side, so the corridor is `gap`
   wide).

**Recommendation.** Do it as an opt-in on `graph()` first (`route: "engine"`
per graph or per edge), keep `route: "orthogonal"` and `via` untouched, and
promote it to the default once `examples/` bands and `tests/layout.js` cover
the layer-skip and two-way cases. It is the one change that removes a
documented failure mode (`arrow-crossing` on layer-skipping edges) instead of
asking the author to hand-write around it.
