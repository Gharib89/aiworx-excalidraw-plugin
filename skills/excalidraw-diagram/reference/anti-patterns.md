# Anti-patterns

What to hunt in the frame renders. The gate (`check.js`) sees geometry that is
*illegal*; everything below is legal geometry that is still wrong — which is why
step 5 exists. Each entry: the symptom as it appears in the PNG, then the fix.

## Gate-blind — only the picture shows these

**Two free texts sitting on each other.** Siblings that overlap are legal
geometry. Wrap prose to the distance to the *next drawn thing*, not the card's
inner width (see [authoring.md](authoring.md), free-text wrapping).

**A label on top of the drawing it names.** Stacked regions, table cells and
bars leave no room above themselves. Labels go in a column beside the drawing
with dashed leaders — and a leader routes around a sibling, not through it.

**An arrow slicing through an unrelated shape.** A bound two-point arrow takes
the straight line, whatever is in the way. Route around with explicit `points`
(the elbow flag does not route — see [authoring.md](authoring.md)).

**An arrowhead buried inside its target.** The head should stop at the edge;
landing on the target's label reads as a strike-through. End a multi-point
arrow short of the shape and let the binding gap hold.

**A cramped panel beside an empty one.** Both pass every check; together they
read as an accident. Rebalance the content, or split the dense panel in two.

## Style drift — the rules exist, the render is where they slip

**Two consecutive panels on the same pattern.** The layout stops carrying
information and the reader falls back to reading every word
([patterns.md](patterns.md)).

**One hachure card among solid ones, or roughness varying card to card.**
Finish is a register chosen once per diagram; drift reads as unfinished
([patterns.md](patterns.md), Finish).

**A marker colour doubling as a card fill.** Gold prose on a gold card is the
same colour doing two jobs, and the marker stops reading as a marker
([palette.md](palette.md)).

**Code reshaped by ligatures.** Cascadia renders `!=` as `≠`, `...` as `…`.
Where the point is what the file literally says, keep ASCII and expect the
reshape ([palette.md](palette.md)).

## Symptom of a broken toolchain, not a broken diagram

**Every family renders identical, vaguely serif text.** The font warm-up
failed and every measurement in the file is wrong. Do not nudge the layout —
re-run the generator and check `fontStatus()`; a layout fixed against fallback
metrics breaks again when the real fonts load.
