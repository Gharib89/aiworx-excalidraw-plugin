#!/usr/bin/env node
/**
 * Browser suite for mermaid ingestion (#135): what `fromMermaid` promises about
 * the graph it hands `graph()`.
 *
 *   1. a flowchart becomes house-built nodes — house colours, origin positions,
 *      measured sizes — and `[source, target, { label }]` edges naming those
 *      very objects
 *   2. the shape vocabulary is coarse: decision → diamond, circle/stadium →
 *      ellipse, everything else → rectangle
 *   3. mermaid's `<br/>` is a line break, not four literal characters
 *   4. the whole path runs: fromMermaid → restyle → graph() → gate → file, with
 *      the edge labels landing on bound arrows
 *   5. refusals, each naming what it refused: a non-flowchart source, a source
 *      with subgraph blocks, unparseable mermaid, and a flowchart with no nodes
 *
 * The parse needs a DOM, so this suite belongs to the browser target.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAuthoring } from "../tools/author.js";

const outDir = mkdtempSync(join(tmpdir(), "mermaid-"));
console.log(`artifacts: ${outDir}`);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const FLOW = `flowchart TD
  A[triage] --> B{ready?}
  B -- claimed --> C((working))
  B -- parked --> D([wontfix])
  C --> E[merged]`;

/** Run a build that only inspects fromMermaid's result, writing nothing. */
const inspect = async (author, source, take) => {
  let seen;
  await author({
    out: join(outDir, "inspect.excalidraw"), svg: false,
    build: async (ctx) => {
      seen = take(await ctx.fromMermaid(source), ctx);
      return [{ type: "rectangle", id: "placeholder", x: 0, y: 0, width: 100, height: 60 }];
    },
  });
  return seen;
};

const refusal = async (author, source) => {
  try {
    await author({
      out: join(outDir, "refused.excalidraw"), svg: false,
      build: async ({ fromMermaid }) => (await fromMermaid(source)).nodes,
    });
    return { ok: false, detail: "resolved instead of throwing" };
  } catch (err) {
    return {
      ok: err.name === "MermaidError",
      message: String(err.message),
      detail: `${err.name}: ${String(err.message).split("\n")[0]}`,
    };
  }
};

await withAuthoring(async (author) => {
  // ---- 1 & 2. the graph, house-built ----
  {
    const { nodes, edges, palette } = await inspect(author, FLOW, (r, ctx) => ({ ...r, palette: ctx.palette }));
    check("every vertex comes back as a node", nodes.length === 5, `${nodes.length} nodes`);
    check("nodes keep their mermaid ids", nodes.map((n) => n.id).join(",") === "A,B,C,D,E",
      nodes.map((n) => n.id).join(","));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    check("a decision maps to a diamond", byId.B.type === "diamond", byId.B.type);
    check("a circle maps to an ellipse", byId.C.type === "ellipse", byId.C.type);
    check("a stadium maps to an ellipse", byId.D.type === "ellipse", byId.D.type);
    check("everything else maps to a rectangle",
      byId.A.type === "rectangle" && byId.E.type === "rectangle", `${byId.A.type}/${byId.E.type}`);
    check("labels ride along as bound text", byId.A.label?.text === "triage", byId.A.label?.text);
    check("nodes are measured", nodes.every((n) => n.width > 0 && n.height > 0),
      nodes.map((n) => `${n.width}x${n.height}`).join(" "));
    check("a diamond is sized for the label it will hold", byId.B.height > byId.A.height,
      `${byId.B.height} vs ${byId.A.height}`);
    check("no converter position leaks in", nodes.every((n) => n.x === 0 && n.y === 0));
    check("nodes arrive in the house neutral role",
      nodes.every((n) => n.strokeColor === palette.grey.stroke && n.backgroundColor === palette.grey.fill),
      `${nodes[0].strokeColor}/${nodes[0].backgroundColor}`);

    check("every edge comes back", edges.length === 4, `${edges.length} edges`);
    check("edges name the node objects themselves",
      edges.every(([s, t]) => nodes.includes(s) && nodes.includes(t)));
    const labelled = edges.filter((e) => e[2]?.label);
    check("mermaid edge labels survive onto the edges",
      labelled.map((e) => e[2].label).sort().join(",") === "claimed,parked",
      labelled.map((e) => e[2].label).join(","));
    check("an unlabelled edge carries no label",
      edges.filter((e) => e[2]?.label).length === 2);
  }

  // ---- 3. <br/> is a line break ----
  {
    const { nodes } = await inspect(author, 'flowchart LR\n  A["one<br/>two"] --> B[plain]', (r) => r);
    check("<br/> becomes a newline", nodes[0].label.text === "one\ntwo",
      JSON.stringify(nodes[0].label.text));
  }

  // ---- 3b. the source's own order is the layout's tie-break ----
  // `fromMermaid` hands `graph` its nodes in the order the source wrote them, and
  // `graph` reads that order as the tie-break — so the branch a reader meets
  // first in the mermaid is the branch that sits leading in the picture.
  {
    let c, d;
    await author({
      out: join(outDir, "order.excalidraw"), svg: false,
      build: async ({ fromMermaid, graph }) => {
        const { nodes, edges } = await fromMermaid(FLOW);
        const { g, arrows } = await graph(nodes, edges);
        const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
        [c, d] = [byId.C.x, byId.D.x];
        return [g, ...arrows];
      },
    });
    check("the branch listed first in the source lays out leading", c < d, `C@${c} D@${d}`);
  }

  // ---- 4. the whole path: mermaid in, gated document out ----
  {
    const out = join(outDir, "flow.excalidraw");
    let decisionStroke;
    const { elements } = await author({
      out, svg: false,
      build: async ({ fromMermaid, graph, palette }) => {
        decisionStroke = palette.roles.decision.stroke;
        const { nodes, edges } = await fromMermaid(FLOW);
        for (const node of nodes) {
          if (node.type !== "diamond") continue;
          node.strokeColor = decisionStroke;
          node.backgroundColor = palette.roles.decision.fill;
        }
        const { g, arrows } = await graph(nodes, edges, { direction: "down", gap: 60, layerGap: 80 });
        return [g, ...arrows];
      },
    });
    const doc = JSON.parse(readFileSync(out, "utf8"));
    check("the gated document holds every node", doc.elements.filter((e) => e.type === "rectangle"
      || e.type === "diamond" || e.type === "ellipse").length === 5);
    const arrows = doc.elements.filter((e) => e.type === "arrow");
    check("one arrow per edge", arrows.length === 4, `${arrows.length} arrows`);
    check("arrows are bound at both ends",
      arrows.every((a) => a.startBinding?.elementId && a.endBinding?.elementId));
    const arrowLabels = doc.elements
      .filter((e) => e.type === "text" && arrows.some((a) => a.id === e.containerId))
      .map((e) => e.text).sort();
    check("edge labels land on the arrows", arrowLabels.join(",") === "claimed,parked",
      arrowLabels.join(","));
    // a diamond or ellipse holds its label in the box inscribed in it, so a node
    // sized like a rectangle wraps "wontfix" to "wontfi" + "x"
    const nodeLabels = doc.elements
      .filter((e) => e.type === "text" && ["A", "B", "C", "D", "E"].includes(e.containerId))
      .map((e) => e.text).sort();
    check("labels are not re-wrapped inside the shape that holds them",
      nodeLabels.join("|") === "merged|ready?|triage|wontfix|working", nodeLabels.join("|"));
    check("the layout engine placed the nodes apart",
      new Set(elements.filter((e) => e.type !== "text" && e.type !== "arrow").map((e) => e.y)).size > 1);
    check("the decision restyle survived the round trip",
      doc.elements.find((e) => e.type === "diamond")?.strokeColor === decisionStroke);
  }

  // ---- 5. refusals ----
  {
    const seq = await refusal(author, "sequenceDiagram\n  Alice->>Bob: hi\n  Bob-->>Alice: hello");
    check("a non-flowchart source is refused, naming flowchart",
      seq.ok && /flowchart/.test(seq.message), seq.detail);

    const sub = await refusal(author, "flowchart TD\n  subgraph one\n    A --> B\n  end\n  B --> C");
    check("a subgraph source is refused, naming subgraph",
      sub.ok && /subgraph/.test(sub.message), sub.detail);

    const bad = await refusal(author, "flowchart TD\n  A --> --> ???[[[");
    check("unparseable mermaid is refused, carrying the parser's message",
      bad.ok && /Parse error/.test(bad.message), bad.detail);

    const empty = await refusal(author, "flowchart TD");
    check("a flowchart with no nodes is refused", empty.ok, empty.detail);
  }
});

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall good");
process.exit(fail.length ? 1 : 0);
