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
 * `placement` is the one layout option deliberately *equal* in both, because
 * what it buys is not a difference between the pictures: see `LAYOUTS`.
 *
 * Every edge that names no offset takes `graph()`'s engine route: the corridor
 * ELK left when it placed the nodes, read back rather than redrawn. That is the
 * half of the old hand-routing that is gone — no `via` anywhere in this file.
 *
 * The machine is drawn honestly, cycles included. `agent-working` hands back to
 * `needs-triage`, and `needs-triage` ↔ `needs-info` is a two-way pair — see the
 * note above `transitions` for which legs the triage-labels doc states and which
 * are read off it. The engine gives the pair its own two ports, so the arrows
 * never share a line; what it cannot do is keep an arrow off a neighbour's
 * *label*, because ELK spaced those ports for the arrows and was never told the
 * labels exist. That, and nothing else, is what the `originAt` / `landAt` in
 * this file are for — and where not even a fraction opens a gap, the label
 * comes off instead, which is why the pair is the one unlabelled transition.
 *
 * `needs-triage` leads both pictures because `graph()` reads the order the states
 * were listed in — `modelOrder`, on by default — and that order picks which edge
 * of the cycle gives way. The machine has a cycle either way; what the listing
 * order buys is that the state an issue really starts in is the one a reader
 * meets first. `entry: triage` would pin the same thing outright.
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
// than a generated string. No waypoints: `graph()` gives every edge an engine
// route, so the corridors are ELK's — the same numbers it used to place the
// nodes, which is the only place they can come from consistently under two
// different `direction`s.
//
// `offsets` is the one thing the engine route cannot supply. ELK spaced its ports
// for the *arrows*, never having been told the labels exist — `graph()` takes its
// nodes already measured but its labels as text, and layout.js measures no text —
// so the fan out of `needs-triage` puts a neighbouring arrow through a label at
// 0px clearance. A fraction revokes that edge's engine route and hands the path
// back, which is why these numbers still read the way they always did.
//
// They live with the layout rather than here because a fraction runs along the
// *facing* edge, and which edge faces depends on `direction`: 0.2 is a fifth of
// the way across the bottom of a box laid out "down", and a fifth of the way down
// its side laid out "right". One set of numbers cannot serve both pictures.
const transitions = ({ tag, offsets = {} }, [triage, info, ready, human, working, wontfix, closed]) => {
  const at = (name) => ({ id: `${tag}-${name}`, ...(offsets[name] ?? {}) });
  // A label rides at the middle of its own arrow, so its width is what decides
  // whether a neighbouring edge can pass. Set smaller than the state names on
  // purpose: at the body size these read as wide as the boxes they sit between,
  // and no amount of offsetting opens a gap for them.
  const says = (text) => ({ text, fontSize: 13 });
  return [
    // The two-way pair, and the one transition here that carries no label. The
    // engine gives the pair two ports of its own, so the legs never share a
    // line — but under `placement: "straight"` it settles the two states
    // diagonally apart, and two legs between diagonally-opposite boxes run
    // close to the same diagonal. A bound label rides at the middle of its own
    // leg, which is where the other leg passes, so a label between them is
    // `text-struck-by-arrow` at 0px clearance for *every* fraction: an
    // originAt / landAt moves an endpoint along one edge and barely moves the
    // midpoint. Labelling one direction only is the remedy the authoring
    // reference names, and here even one is one too many — the pair reads from
    // its two arrowheads, and the meanings are in docs/agents/triage-labels.md.
    [triage, info, at("ask")],
    [info, triage, at("answered")],
    [triage, ready, { ...at("ready"), label: says("fully specified") }],
    // needs-triage leaves by one and the same edge four times over. Left alone
    // every one of those arrows departs from the middle of it and stacks the
    // labels on one spot, so the offsets fan the departures out. `modelOrder`
    // fixes the targets in the order they are listed above, which is what makes
    // one set of fractions hold: the fan departs the *facing* edge, so the
    // nearest target takes the largest fraction and the farthest the smallest,
    // and the legs spread instead of crossing.
    [triage, human, { ...at("human"), label: says("human only") }],
    [triage, wontfix, at("wontfix")],                   // unlabelled because the arrowhead says it all
    [ready, working, { ...at("claim"), label: says("/ship claims it") }],
    [working, triage, { ...at("handback"), label: says("blocked") }],   // the cycle
    [working, closed, { ...at("merged"), label: says("merged") }],
  ];
};

// One entry per frame. The band's whole claim is that these four options — and
// nothing else — separate the two pictures, so the caption under each graph is
// built from this object rather than typed beside it: a drawn caption that can
// drift from the call it describes is a lie the gate cannot catch.
//
// `placement` is the same value in both, because it is not what separates them:
// it is what makes the handback edge drawable at all. Under the default
// "balanced" placement that edge came back with three direction changes in each
// frame — `too-many-bends` twice over, the only advisory this band could not
// offset its way out of, because a bend count is the engine's to spend and no
// fraction moves it.
const LAYOUTS = [
  {
    tag: "down",
    opts: { direction: "down", gap: 110, layerGap: 96, placement: "straight" },
    offsets: {
      ask: { originAt: 0.22, landAt: 0.8 },
      ready: { originAt: 0.92 },
      human: { originAt: 0.62 },
      wontfix: { originAt: 0.34 },
    },
    title: "graph() lays out the triage labels",
    frame: 'direction "down" — the triage state machine, cycles and all',
    note: "Every unoffset edge follows the corridor the engine left when it placed the nodes — "
      + "read back, not redrawn, so no edge here is hand-routed. placement \"straight\" is what "
      + "lets the handback edge take that corridor in two bends instead of three: the engine "
      + "spends the same bends on the short edges to keep the long one straight, which is the "
      + "one thing an originAt / landAt cannot buy. What the fractions still do is the engine's "
      + "blind spot — spread the four legs leaving needs-triage across its facing edge and move "
      + "them clear of each other's labels, which ELK spaced its ports without ever being told "
      + "about. needs-triage leads because modelOrder makes the order the states were listed in "
      + "the tie-break, and that order picks which edge of the cycle gives way — the picture "
      + "opens where an issue really opens.",
  },
  {
    tag: "right",
    opts: { direction: "right", gap: 80, layerGap: 190, placement: "straight" },
    offsets: {
      ask: { originAt: 0.12, landAt: 0.78 },
      ready: { originAt: 0.35 },
      human: { originAt: 0.72 },
      wontfix: { originAt: 0.95 },
      claim: { originAt: 0.55, landAt: 0.32 },
    },
    title: "same nodes, same edges, laid out sideways",
    frame: 'direction "right" — the same graph, respaced',
    note: "Same states, same transitions, three different numbers — placement is the fourth "
      + "option and deliberately the same in both. gap spaces the states inside a layer, "
      + "layerGap spaces the layers themselves, and direction turns the flow on its side. The "
      + "engine routes follow on their own, because they are read back from the layout rather "
      + "than written beside it — every originAt / landAt above still had to be picked again, "
      + "because a fraction runs along whichever edge now faces its target.",
  },
];

const caption = ({ direction, gap, layerGap, placement }) =>
  `direction: "${direction}" · gap: ${gap} · layerGap: ${layerGap} · placement: "${placement}"`;

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
