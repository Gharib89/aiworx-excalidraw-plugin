#!/usr/bin/env node
/**
 * Worked example: a small band panel exercising every authoring helper —
 * batch measurement, pixel wrapping, role colours, bound arrows, a
 * content-fitted frame, and the footer mark.
 *
 *   node examples/gen-example.js
 */
import { authorDiagram } from "../tools/author.js";

await authorDiagram({
  out: new URL("./example.excalidraw", import.meta.url).pathname,
  build: async ({ measure, wrap, palette: p, mark, PROSE, CODE }) => {
    const X = 0;
    const Y = 0;
    const CARD_W = 320;
    const els = [];

    const [title] = await measure([
      { text: "two lanes", fontSize: 28, fontFamily: PROSE },
    ]);
    els.push({
      type: "text", id: "title", x: X, y: Y, text: "two lanes",
      fontSize: 28, fontFamily: PROSE, strokeColor: p.grey.ink,
    });

    // Two cards whose heights come from their measured, wrapped prose.
    const lanes = [
      { id: "cpu", role: "local", head: "stays local", code: "do_ocr = False",
        body: "Parsing, layout and table structure all run on this machine. No key needed, nothing leaves the box." },
      { id: "api", role: "remote", head: "goes remote", code: "describe(picture)",
        body: "Figure captions and formula reads call a model over the network. Needs a key, and costs money per call." },
    ];

    let cardBottom = 0;
    for (const [i, lane] of lanes.entries()) {
      const x = X + i * (CARD_W + 60);
      const y = Y + title.height + 28;
      const head = (await measure([{ text: lane.head, fontSize: 20, fontFamily: PROSE }]))[0];
      const body = await wrap(lane.body, CARD_W - 40, { fontSize: 16, fontFamily: PROSE });
      const code = (await measure([{ text: lane.code, fontSize: 15, fontFamily: CODE }]))[0];
      const h = 20 + head.height + 12 + body.height + 14 + code.height + 20;

      els.push(
        { type: "rectangle", id: lane.id, x, y, width: CARD_W, height: h,
          strokeColor: p.roles[lane.role].stroke, backgroundColor: p.roles[lane.role].fill,
          roundness: { type: 3 } },
        { type: "text", x: x + 20, y: y + 20, text: lane.head, fontSize: 20,
          fontFamily: PROSE, strokeColor: p.roles[lane.role].stroke },
        { type: "text", x: x + 20, y: y + 20 + head.height + 12, text: body.text,
          fontSize: 16, fontFamily: PROSE, strokeColor: p.grey.ink },
        { type: "text", x: x + 20, y: y + 20 + head.height + 12 + body.height + 14,
          text: lane.code, fontSize: 15, fontFamily: CODE, strokeColor: p.grey.stroke },
      );
      cardBottom = Math.max(cardBottom, y + h);
    }

    // Explicit points keep a bound arrow in the gap between the cards. Without
    // them the arrow spans the full element distance and its head lands inside
    // the target, on top of whatever text is there.
    const gapY = Y + title.height + 28 + 56;
    els.push({
      type: "arrow", x: X + CARD_W + 10, y: gapY,
      width: 40, height: 0, points: [[0, 0], [40, 0]],
      start: { id: "cpu" }, end: { id: "api" },
      strokeColor: p.grey.stroke, strokeWidth: 2,
    });

    els.push(...mark({ x: X, y: cardBottom + 24, scale: 0.8 }));

    els.push({
      type: "frame",
      name: "2 · two lanes, and the key that guards one",
      // the mark is listed so the frame grows to include its own footer
      children: ["title", "cpu", "api", ...mark.ids()],
    });
    return els;
  },
});
