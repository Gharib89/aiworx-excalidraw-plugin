#!/usr/bin/env node
/**
 * Triage graph — a two-frame band that draws this repo's own triage-label state
 * machine with `graph()`, so the one capability no other Excalidraw skill has is
 * visible working rather than described.
 *
 * The same seven states and eight transitions are laid out twice, one per
 * frame, so `direction`, `gap` and `layerGap` can be seen doing the work: the
 * node set and the edge list are shared, and only the layout options — and the
 * per-edge offsets those options force, which is a lesson of its own — differ.
 *
 * The machine is drawn honestly, cycles included. `agent-working` hands back to
 * `needs-triage`, and `needs-triage` ↔ `needs-info` is a two-way pair — see the
 * note above `transitions` for which legs the triage-labels doc states and which
 * are read off it — that piles both arrows onto one line and strikes the
 * forward leg's label. The
 * return leg carries `originAt` / `landAt` so `text-struck-by-arrow` never
 * fires: the documented remedy in use, not a dodged shape.
 *
 * One thing the pictures show that no option controls: the engine breaks the
 * cycle by reversing an edge, so `ready-for-agent` lands in the top layer even
 * though `needs-triage` is where an issue starts. The arrows still point the
 * way the transitions really go — follow the arrowheads, not the layers.
 *
 *   node gen-triage-graph.js <plugin root>                    # plugin root as the first argument
 *   CLAUDE_PLUGIN_ROOT=<plugin root> node gen-triage-graph.js   # equivalent
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.CLAUDE_PLUGIN_ROOT ?? process.argv[2];
if (!root) throw new Error("gen-triage-graph.js: no plugin root — run `node gen-triage-graph.js <path to aiworx-excalidraw plugin>`, or set CLAUDE_PLUGIN_ROOT to it");
const { authorDiagram } = await import(pathToFileURL(join(root, "tools/author.js")).href);

let auto = 0;
const uid = (tag) => `${tag}-${auto++}`;
const flat = (n) => (n?.kind === "layout-group" ? n.children.flatMap(flat) : [n]);
const idsOf = (node, tag) =>
  flat(node).map((el) => {
    el.id ??= uid(tag);
    return el.id;
  });

// The states, in the order the edges below index them. The role colour says who
// acts: gold decides, purple waits on someone outside the repo, blue is the
// `/ship` lane, red is refused, green is done, and grey is where no automation
// runs at all.
const STATES = [
  ["needs-triage", "decision"],
  ["needs-info", "remote"],
  ["ready-for-agent", "local"],
  ["ready-for-human", null],
  ["agent-working", "local"],
  ["wontfix", "fail"],
  ["closed", "pass"],
];

// Where the transitions come from. docs/agents/triage-labels.md states the
// `agent-working` legs outright — the claim, the hand-back landing on
// `needs-triage` rather than back on `ready-for-agent`, and merging closing the
// issue — and those are drawn as written. The rest are read off the meanings in
// that file's table: `needs-info` means "waiting on reporter", so an issue goes
// there from triage and comes back once the reporter answers. That pair is the
// inference, not a quotation, and it is the one worth checking against the doc
// if the labels are ever reworked.
//
// Each edge carries its own id so a gate refusal names the transition rather
// than a generated string.
//
// `offsets` carries the per-edge `originAt` / `landAt` for one layout. They live
// with the layout rather than here because a fraction runs along the *facing*
// edge, and which edge faces depends on `direction`: 0.2 is a fifth of the way
// across the bottom of a box laid out "down", and a fifth of the way down its
// side laid out "right". One set of numbers cannot serve both pictures.
const transitions = ({ tag, offsets }, [triage, info, ready, human, working, wontfix, closed]) => {
  const at = (name) => ({ id: `${tag}-${name}`, ...(offsets[name] ?? {}) });
  // A label rides at the middle of its own arrow, so its width is what decides
  // whether a neighbouring edge can pass. Set smaller than the state names on
  // purpose: at the body size these read as wide as the boxes they sit between,
  // and no amount of offsetting opens a gap for them.
  const says = (text) => ({ text, fontSize: 13 });
  return [
    // The two-way pair. Both legs would otherwise run centre to centre along
    // one line, and the return arrow would strike the label of the leg going
    // out — `text-struck-by-arrow`, at 0px clearance. The offsets pull the two
    // legs apart onto separate parallel lines, which leaves the label a side to
    // itself. Two things decide the numbers: the gap has to be wider than half
    // the label, which is centred on its own leg, and the return leg belongs on
    // the outside of the layout — pushed the other way it crosses the rest of
    // the fan and reads as an edge between the wrong two states.
    [triage, info, { ...at("ask"), label: says("ask reporter") }],
    [info, triage, at("answered")],
    [triage, ready, { ...at("ready"), label: says("fully specified") }],
    // needs-triage leaves by one and the same edge four times over. Left alone
    // every one of those arrows departs from the middle of it and stacks the
    // labels on one spot, so the offsets fan the departures out in the order
    // the engine happened to lay the targets in.
    [triage, human, { ...at("human"), label: says("human only") }],
    [triage, wontfix, at("wontfix")],                   // an unlabelled transition beside the labelled ones
    [ready, working, { ...at("claim"), label: says("/ship claims it") }],
    [working, triage, { ...at("handback"), label: says("blocked") }],   // the cycle
    [working, closed, { ...at("merged"), label: says("merged") }],
  ];
};

// One entry per frame. The band's whole claim is that these three options — and
// nothing else — separate the two pictures, so the caption under each graph is
// built from this object rather than typed beside it: a drawn caption that can
// drift from the call it describes is a lie the gate cannot catch.
const LAYOUTS = [
  {
    tag: "down",
    opts: { direction: "down", gap: 110, layerGap: 96 },
    offsets: {
      ask: { originAt: 0.34, landAt: 0.78 },
      answered: { originAt: 0.2, landAt: 0.08 },
      human: { originAt: 0.62 },
      wontfix: { originAt: 0.92 },
    },
    title: "graph() lays out the triage labels",
    frame: 'direction "down" — the triage state machine, cycles and all',
    note: "needs-triage and needs-info point at each other, and left alone both legs run down "
      + "one line — the return arrow straight through the outgoing leg's label. originAt / "
      + "landAt move the return leg onto the outside of the fan, where it has a line to itself. "
      + "ready-for-agent sits on top because the engine reversed an edge to break the cycle: "
      + "read the arrowheads, not the layers.",
  },
  {
    tag: "right",
    opts: { direction: "right", gap: 64, layerGap: 190 },
    offsets: {
      ask: { originAt: 0.3, landAt: 0.7 },
      answered: { originAt: 0.1, landAt: 0.08 },
      human: { originAt: 0.55 },
      wontfix: { originAt: 0.85 },
    },
    title: "same nodes, same edges, laid out sideways",
    frame: 'direction "right" — the same graph, respaced',
    note: "Same states, same transitions, three different numbers. gap spaces the states inside "
      + "a layer, layerGap spaces the layers themselves, and direction turns the flow on its "
      + "side — after which every originAt / landAt above had to be picked again, because a "
      + "fraction runs along whichever edge now faces its target.",
  },
];

const caption = ({ direction, gap, layerGap }) =>
  `direction: "${direction}" · gap: ${gap} · layerGap: ${layerGap}`;

await authorDiagram({
  out: join(here, "triage-graph.excalidraw"),
  build: async ({ measure, wrap, graph, row, column, box, palette: p, PROSE, CODE }) => {
    const text = async (str, { fontSize = 16, fontFamily = PROSE, color = p.ink } = {}) => {
      const [m] = await measure([{ text: str, fontSize, fontFamily }]);
      return { type: "text", text: str, fontSize, fontFamily, strokeColor: color,
               width: m.width, height: m.height };
    };
    const prose = async (str, width, { color = p.grey.stroke, fontSize = 13 } = {}) => {
      const w = await wrap(str, width, { fontSize });
      return { type: "text", text: w.text, fontSize, fontFamily: PROSE,
               strokeColor: color, width: w.width, height: w.height };
    };
    // a fresh set per panel: `graph` places the very objects it is handed, so
    // two layouts cannot share one node
    const states = async (tag) =>
      Promise.all(STATES.map(async ([label, role], i) => {
        const tone = role ? p.roles[role] : p.grey;
        return box(await text(label, { fontSize: 15, fontFamily: CODE }), {
          id: `${tag}-${i}`, padding: 12, strokeColor: tone.stroke,
          backgroundColor: tone.fill, roundness: { type: 3 }, strokeWidth: 2,
        });
      }));

    const panels = [];
    for (const [i, layout] of LAYOUTS.entries()) {
      const nodes = await states(layout.tag);
      const { g, arrows } = await graph(nodes, transitions(layout, nodes), {
        ...layout.opts,
        standoff: 10, strokeColor: p.grey.stroke, strokeWidth: 2, endArrowhead: "triangle",
      });
      const head = await text(layout.title, { fontSize: 22 });
      const opts = await text(caption(layout.opts),
        { fontSize: 14, fontFamily: CODE, color: p.grey.stroke });
      const note = await prose(layout.note, 420);
      panels.push({
        g: column([head, opts, g, note], { gap: [10, 34, 34] }),
        arrows, name: `${i + 1} · ${layout.frame}`,
      });
    }

    row(panels.map((pl) => pl.g), { gap: 190, align: "start" });

    const frames = panels.map((pl, i) => ({
      type: "frame", id: uid("frame"), name: pl.name,
      children: [...idsOf(pl.g, `p${i + 1}`), ...pl.arrows.flatMap((a) => idsOf(a, `p${i + 1}x`))],
    }));
    return [...panels.map((pl) => pl.g), ...panels.flatMap((pl) => pl.arrows), ...frames];
  },
});
