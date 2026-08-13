# Anti-patterns

What to hunt in the frame renders. The gate (`check.js`) catches what a rule
can decide — geometry, contrast, fonts, file integrity; everything below is a
judgment call that passes every rule and is still wrong — which is why step 5
exists. Each entry: the symptom as it appears in the PNG, then the fix.

## Gate-blind — only the picture shows these

**A label on top of the drawing it names.** Text over a shape is often exactly
right, so no rule can forbid it — but stacked regions, table cells and bars
leave no room above themselves, and a label placed there lands on its
neighbour. Move the labels into a column beside the drawing
([authoring.md](authoring.md), Composing layout).

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
failed, so every measurement in the file is wrong. The warm now refuses loudly
(`FontIntegrityError`), so a written file showing this symptom predates that
guard: re-run the generator with the current tools — a layout nudged against
fallback metrics breaks again the moment the real fonts load.
