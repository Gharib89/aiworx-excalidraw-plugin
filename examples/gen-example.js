#!/usr/bin/env node
/**
 * Worked example: a small band exercising every authoring helper —
 * batch measurement, pixel wrapping, layout composition (column/row/box),
 * role colours, a bound arrow owning the gap, content-fitted frames, an
 * image travelling in the files dictionary, and a spliced library item.
 *
 *   CLAUDE_PLUGIN_ROOT="$PWD" node examples/gen-example.js
 *
 * Imports through CLAUDE_PLUGIN_ROOT — the same form a committed generator uses
 * (reference/authoring.md), since an install path differs per machine. Paths
 * cross the URL boundary through node:url, never `URL.pathname`, which keeps
 * `%20` in a path with a space and prefixes a Windows drive with a slash.
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) throw new Error("run with CLAUDE_PLUGIN_ROOT=<path to aiworx-excalidraw plugin>");
const { authorDiagram } = await import(pathToFileURL(join(root, "tools/author.js")).href);

await authorDiagram({
  out: join(here, "example.excalidraw"),
  build: async ({ measure, wrap, row, column, box, arrowBetween, image, spliceLibraryItem, palette: p, PROSE, CODE }) => {
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

    // Real assets: the logo's bytes travel in the files dictionary, the
    // figure is spliced from a community-format library with fresh ids.
    const [assetsTitle] = await measure([{ text: "real assets", fontSize: 28, fontFamily: PROSE }]);
    const assetsTitleEl = {
      type: "text", id: "assets-title", text: "real assets", fontSize: 28, fontFamily: PROSE,
      strokeColor: p.grey.ink, width: assetsTitle.width, height: assetsTitle.height,
    };
    const logo = image(join(here, "../brand/AIWorx_logo.png"), { id: "logo", width: 180 });
    const figure = spliceLibraryItem(join(here, "stick-figure.excalidrawlib"));
    const assets = column(
      [assetsTitleEl, row([logo, figure], { gap: 56, align: "end" })],
      { gap: 28, x: band.width + 200 },
    );

    return [
      band,
      assets,
      // the arrow owns the gap: it leaves cpu 10px out and stops 10px short of api
      arrowBetween(cards[0], cards[1], { standoff: 10, strokeColor: p.grey.stroke, strokeWidth: 2 }),
      { type: "frame", children: ["title", "cpu", "api"],
        name: "2 · two lanes, and the key that guards one" },
      { type: "frame", children: ["assets-title", "logo", ...figure.ids],
        name: "3 · real assets: logo bytes in the file, a figure spliced from a library" },
    ];
  },
});
