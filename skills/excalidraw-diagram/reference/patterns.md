# Patterns

## Match the shape to the behaviour

| The idea | The pattern |
|---|---|
| one input produces many outputs | fan-out — arrows radiating from a single source, written by `fanOut` |
| many inputs become one | funnel — arrows converging, narrowing to the result |
| a fixed order of steps | timeline — a line with dots, labels beside each dot |
| a hierarchy | tree — trunk and branch lines, free text at the nodes |
| states and the transitions between them, or what depends on what | graph — nodes in layers the edges decide, laid out by `graph` instead of by hand |
| a loop that repeats until done | cycle — the last arrow returning to the first element |
| two things that differ | side by side, same size, one visual difference carrying the point |
| a threshold or cutoff | a scale with the cutoff drawn on it and items placed either side |
| a transformation | before and after, with the transforming step between them |
| something measured | a chart with real numbers on it |
| a coordinate or format change | the same object drawn twice, once in each space |
| an abstract context | overlapping ellipses, no hard boundary |
| a phase change | a gap — whitespace or a divider doing the work of a sentence |

For a band, give consecutive panels different patterns. Five panels using the
same card grid means the layout carries no information and the reader falls back
to reading every word.

A worked pass. Claim: "the gate rejects most candidates." First draft: three
cards labelled *candidates*, *gate*, *survivors* — strip the labels and three
equal boxes remain, arguing nothing. Second draft: eleven small squares converge
on a narrow gap and three emerge — strip the labels and the claim survives:
many in, few out. The funnel *is* the claim; the cards were only naming it.

## Shape meaning

| Element | Use |
|---|---|
| `rectangle` | a step, a component, a thing that acts |
| `ellipse` | a start or an end; small ones (10–20 px) as timeline dots and anchors |
| `diamond` | a decision with named branches |
| `line` | structure — trunks, timelines, dividers, spines |
| `arrow` | a real relationship, bound at both ends |
| `frame` | one panel of a band, named for the claim it lands |
| `text` | labels, prose, code, numbers |

Arrowheads are vocabulary too — `startArrowhead` / `endArrowhead` on the
skeleton arrow:

| head | means |
|---|---|
| `arrow` (default) | flow, causation |
| `triangle` | emphatic flow — the main path |
| `diamond` | ownership, composition — UML style |
| `circle` | a terminal state, a fixed endpoint |
| `bar` | a boundary, a stop |
| `null` | a plain connector — relation without direction |

A data-model or UML diagram drawn with only default heads says less than it
could; a flow diagram mixing heads for decoration says more than it means. Both
heads are part of the finish register below, so a diagram whose arrows all mean
the same thing sets them once instead of per arrow.

## Finish

Finish is a **register**, chosen once per diagram and set once. This file is the
vocabulary — what each value means; [authoring.md](authoring.md) is the
mechanism — the `register:` option, the properties it governs, and how a
per-element value breaks it deliberately.

`roughness: 1`, `fillStyle: "solid"`, `strokeWidth: 2` is the house voice —
hand-drawn line, confident fill. Drop to `roughness: 0` where precision *is* the
content: chart axes, a mocked page, anything carrying real numbers. `hachure`
means explicitly unfinished — a placeholder, a not-yet — so a hachure card in a
finished diagram reads as an accident. Roughness 2 stays unused: past 1 the
shake reads as noise, not charm. `strokeStyle` joins the register at `"solid"`;
`"dashed"` and `"dotted"` mean provisional or inferred, so they are a
per-element break rather than a whole-diagram voice.

Drift is what to hunt in the render: one hachure card among solid ones, or
roughness changing card to card. Every value in the register is legal on its
own, so nothing refuses the mix — it simply reads as unfinished.

## Depth

Opacity is a depth cue with three tiers: 100 for the elements carrying the
story, ~50 for supporting context, ~20 for ghosts — a previous state, a road
not taken. A fourth tier reads as mud.

Excalidraw has no shadows or gradients; when depth matters, compose it: a
shadow is the shape duplicated behind itself, offset a few px in grey; a
gradient is two or three same-hue shapes stacked at descending opacity.

## Show the thing, not its name

A box labelled "config" teaches nothing. The actual line —
`images_scale = 2.0` in Cascadia — teaches the reader what to type. Prefer
concrete content wherever it exists:

- the real code, API call or CLI invocation
- the real payload or file excerpt, trimmed to what matters
- the real numbers, with units
- a drawn mock of the real output — a page, a table, a chart, a folder

When a diagram explains code, every claim in it should be traceable to a line in
that code. A diagram that invents plausible detail is worse than one that omits it.

## Containers, sparingly

Free-floating text is the default. Add a box when the text is a thing in the
system, when an arrow must land on it, or when it groups other elements. Section
titles, captions and annotations need no box — size and colour already rank them.

Typography carries hierarchy: a 28 px title, 18 px body, 14 px caption reads as
three levels without a single rectangle.

## Density

A teaching panel can be dense, but it must be *ordered*: a clear entry point, one
reading direction, and whitespace around the element that matters most. Crowding
without order reads as noise no matter how correct the content is.
