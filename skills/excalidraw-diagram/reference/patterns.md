# Patterns

## Match the shape to the behaviour

| The idea | The pattern |
|---|---|
| one input produces many outputs | fan-out — arrows radiating from a single source |
| many inputs become one | funnel — arrows converging, narrowing to the result |
| a fixed order of steps | timeline — a line with dots, labels beside each dot |
| a hierarchy | tree — trunk and branch lines, free text at the nodes |
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
