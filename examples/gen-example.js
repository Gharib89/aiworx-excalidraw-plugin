#!/usr/bin/env node
/**
 * Worked example: a small band panel exercising every authoring helper —
 * batch measurement, pixel wrapping, layout composition (column/row/box),
 * role colours, a bound arrow owning the gap, and a content-fitted frame.
 *
 *   CLAUDE_PLUGIN_ROOT="$PWD" node examples/gen-example.js
 *
 * Imports through CLAUDE_PLUGIN_ROOT — the same form a committed generator uses
 * (reference/authoring.md), since an install path differs per machine.
 */
const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) throw new Error("run with CLAUDE_PLUGIN_ROOT=<path to aiworx-excalidraw plugin>");
const { authorDiagram } = await import(`${root}/tools/author.js`);

await authorDiagram({
  out: new URL("./example.excalidraw", import.meta.url).pathname,
  build: async ({ measure, wrap, row, column, box, arrowBetween, palette: p, PROSE, CODE }) => {
    const CARD_W = 320;
    const PAD = 20;

    const [title] = await measure([{ text: "two lanes", fontSize: 28, fontFamily: PROSE }]);
    const titleEl = {
      type: "text", id: "title", text: "two lanes", fontSize: 28, fontFamily: PROSE,
      strokeColor: p.grey.ink, width: title.width, height: title.height,
    };

    // Two cards whose heights come from their measured, wrapped prose.
    const lanes = [
      { id: "cpu", role: "local", head: "stays local", code: "do_ocr = False",
        body: "Parsing, layout and table structure all run on this machine. No key needed, nothing leaves the box." },
      { id: "api", role: "remote", head: "goes remote", code: "describe(picture)",
        body: "Figure captions and formula reads call a model over the network. Needs a key, and costs money per call." },
    ];

    const cards = [];
    for (const lane of lanes) {
      const [head, code] = await measure([
        { text: lane.head, fontSize: 20, fontFamily: PROSE },
        { text: lane.code, fontSize: 15, fontFamily: CODE },
      ]);
      const body = await wrap(lane.body, CARD_W - 2 * PAD, { fontSize: 16, fontFamily: PROSE });
      cards.push(box(
        column([
          { type: "text", text: lane.head, fontSize: 20, fontFamily: PROSE,
            strokeColor: p.roles[lane.role].stroke, width: head.width, height: head.height },
          { type: "text", text: body.text, fontSize: 16, fontFamily: PROSE,
            strokeColor: p.grey.ink, width: body.width, height: body.height },
          { type: "text", text: lane.code, fontSize: 15, fontFamily: CODE,
            strokeColor: p.grey.stroke, width: code.width, height: code.height },
        ], { gap: [12, 14] }),
        { padding: PAD, id: lane.id, strokeColor: p.roles[lane.role].stroke,
          backgroundColor: p.roles[lane.role].fill, roundness: { type: 3 } },
      ));
    }

    const band = column([titleEl, row(cards, { gap: 60 })], { gap: 28 });

    return [
      band,
      // the arrow owns the gap: it leaves cpu 10px out and stops 10px short of api
      arrowBetween(cards[0], cards[1], { standoff: 10, strokeColor: p.grey.stroke, strokeWidth: 2 }),
      { type: "frame", children: ["title", "cpu", "api"],
        name: "2 · two lanes, and the key that guards one" },
    ];
  },
});
