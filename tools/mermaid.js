/**
 * Mermaid as a skeleton front-end. `fromMermaid` runs the official converter's
 * parser page-side and keeps only the graph it found — vertices, edges, labels
 * and shapes — then builds house material from it: labels measured with the real
 * metrics, sizes settled by the converter's own rule for labelled containers,
 * colours from the house neutral role.
 *
 * The converter's layout is discarded on purpose. It positions with mermaid's
 * text metrics, which this pipeline exists to replace, so its coordinates would
 * be wrong the moment the labels are re-measured. `graph()` does the placing.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NamedError } from "./errors.js";

const palette = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../brand/palette.json"), "utf8"),
);

/** A mermaid source cannot become a house graph — wrong diagram kind, or unparseable. */
export class MermaidError extends NamedError {}

/** House defaults for an ingested node: prose face, neutral role, one gap of padding. */
const FONT_SIZE = 20;
const FONT_FAMILY = palette.fontFamily.prose;
const PADDING = 20;

/**
 * The house shape for each mermaid vertex kind. Coarse on purpose: the house
 * vocabulary is step / decision / start-end, so a decision becomes a diamond, a
 * round-ended vertex becomes an ellipse, and everything else is a step.
 */
const SHAPES = {
  diamond: "diamond",
  circle: "ellipse",
  doublecircle: "ellipse",
  stadium: "ellipse",
  default: "rectangle",
};

/**
 * How much wider than its text a shape must be for the text to fit *inside* it.
 * A label sits in the box inscribed in its container, which for a rhombus is
 * half the width and for an ellipse is 1/√2 of it — so a diamond sized like a
 * rectangle wraps its label to a sliver, mid-word. Sizing up front is what keeps
 * "wontfix" one word.
 */
const ROOM = { diamond: 2, ellipse: Math.SQRT2 };

/** The named diagram kinds the converter's parser can return besides a flowchart. */
const KIND_NAMES = {
  sequence: "a sequence diagram",
  class: "a class diagram",
  erd: "an entity-relationship diagram",
  state: "a state diagram",
  // the parser's fallback for everything it cannot read as a graph — a picture
  // of the diagram, which says nothing about what the source actually was
  graphImage: "a diagram this converter reads only as a picture",
};

const refusals = {
  kind: (detail) => ({
    what: `is ${KIND_NAMES[detail] ?? `a ${detail} diagram`}, and only flowcharts can be ingested`,
    fix: "Rewrite the source as a flowchart, or build this diagram by hand.",
  }),
  subgraph: () => ({
    what: "uses subgraph blocks, and the layout engine behind graph() is flat-only",
    fix: "Flatten the subgraphs out of the source, or draw one panel per subgraph.",
  }),
  unparseable: (detail) => ({
    what: `is not parseable mermaid:\n${detail}`,
    fix: "Fix the source at the line the parser names, then call fromMermaid again.",
  }),
  empty: () => ({
    what: "is a flowchart with no nodes in it",
    fix: "Add at least one node to the source.",
  }),
};

/**
 * `fromMermaid(source)` for the build context, bound to an open browser session.
 *
 * Gives back `{ nodes, edges }` in exactly the shape `graph()` takes: `nodes`
 * are skeleton shapes sitting at the origin, `edges` are
 * `[source, target, { label }]` triples naming those very objects. Restyling by
 * palette role happens between the two calls — the converter's own colours and
 * classDefs are dropped, because a guessed role is worse than the neutral one.
 */
export const makeFromMermaid = (ex) => async (source) => {
  if (typeof source !== "string" || !source.trim()) {
    throw new MermaidError("needs mermaid source text, and got nothing to parse", {
      where: "fromMermaid", next: "Pass the mermaid source as a string.",
    });
  }
  const parsed = await ex.mermaidGraph({
    source, fontSize: FONT_SIZE, fontFamily: FONT_FAMILY, padding: PADDING,
    shapes: SHAPES, room: ROOM,
  });
  if (!parsed.ok) {
    const { what, fix } = refusals[parsed.reason](parsed.detail);
    throw new MermaidError(`the mermaid source ${what}`, { where: "fromMermaid", next: fix });
  }

  const nodes = parsed.nodes.map((node) => ({
    type: node.shape,
    id: node.id,
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
    strokeColor: palette.grey.stroke,
    backgroundColor: palette.grey.fill,
    // ink, not the container's stroke the converter would otherwise inherit:
    // restyling a node to a role is the documented next step, and a label that
    // took the role's stroke would land on the role's own fill — which for the
    // paler roles is the gate's `low-contrast` refusal.
    label: { text: node.text, fontSize: FONT_SIZE, fontFamily: FONT_FAMILY, strokeColor: palette.ink },
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = parsed.edges.map((edge) => {
    // an endpoint the parse never gave a vertex for would reach graph() as
    // undefined and be refused there, naming graph rather than the source
    for (const end of [edge.source, edge.target]) {
      if (byId.has(end)) continue;
      throw new MermaidError(
        `the mermaid source links ${edge.source} to ${edge.target}, and declares no node "${end}"`, {
        where: "fromMermaid", next: `Declare "${end}" in the source, or drop the edge naming it.`,
      });
    }
    return [byId.get(edge.source), byId.get(edge.target),
      ...(edge.label ? [{ label: edge.label }] : [])];
  });
  return { nodes, edges };
};
