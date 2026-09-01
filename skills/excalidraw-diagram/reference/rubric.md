# Rubric

The house rules a diagram is scored against. **Tier A** is scored: step 5's
read-back marks each rule `pass` / `fail` / `n-a` with one line of evidence.
**Tier B** is judged in prose and never counted — it is the half where a pair of
eyes beats a statistic.

**Scope** is what one score covers:

| scope | one score covers |
|---|---|
| `picture` | the whole file |
| `panel` | one frame — or the whole picture, where the file has no frames |
| `band` | the row of panels, compared against each other |

**Channel** is how the rule reaches you: **P** this file and SKILL.md, **A** an
advisory `check.js` measures, **L** a layout primitive that gets it right by
construction. A row naming an advisory links
[problem-codes.md](problem-codes.md#advisory-codes) — the registry row is the
source for what the code measures and the number it measures against, so no
threshold is repeated here.

## Tier A — scored

| # | Rule | Scope | Channel | Advisory |
|---|---|---|---|---|
| 1 | No arrow crosses another arrow. The advisory carries the crossing angle; the angle is evidence, never an excuse | `picture` | A + P | `arrows-cross` |
| 2 | The aspect matches the surface the diagram was authored for | `panel` | A + P | `aspect-off-preset` |
| 3 | A title states the diagram's scope, in sentence case — on a band, each frame's name | `picture` | P | — |
| 4 | Every encoding on canvas — role hue, stroke style, arrowhead — is decodable from a legend or an in-place label, and the legend never contradicts the strokes. A legend is required at two or more role hues, or any non-default stroke style or arrowhead; one hue beside grey needs none | `picture` | P | — |
| 5 | Role hues stay under the ceiling, grey excluded; `pass` and `fail` are never told apart by hue alone — a second channel, a ✓/✗ glyph or a stroke style, always rides with red and green | `panel` | A + P | `too-many-hues`, `hue-only-pass-fail` |
| 6 | Within any one `graph` layer or row, elements of the same type share a size — widths within 1.25× of each other. Measure the widest member first and size the rest to it | `picture` | P | — |
| 7 | Every arrow bound between two shapes carries a label naming its intent. A headless line between two shapes is structure — a spine, a divider — or it is an arrow that lost its label | `picture` | P | — |
| 9 | Every arrow reaches its target inside the bend budget. The route is the engine's job — `graph` reads its routes back, so a hand-routed elbow is the exception that needs a reason | `picture` | L + A | `too-many-bends` |
| 10 | Every text clears its surface's font floor at embed scale | `picture` | P + A | `font-below-floor` |
| 11 | Stroke widths run the 1:2:4 ladder against the depth tiers — leaders and arrows thinnest, the register in the middle, at most one focal element at the top. Three widths, no fourth | `panel` | P + A | `flat-stroke-weight` |
| 12 | An arrow segment keeps clear of every shape, text and arrow label it is not bound to | `picture` | A | `arrow-crowding` |
| 13 | Panel widths stay within the drift bound of each other. Per-frame export frames without scaling, so a narrow panel projects its type larger than a wide one beside it | `band` | A + P | `panel-width-drift` |

Rule 8 — centring and occupancy — is **Tier B** below. A frame fits itself
around its children at a fixed inset, so per-frame centring can never fail; what
is left to judge is a comparison across the row.

## Tier B — judged in prose

**Panels of one band read at comparable content weight.** Rule 8's band form: a
cramped panel beside an empty one passes every check and together they read as
an accident. Rebalance the content, or split the dense panel in two.

**A label sits beside the drawing it names, not on top of it.** Text over a
shape is often exactly right, so no rule forbids it — but stacked regions, table
cells and bars leave no room above themselves, and a label placed there lands on
its neighbour. Move the labels into a column beside the drawing
([authoring.md](authoring.md), Composing layout).

**One abstraction level per diagram.** A supporting element earns its place by
being directly connected to the scope the title states.

**Sequence flows left to right, hierarchy top to bottom**, entry point leading.
An ingested Mermaid graph's orientation is chosen for the surface, never copied
from the source.

**Relationship semantics are stated once per diagram** — dependency or data
flow, one of them, said in the legend or the title.

**Charts state the delta.** The argument is the change, so the axis covers the
maximum and an ordered scale is one hue in lightness steps. Red against green
for before and after reads as pass and fail.

**The small-multiples inversion.** [patterns.md](patterns.md) asks consecutive
panels for different patterns, because a repeated layout carries no information.
Where consecutive panel claims differ in **exactly one named variable**, that
inverts: the panels take the **same** pattern, because the difference is the
content and any other difference is noise. Two or more variables and the
original rule returns. The panel list from step 1 is where the variable is
named, so it is what this is judged against.

**Architecture elements carry a type or technology line.** A box labelled
`Orders` names less than one labelled `Orders — Postgres 16`.
