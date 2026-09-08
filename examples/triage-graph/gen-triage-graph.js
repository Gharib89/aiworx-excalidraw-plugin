#!/usr/bin/env node
/**
 * Triage graph — a two-frame band that draws this repo's own triage-label state
 * machine with `graph()`, so the one capability no other Excalidraw skill has is
 * visible working rather than described.
 *
 * The same seven states and eight transitions are laid out twice, one per
 * frame, so `direction`, `gap`, `layerGap` and `routeGap` can be seen doing the
 * work: the node set and the edge list are shared, and only the layout options
 * differ. `placement` and `routeGap` are the two deliberately *equal* in both,
 * because what they buy is not a difference between the pictures: see `LAYOUTS`.
 *
 * **Every** edge here takes `graph()`'s engine route: the corridor ELK left when
 * it placed the nodes, read back rather than redrawn. No `via` anywhere in this
 * file and — since the labels started carrying their own extent — no
 * `originAt` / `landAt` either, so nothing in this band revokes a route.
 *
 * That is what the `label()` helper buys. It measures the text and hands back
 * the string with its `width` and `height`, `graph()` passes that extent to the
 * engine, and the engine spaces its ports around the room the labels will take.
 * The fractions this file used to carry existed only because ELK was never told
 * the labels were there; told, it clears them itself.
 *
 * The machine is drawn honestly, cycles included. `agent-working` hands back to
 * `needs-triage`, and `needs-triage` ↔ `needs-info` is a two-way pair — see the
 * note above `transitions` for which legs the triage-labels doc states and which
 * are read off it. The engine gives the pair its own two ports, so the arrows
 * never share a line; what an extent cannot buy is room *between* two legs
 * running the same diagonal, because a bound label rides at the middle of its
 * own leg, which is where the other leg passes. The label comes off instead,
 * which is why the pair is the one unlabelled transition.
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
// Every label goes through `label()`, which measures it. That is the whole
// difference between this file and the one that carried four `originAt` /
// `landAt`: a measured label hands `graph()` a `width` and `height`, `graph()`
// hands them to the engine, and the engine spaces its ports around the room the
// label needs instead of through it. The fractions were only ever standing in
// for a width nobody had measured.
//
// The extent does not reach the drawn label — the pipeline re-measures bound text
// every pass and owns that size. It is spent once, on the layout, and dropped.
const transitions = async ({ tag }, [triage, info, ready, human, working, wontfix, closed], label) => {
  const at = (name) => ({ id: `${tag}-${name}` });
  // A label rides at the middle of its own arrow, so its width is what decides
  // whether a neighbouring edge can pass — and now the width the engine is told
  // about. Set smaller than the state names on purpose: at the body size these
  // read as wide as the boxes they sit between, and a fan asked to clear labels
  // that wide spreads further than the picture has room for.
  const says = async (text) => ({ label: await label(text, { fontSize: 13 }) });
  return [
    // The two-way pair, and the one transition here that carries no label. The
    // engine gives the pair two ports of its own, so the legs never share a
    // line — but under `placement: "straight"` it settles the two states
    // diagonally apart, and two legs between diagonally-opposite boxes run
    // close to the same diagonal. A bound label rides at the middle of its own
    // leg, which is where the other leg passes, so a label between them is
    // `text-struck-by-arrow` at 0px clearance whatever room the engine reserves
    // for it: an extent moves the two legs apart, and the midpoint each label
    // rides at moves with them. Labelling one direction only is the remedy the
    // authoring reference names, and here even one is one too many — the pair
    // reads from its two arrowheads, and the meanings are in
    // docs/agents/triage-labels.md.
    [triage, info, at("ask")],
    [info, triage, at("answered")],
    [triage, ready, { ...at("ready"), ...(await says("fully specified")) }],
    // needs-triage leaves by one and the same edge four times over — the fan
    // that used to need a fraction per leg. Two of those legs carry a measured
    // label, and that is what the engine spaces them by. `modelOrder` fixes the
    // targets in the order they are listed above, so the legs leave in reading
    // order and spread instead of crossing.
    [triage, human, { ...at("human"), ...(await says("human only")) }],
    [triage, wontfix, at("wontfix")],                   // unlabelled because the arrowhead says it all
    [ready, working, { ...at("claim"), ...(await says("/ship claims it")) }],
    [working, triage, { ...at("handback"), ...(await says("blocked")) }],   // the cycle
    [working, closed, { ...at("merged"), ...(await says("merged")) }],
  ];
};

// One entry per frame. The band's whole claim is that these five options — and
// nothing else — separate the two pictures, so the caption under each graph is
// built from this object rather than typed beside it: a drawn caption that can
// drift from the call it describes is a lie the gate cannot catch.
//
// `placement` is the same value in both, because it is not what separates them:
// it is what keeps the labels clear. Under the default "balanced" placement the
// engine settles `needs-triage`'s fan close enough together that two labels take
// an arrow through them — `text-struck-by-arrow`, measured at 0px and 2.3px
// clearance — however much room the extents ask for, because the strategy is
// what decides where along its layer a node lands and therefore how far apart
// the legs leave. "straight" is bought, not free: it spends bends on the
// `human` and `handback` legs, which is the `too-many-bends` advisory this band
// carries in both frames and the trade `placement` names in the reference.
const LAYOUTS = [
  {
    tag: "down",
    opts: { direction: "down", gap: 150, layerGap: 60, routeGap: 20, placement: "straight" },
    title: "graph() lays out the triage labels",
    frame: 'direction "down" — the triage state machine, cycles and all',
    note: "Every edge follows the corridor the engine left when it placed the nodes — read "
      + "back, not redrawn, so nothing here is hand-routed and nothing here is hand-nudged. "
      + "The five labels come from label(), which measures the text and hands graph() a width "
      + "and a height; graph() gives the engine those, and the engine spaces its ports around "
      + "the room they need. That is what retired the four originAt / landAt this band used to "
      + "carry: a fraction was only ever standing in for a width nobody had measured, and it "
      + "cost the edge its engine route to do it. needs-triage leads because modelOrder makes "
      + "the order the states were listed in the tie-break, and that order picks which edge of "
      + "the cycle gives way — the picture opens where an issue really opens.",
  },
  {
    tag: "right",
    opts: { direction: "right", gap: 100, layerGap: 40, routeGap: 20, placement: "straight" },
    title: "same nodes, same edges, laid out sideways",
    frame: 'direction "right" — the same graph, respaced',
    note: "Same states, same transitions, three different numbers — placement and routeGap are "
      + "the same in both. gap spaces the states inside a layer, layerGap spaces the layers "
      + "themselves, routeGap spaces two routes sharing one corridor, and direction turns the "
      + "flow on its side. The engine routes and the label clearances both follow on their own, "
      + "which is the whole point: the fractions this panel used to carry had to be picked "
      + "again from scratch here, because a fraction runs along whichever edge now faces its "
      + "target — a measured extent is read the same way in either direction.",
  },
];

const caption = ({ direction, gap, layerGap, routeGap, placement }) =>
  `direction: "${direction}" · gap: ${gap} · layerGap: ${layerGap} · routeGap: ${routeGap}`
  + ` · placement: "${placement}"`;

await authorDiagram({
  out: join(here, "triage-graph.excalidraw"),
  build: async ({ measure, wrap, label, graph, row, column, box, palette: p, PROSE, CODE }) => {
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
      const { g, arrows } = await graph(nodes, await transitions(layout, nodes, label), {
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
