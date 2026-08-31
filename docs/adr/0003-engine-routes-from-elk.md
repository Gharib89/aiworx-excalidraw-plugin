# ADR-0003 — Engine routes: `graph()` reads ELK's own path back, and the house stops hand-routing around nodes

- **Status**: accepted
- **Date**: 2026-08-27
- **Context**: ticket #200; decided in #194, mechanics researched in #188
- **Reverses**: the "the house draws the edges, not ELK" principle stated in
  `tools/layout.js` since `graph()` landed

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
- **Edge labels remain the author's problem.** ELK spaced its ports for arrows,
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
