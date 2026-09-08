# ADR-0003 — Engine routes: `graph()` reads ELK's own path back, and the house stops hand-routing around nodes

- **Status**: accepted
- **Date**: 2026-08-27
- **Context**: ticket #200; decided in #194, mechanics researched in #188
- **Reverses**: the "the house draws the edges, not ELK" principle stated in
  `tools/layout.js` since `graph()` landed
- **Amended**: ticket #220 — the cut's group is sized to its routes (see
  [Amendment](#amendment--the-cuts-group-is-sized-to-its-routes-220-2026-09-07))
- **Amended**: ticket #214 — the house owns the flow coordinate of the leading
  and trailing run (see
  [Amendment](#amendment--the-house-owns-the-flow-coordinate-of-the-leading-and-trailing-run-214-2026-09-08))
- **Amended**: ticket #210 — ELK is told a label's extent, and only its extent
  (see
  [Amendment](#amendment--elk-is-told-a-labels-extent-and-only-its-extent-210-2026-09-08))

## Context

`graph()` handed ELK a plain graph, read the node positions back, and threw the
routing away: every edge became a bound `arrowBetween` on the straight run
between two standoff endpoints. The principle was stated in the code — *"The
house draws the edges, not ELK"* — and it bought something real. A house-drawn
edge keeps its label, its standoff, its arrowheads, its bindings and its gate
checking, all shared with every hand-written arrow, and none of that would
survive an arrow the engine owned.

The cost fell on the author. ELK places nodes in layers, so a **layer-skipping**
edge passes the nodes in between; drawn straight it runs through them, and the
gate refuses it as `arrow-crossing`. The documented way out was to hand-route
that one edge with `via` — absolute waypoints, which by the **last mover** rule
must be written after every layout call that still moves the shapes, and
recomputed by hand whenever a spacing option changes.

That workaround was the baseline's largest single cost: **15 of the 17 refusals**
in `bench/runs/0.7.0/` were `arrow-crossing` / `text-struck-by-arrow` on
hand-routed edges, and one brief cost **\$9.18 / 56 minutes** (#190). The
geometry needed was never missing — ELK reserves a corridor around every node
(`elk.spacing.edgeNode` across the flow and
`elk.layered.spacing.edgeNodeBetweenLayers` along it, 10px each by default,
`edgeGap` and `edgeLayerGap` since #202) and routes the
long edge through it. It was computed, returned on `laid.edges[].sections`, and
discarded.

## Decision

The house still **owns** the edges; ELK **routes** them.

1. **Every edge stays a bound `arrowBetween`.** Labels, standoff, arrowheads,
   bindings, the finish register and gate checking are untouched. Only the
   intermediate points, and the cross coordinate of each endpoint, now come from
   ELK. This is the half of the old principle that was load-bearing, and it is
   kept in full.
2. **`route` names four states, three of them values.** `"engine"` is ELK's path
   and `graph()`'s default; `"orthogonal"` is the existing single mid-gap jog;
   `"direct"` is the straight run, previously the unnamed default and now sayable
   out loud. `route` was accepted before this change only as `"orthogonal"`, so
   the value set grows and nothing in it moves.
3. **An engine route lives on the deferred arrow, group-relative.** It is stored
   as the bend list plus each endpoint's cross coordinate, all in the graph
   group's own frame and on whole pixels, and it resolves in `resolveArrow`
   alongside the endpoints. Group-relative because the band idiom
   (`row(panels.map(p => p.g))`) is a **later mover**: absolute bends would be
   left behind exactly as `via` is. Resolved late because that is what keeps
   `arrowBetween`'s call order free.
4. **A stale route drops to the straight run, silently and safely.** The corridor
   was cut against the whole placement ELK had just made, so it holds only while
   every node in the graph still sits — and still reaches — where ELK left it,
   measured against the group. A node moved or resized on its own invalidates it,
   whether it is an endpoint or the bystander the corridor went around. Bends
   aimed at where a node used to be are the exact refusal this change removes.
   An edge whose sections ELK returns as anything other than one readable
   section takes that answer a pass earlier, at `graph()` rather than at
   resolve: `route` becomes `"direct"`,
   so a future elkjs that splits a section across containers degrades to the
   pre-#200 drawing instead of refusing a call that used to work.
5. **The author placing an endpoint revokes the route.** An `originAt`/`landAt`,
   or a `via`, means the author owns the path; the corridor was cut for ELK's
   ports, and moving one endpoint off its port leaves the first or last segment
   running diagonally into a bend list it no longer meets — measurably worse
   geometry than the straight run those fractions were picked against. One party
   owns the path, and it is whoever spoke last.
6. **`engine` is graph-only.** There is no engine behind a hand-composed
   `arrowBetween`, so asking for one there refuses rather than quietly drawing
   straight — the answer to a question nobody asked is not a straight line.
7. **No gate change.** ELK clears nodes by 10px, an order above
   `arrow-crossing`'s 2px run tolerance (`tools/verify.js`), so the rules that
   refused the old geometry pass the new geometry unmodified.

## Considered options

- **`route: "orthogonal"` as the swap** (#188): rejected. The elbow owns only the
  gap between its own two shapes and jogs inside it — it cannot go *around* a
  third shape, which is the entire failure.
- **ELK's `POLYLINE` / `SPLINES` `edgeRouting`**: rejected. Both degrade the
  placement `layered` produces, and the placement is what `graph()` is for.
- **A second, routing-only ELK pass** over the house's own positions: rejected.
  ELK routes *because* it placed; a router handed foreign coordinates has no
  corridors reserved and no reason to agree with the layout.
- **Keeping the bends under an author's `originAt`/`landAt`** rather than
  revoking: rejected on measurement. Tried on `examples/triage-graph`, it moved
  the struck-label clearance from 2.2px to 0px — a hybrid path is worse than
  either party's path alone.
- **Feeding ELK the edge labels** so it spaces ports around them: rejected *for
  now*, on a boundary rather than a preference. `graph()` receives nodes already
  measured but a label as text, and `tools/layout.js` measures no text by design
  (`tests/chromeless.js` holds it Chrome-free). Filed rather than forced.
  **Accepted in the #210 amendment**, boundary intact: the author measures the
  label and `graph()` forwards the extent.

## Consequences

- The `route` option's value set is the public surface that grew; `via`,
  `originAt`, `landAt`, the refusals and the `{ g, arrows }` shape are unchanged.
  A `graph()` call written before this change draws different arrows — better
  ones — which is a **visual** break in a regenerated artifact and no API break.
- `CONTEXT.md` gains **Engine route**, and **Last mover** gains the clause that
  separates the two: `via` still belongs after the last mover, an engine route
  does not.
- `reference/authoring.md` loses the hand-routing instruction. Prose telling an
  author to work around something the tool now does costs author turns, so it
  goes rather than gets qualified.
- **Edge labels remain the author's problem** — **superseded by the #210
  amendment**, which tells ELK a measured label's extent and deletes the band's
  fractions. What follows is the state before it. ELK spaced its ports for arrows,
  never having been told the labels exist, so a labelled fan can still put one
  arrow through a neighbour's label. `examples/triage-graph` still carries
  `originAt`/`landAt` for exactly that reason — the hand-routing is gone, the
  label nudging is not. (Since #201 those fractions also spread a fan across its
  source's facing edge, which the engine ports alone leave stacked; the count per
  band moves with the layout, so read the generator rather than a number here.)
  Since #202 the band's two-way pair carries **no** label: where the engine
  settles a pair diagonally apart, both legs run near the same diagonal and a
  fraction moves an endpoint without moving the midpoint the label rides at, so
  no number clears it. The label comes off rather than the pair getting a `via`
  back.
- The corridor check is O(nodes) per edge at resolve. Diagrams are tens of
  elements; a graph large enough for that to matter is out of `graph()`'s stated
  scope already (flat, `layered` only).

## Amendment — the cut's group is sized to its routes (#220, 2026-09-07)

Decision 3 holds an engine route in the graph group's own frame, and the group
was sized to the **nodes** ELK placed. A back edge routed around the outside of
the layout therefore reached past the box every mover spaces off, and the author
stacking a note under the graph had to guess a gap and re-run until the gate
stopped saying `text-struck-by-arrow` — 2px past the box at the defaults, 32px
at `edgeGap: 40`. So the group's extent is now the bounding box of the placed
nodes **together with** every engine route `graph()` hands out: the origin the
nodes are pulled flush against is the minimum over both, and `width`/`height`
reach the maximum over both. A graph whose routes stay inside the node envelope
is unchanged, node offsets and bends included, which is why every committed band
keeps its geometry.

Two alternatives were rejected. **Documenting the gap** — telling the author to
leave room — fails on information: the overhang is a number only ELK knows, and
only after it has routed, so the author cannot compute what the prose asks them
to leave, while `graph()` holds it at the moment it builds the group. **Including
the ink** — stroke width, arrowheads, a bound label riding an outer segment —
was rejected as the wrong owner: ink is what the gate measures, and a group that
grew by half a stroke would move every band that composes one. Path geometry
only, so the extent is exactly what the route record already carries.

The extent follows the **picture**, not the record: an edge that draws no engine
route adds nothing to the box. That takes in an edge the author routes (`via`, or
its own `route`) and — by decision 5 — one whose `originAt`/`landAt` revokes the
route at resolve, which is the case the band actually carries.

This amends the shape of `g`, not the contract: `{ g, arrows }` and every option
are as decision 2 and the consequences above describe them. It is a **visual**
break in the same sense the original change was — a graph with an overhang
regenerates with different offsets inside its group — and no API break.

## Amendment — the house owns the flow coordinate of the leading and trailing run (#214, 2026-09-08)

Decision 1 gave the house the two endpoints and ELK everything between them. The
corridor ELK turns inside (`edgeLayerGap`) and the `standoff` the house starts
from are independent distances, though, so a bend could land *behind* the point
the arrow starts from along the flow — or past the point it ends at — and the
route doubled back over itself before turning. At the defaults the two coincide
and nothing shows; a `standoff` above the corridor, or an `edgeLayerGap` below
the standoff, and the layer-skipping edge grew a stub pointing the wrong way. No
gate rule catches it: the doubled segment runs along a node's border rather than
through its ink.

So the house owns the flow coordinate of the leading and trailing **run**, not
only of the two endpoints: a bend outside the endpoints' span is pulled onto the
endpoint it overshot. ELK keeps every cross coordinate, and with it the path it
found around the nodes — the pull moves a bend along the flow only, which is the
axis the standoff already owned. Where the two distances coincide the bend lands
on the endpoint and drops as the zero-length segment it now is, so every
committed band keeps its geometry.

The pull needs a clear pixel to act on. Bends are held on whole pixels in the
group's frame by decision 3 while a measured node box is not, so a bend
routinely sits a fraction outside the span with the route never doubling back:
that fraction is the rounding, and pulling it would move bends every band
already draws correctly. A backtrack worth removing is the whole standoff beyond
the corridor, an order above the rounding, so the clamp acts only past a pixel.

Three alternatives were rejected. **Trimming** the bend the standoff already
passed, instead of clamping it: dropping the bend outright leaves the leading
segment running diagonally from the endpoint to the bend after it, the same
worse-than-either geometry decision 5 revokes a hybrid path for. **Dropping to
the straight run** when a bend falls behind its endpoint: the layer-skipping
edge is the one that hits this, and straight it crosses the node ELK went
around, an `arrow-crossing` refusal, which is the thing this ADR exists to
remove. **Refusing the combination at `graph()`**: not well-defined there.
`standoff` is a per-edge arrow option resolved long after layout, so `graph()`
cannot know the value a bend list will be measured against.

This amends who owns a coordinate, not the contract: `{ g, arrows }`, `route`
and every option are as decision 2 and the consequences above describe them.
Like the original change and the #220 amendment it is a **visual** break only
where the geometry was wrong — a diagram that drew a backtrack regenerates
without one.

## Amendment — ELK is told a label's extent, and only its extent (#210, 2026-09-08)

**Feeding ELK the edge labels** was rejected above on a boundary: `graph()`
receives nodes already measured but a label as text, and `tools/layout.js`
measures no text by design. That boundary holds and the rejection is lifted
anyway, because the measuring never had to happen in `layout.js`. `authorDiagram`
already hands the author `measure` and `wrap`; it now also hands them
**`label(text, { fontSize, fontFamily })`**, which measures one arrow label and
returns the string carrying its own `width` and `height`. An edge label that
arrives at `graph()` with an extent is forwarded to ELK as an edge label;
`layout.js` measures nothing, and `tests/chromeless.js` still holds it Chrome-free.

What crosses the boundary is the extent, and only the extent. Three rules make
that precise:

1. **The extent is spent on the layout and dropped.** `arrowBetween` strips
   `width`/`height` off a label spec before the drawn element sees them —
   the pipeline re-centers and re-measures bound text every pass and owns that
   size (**Bound label**), so an author-supplied dimension reaching the element
   would be overwritten at best and disagree at worst.
2. **ELK's label *coordinates* are ignored.** The engine returns a position for
   every label it was told about; a bound label rides at the middle of its own
   arrow by the same rule, so the position is read by nobody. Only the space
   reserved for it changes the picture.
3. **Placement is hard-wired to `inline`.** The label sits *on* its route rather
   than beside it, which is where the renderer's mask can hide the arrow's own
   path behind it. Measured: `elk.edgeLabels.inline` set per-label narrows the
   band's fan from 310px to 274px, and the same option set at graph level is
   **ignored** — 310px, the default placement — so it is written into each
   label's own `layoutOptions` and exposed as no option at all.

The engine also wants the label's `text`, not just its box: an ELK edge label
with `width`/`height` and no `text` is **discarded silently** and the layout
comes back byte-identical to one with no labels at all (measured on a three-leg
fan: 528x168 and label positions at `(0,0)` without `text`, 528x246 with it).
So the forwarded extent carries the string. It is the one place the author's text
reaches the engine, and it reaches it as a measurement, never as something the
engine renders.

Alongside it, `graph()` gains **`routeGap`** — `elk.spacing.edgeEdge` and
`elk.layered.spacing.edgeEdgeBetweenLayers`, 10px like its siblings. The
**Corridor** the engine reserves around a node had two axes (`edgeGap`,
`edgeLayerGap`); this is the same idea between two routes rather than a route and
a node, which is what a label extent makes worth spending: legs pushed apart to
clear each other's labels are legs that now need room from each other.

Consequence: the **Edge labels remain the author's problem** consequence above is
superseded. A measured label beats a fraction at the job the fractions in
`examples/triage-graph` were doing, and beats it while *keeping* the route that
decision 5 revokes — so the band regenerates with every `originAt`/`landAt`
deleted, gate-clean in both frames, every edge on its engine route. Two limits
survive: a fan's **departure ports** do not spread by extent (`routeGap` moves
routes, never the port a route leaves from), and the band's **two-way pair**
still carries no label for the reason #202 recorded, since an extent moves both
legs of a diagonal pair together and the midpoint each label rides at moves with
them. And the `placement` strategy still decides how far apart a fan's legs
leave, so a label wide enough to need more room than the strategy leaves is
cleared by changing the strategy, not by measuring harder: the band buys its
clearance with `placement: "straight"` and pays in `too-many-bends` advisories.

This amends what ELK is told, not the contract: `{ g, arrows }`, `route` and
every existing option are as decision 2 and the consequences above describe them.
It is a **visual** break in the same sense as the original change — a labelled
graph regenerates with the engine spacing the labels, which is different and
better geometry — and no API break; `label()` and `routeGap` are both additions.
