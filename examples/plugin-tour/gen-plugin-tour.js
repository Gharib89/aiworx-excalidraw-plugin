#!/usr/bin/env node
/**
 * Plugin tour — a 9-frame teaching band that explains the aiworx-excalidraw
 * plugin with its own tools. Each frame lands one claim on a distinct pattern,
 * and together they exercise every authoring feature: withAuthoring, measure,
 * wrap, column/row/box, arrowBetween (labels, standoff, fan-out), image,
 * spliceLibraryItem, frames, palette roles, both fonts, arrowhead vocabulary,
 * and color.js for real dark-theme contrast numbers.
 *
 *   node gen-plugin-tour.js <plugin root>                    # plugin root as the first argument
 *   CLAUDE_PLUGIN_ROOT=<plugin root> node gen-plugin-tour.js   # equivalent
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.CLAUDE_PLUGIN_ROOT ?? process.argv[2];
if (!root) throw new Error("gen-plugin-tour.js: no plugin root — run `node gen-plugin-tour.js <path to aiworx-excalidraw plugin>`, or set CLAUDE_PLUGIN_ROOT to it");
const { withAuthoring } = await import(pathToFileURL(join(root, "tools/author.js")).href);
const { contrast, toDarkTheme } = await import(pathToFileURL(join(root, "tools/color.js")).href);

let auto = 0;
const uid = (tag) => `${tag}-${auto++}`;
const flat = (n) => (n?.kind === "layout-group" ? n.children.flatMap(flat) : [n]);
const idsOf = (node, tag) =>
  flat(node).map((el) => {
    el.id ??= uid(tag);
    return el.id;
  });
const group = (children, width, height) => ({
  kind: "layout-group", x: 0, y: 0, width, height, children,
});

await withAuthoring(async (author) => {
  await author({
    out: join(here, "plugin-tour.excalidraw"),
    build: async (ctx) => {
      const { measure, wrap, row, column, box, arrowBetween, image, spliceLibraryItem,
              palette: p, PROSE, CODE } = ctx;
      const ink = p.ink;
      const grey = p.grey;

      const text = async (str, { fontSize = 16, fontFamily = PROSE, color = ink, ...rest } = {}) => {
        const [m] = await measure([{ text: str, fontSize, fontFamily }]);
        return { type: "text", text: str, fontSize, fontFamily, strokeColor: color,
                 width: m.width, height: m.height, ...rest };
      };
      const card = async (str, role, { fontSize = 16, pad = 14, mono = false } = {}) => {
        const t = await text(str, { fontSize, fontFamily: mono ? CODE : PROSE });
        return box(t, { padding: pad, strokeColor: p.roles[role]?.stroke ?? grey.stroke,
                        backgroundColor: p.roles[role]?.fill ?? grey.fill,
                        roundness: { type: 3 }, strokeWidth: 2 });
      };

      const panels = [];   // { group, name, post(extra) }
      const extras = [];   // elements added after placement (arrows, leaders, overlays)
      const frames = [];

      // ── 1 · the problem: guessed widths overflow, measured widths fit ──────
      {
        const badRect = { type: "rectangle", width: 150, height: 52,
          strokeColor: p.roles.fail.stroke, backgroundColor: p.roles.fail.fill,
          roundness: { type: 3 }, strokeWidth: 2 };
        const badCap = await text("guessed from character counts", { fontSize: 13, color: grey.stroke });
        const goodBox = await card("doc.export_to_markdown()", "pass", { fontSize: 15, mono: true });
        const goodCap = await text("measured in a real browser", { fontSize: 13, color: grey.stroke });
        const left = column([badRect, badCap], { gap: 46 });
        const right = column([goodBox, goodCap], { gap: 14 });
        const body = row([left, right], { gap: 90, align: "start" });
        const title = await text("text width is measured, never guessed", { fontSize: 22 });
        const g = column([title, body], { gap: 30 });
        panels.push({
          g, name: "1 · guessed widths overflow — measured widths fit",
          post: async () => {
            // the overflow, drawn as a mock: free code text overhanging the red card
            const spill = await text("doc.export_to_markdown()", { fontSize: 15, fontFamily: CODE });
            spill.x = badRect.x + 10;
            spill.y = badRect.y + (badRect.height - spill.height) / 2;
            const oops = await text("✗ overflows when the real font renders",
              { fontSize: 13, color: p.roles.fail.stroke });
            oops.x = badRect.x;
            oops.y = badRect.y + badRect.height + 8;
            const ok = await text("✓ card sized from the measurement",
              { fontSize: 13, color: grey.stroke });
            ok.x = goodBox.x;
            ok.y = goodCap.y + goodCap.height + 6;
            return [spill, oops, ok];
          },
        });
      }

      // ── 2 · the pipeline: build → measure/convert → gate → artifacts ──────
      {
        const buildBox = await card("build() returns a skeleton", "local");
        const chromeBox = await card("measure · wrap · convert\nheadless Chrome", "local");
        const gateBox = await card("verifyDocument()", "decision", { mono: true });
        const failBox = await card("GateError — nothing written", "fail", { fontSize: 14 });
        const svgBox = await card("tour.excalidraw", "artifact", { fontSize: 14, mono: true });
        const svgBox2 = await card("tour.svg", "artifact", { fontSize: 14, mono: true });
        const gateCol = column([gateBox, failBox], { gap: 80, align: "center" });
        const artCol = column([svgBox, svgBox2], { gap: 26 });
        const body = row([buildBox, chromeBox, gateCol, artCol], { gap: [120, 120, 190], align: "start" });
        const title = await text("one call: authorDiagram — skeleton in, gated files out", { fontSize: 22 });
        const g = column([title, body], { gap: 30 });
        panels.push({
          g, name: "2 · the pipeline: build, measure, gate, write",
          post: () => [
            arrowBetween(buildBox, chromeBox, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle", label: "skeleton" }),
            arrowBetween(chromeBox, gateBox, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle", label: "elements" }),
            // one arrow to the artifact pair: a second, diagonal bound arrow gets
            // re-routed by the converter straight through its sibling box and the
            // gate rejects the crossing
            arrowBetween(gateBox, svgBox, { standoff: 10, strokeColor: p.roles.pass.stroke,
              strokeWidth: 2, endArrowhead: "triangle",
              label: { text: "0 defects", fontSize: 13, strokeColor: ink } }),
            arrowBetween(gateBox, failBox, { standoff: 10, strokeColor: p.roles.fail.stroke,
              strokeWidth: 2, endArrowhead: "bar" }),
          ],
        });
      }

      // ── 3 · components: author.js fans out; geometry.js is shared ─────────
      {
        const mod = async (name, sub, role) => {
          const n = await text(name, { fontSize: 15, fontFamily: CODE });
          const s = await text(sub, { fontSize: 12, color: grey.stroke });
          return box(column([n, s], { gap: 6 }), { padding: 12,
            strokeColor: p.roles[role]?.stroke ?? grey.stroke,
            backgroundColor: p.roles[role]?.fill ?? grey.fill,
            roundness: { type: 3 }, strokeWidth: 2 });
        };
        const authorM = await mod("author.js", "authors, gates, writes", "local");
        const layoutM = await mod("layout.js", "column · row · box · arrow", undefined);
        const verifyM = await mod("verify.js + check.js", "the gate's rules + CLI", "decision");
        const browserM = await mod("browser.js + page.js", "headless Chrome driver", undefined);
        const renderM = await mod("render.js · revise.js", "SVG, PNGs, round-trip", "artifact");
        const geomM = await mod("geometry.js", "one bounds definition", undefined);
        const mid = row([layoutM, verifyM, browserM, renderM], { gap: 34, align: "start" });
        const title = await text("author.js composes everything; geometry.js is shared", { fontSize: 22 });
        // fan gap must exceed the horizontal distance to the outer cards, or
        // arrowBetween picks the horizontal axis and the diagonal clips a neighbour
        const g = column([title, authorM, mid, geomM], { gap: [30, 220, 64], align: "center" });
        panels.push({
          g, name: "3 · the components, and who owns whom",
          post: () => [
            ...[layoutM, verifyM, browserM, renderM].map((m) =>
              arrowBetween(authorM, m, { standoff: 10, strokeColor: grey.stroke,
                strokeWidth: 2, endArrowhead: "diamond" })),
            arrowBetween(verifyM, geomM, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "diamond", label: { text: "shared bounds", fontSize: 13 } }),
          ],
        });
      }

      // ── 4 · layout helpers: the mock, labelled from beside ────────────────
      {
        const outer = { type: "rectangle", x: 0, y: 0, width: 210, height: 168,
          strokeColor: grey.stroke, backgroundColor: grey.fill, roundness: { type: 3 }, strokeWidth: 2 };
        const bars = [0, 1, 2].map((i) => ({ type: "rectangle", x: 20, y: 20 + i * 46,
          width: 170, height: 30, strokeColor: p.roles.local.stroke,
          backgroundColor: p.roles.local.fill, roundness: { type: 3 }, strokeWidth: 2 }));
        const mock = group([outer, ...bars], 210, 168);
        const lab = async (s) => text(s, { fontSize: 14, fontFamily: CODE, color: ink });
        const labels = column([
          await lab('box(content, { padding: 20 })'),
          await lab('column(items, { gap: 16 })'),
          await lab("measure() sized every bar"),
        ], { gap: 34 });
        const demoA = { type: "rectangle", width: 60, height: 40, strokeColor: grey.stroke,
          backgroundColor: grey.fill, roundness: { type: 3 }, strokeWidth: 2 };
        const demoB = { type: "rectangle", width: 60, height: 40, strokeColor: grey.stroke,
          backgroundColor: grey.fill, roundness: { type: 3 }, strokeWidth: 2 };
        const demo = row([demoA, demoB], { gap: 110, align: "center" });
        const demoCap = await text("arrowBetween leaves 10 px at each end — the arrow owns the gap",
          { fontSize: 13, color: grey.stroke });
        const title = await text("compose placement; never hand-accumulate offsets", { fontSize: 22 });
        const g = column([title, row([mock, labels], { gap: 70, align: "start" }),
                          demo, demoCap], { gap: [30, 44, 12] });
        panels.push({
          g, name: "4 · layout helpers: box, column, row, arrowBetween",
          post: () => {
            const leaders = bars.slice(0, 2).map((bar, i) => {
              const li = flat(labels)[i];
              const sx = li.x - 12;
              const sy = li.y + li.height / 2;
              const ex = bar.x + bar.width + 6;
              const ey = bar.y + bar.height / 2;
              return { type: "line", x: sx, y: sy, width: Math.abs(sx - ex), height: Math.abs(ey - sy),
                points: [[0, 0], [ex - sx, ey - sy]], strokeColor: grey.faint,
                strokeStyle: "dashed", strokeWidth: 1, roundness: null };
            });
            return [...leaders,
              arrowBetween(demoA, demoB, { standoff: 10, strokeColor: grey.stroke,
                strokeWidth: 2, label: { text: "gap", fontSize: 13 } })];
          },
        });
      }

      // ── 5 · the gate: a funnel — many in, few out ──────────────────────────
      {
        const sq = (x, y, role) => ({ type: "rectangle", x, y, width: 16, height: 16,
          strokeColor: p.roles[role]?.stroke ?? grey.stroke,
          backgroundColor: p.roles[role]?.fill ?? grey.fill, strokeWidth: 2 });
        const inSquares = [
          sq(0, 0, null), sq(4, 40, null), sq(0, 80, null), sq(4, 120, null), sq(0, 160, null),
          sq(52, 20, null), sq(56, 60, null), sq(52, 100, null), sq(56, 140, null),
          sq(104, 50, null), sq(108, 90, null), sq(104, 130, null),
        ];
        const wallTop = { type: "rectangle", x: 168, y: 0, width: 12, height: 70,
          strokeColor: p.roles.decision.stroke, backgroundColor: p.roles.decision.fill, strokeWidth: 2 };
        const wallBot = { type: "rectangle", x: 168, y: 106, width: 12, height: 70,
          strokeColor: p.roles.decision.stroke, backgroundColor: p.roles.decision.fill, strokeWidth: 2 };
        const outSquares = [sq(216, 80, "pass"), sq(252, 80, "pass"), sq(288, 80, "pass")];
        const rejected = [sq(136, 196, "fail"), sq(156, 200, "fail"), sq(176, 196, "fail")];
        const funnel = group([...inSquares, wallTop, wallBot, ...outSquares, ...rejected], 304, 216);
        const rules = await wrap(
          "Structure: parseable document, known element types, no duplicate ids, no dangling bindings, image bytes present. Geometry (rotation-aware): frames don't overlap, text fits its container, nothing escapes or squats on a frame, free texts don't collide, arrows don't cross strangers, arrowheads land outside their target. Style: 4.5:1 contrast, no text over images, house fonts only.",
          470, { fontSize: 13 });
        const rulesEl = { type: "text", text: rules.text, fontSize: 13, fontFamily: PROSE,
          strokeColor: grey.stroke, width: rules.width, height: rules.height };
        const cmd = await text("node tools/check.js d.excalidraw --json   # exit 0 clean · 1 defects · 2 unreadable",
          { fontSize: 13, fontFamily: CODE, color: grey.stroke });
        const title = await text("the gate rejects defects mechanically", { fontSize: 22 });
        const g = column([title, funnel, rulesEl, cmd], { gap: [30, 34, 18] });
        panels.push({ g, name: "5 · the gate: every rule, one exit code", post: () => [] });
      }

      // ── 6 · the loop: render, look, fix, re-gate ───────────────────────────
      {
        const renderB = await card("render.js", "local", { mono: true });
        const pngsB = await card("one PNG per frame", "artifact");
        const lookB = await card("look at every frame", "decision");
        const regateB = await card("fix, re-gate", "pass");
        const top = row([renderB, pngsB], { gap: 150, align: "center" });
        const bot = row([regateB, lookB], { gap: 150, align: "center" });
        const cmd = await text("node tools/render.js d.excalidraw --frame 3   # re-render one frame while iterating",
          { fontSize: 13, fontFamily: CODE, color: grey.stroke });
        const title = await text("JSON hides overlap; the picture shows it", { fontSize: 22 });
        const g = column([title, top, bot, cmd], { gap: [30, 90, 40] });
        panels.push({
          g, name: "6 · the loop: render, look, fix, re-gate",
          post: () => [
            arrowBetween(renderB, pngsB, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle" }),
            arrowBetween(pngsB, lookB, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle" }),
            arrowBetween(lookB, regateB, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle" }),
            arrowBetween(regateB, renderB, { standoff: 10, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle", label: { text: "until clean", fontSize: 13 } }),
          ],
        });
      }

      // ── 7 · real assets: bytes travel in the file ─────────────────────────
      {
        const logo = await image(join(root, "brand/AIWorx_logo.png"), { width: 150 });
        logo.id = uid("logo");
        const figure = spliceLibraryItem(join(root, "examples/stick-figure.excalidrawlib"));
        const dictLines = ['files["3fb9…"] = {', '  mimeType: "image/png",', '  dataURL: "data:image/png;base64,…"', "}"];
        const measured = await measure(dictLines.map((t) => ({ text: t, fontSize: 13, fontFamily: CODE })));
        const dictCol = column(dictLines.map((t, i) => ({ type: "text", text: t, fontSize: 13,
          fontFamily: CODE, strokeColor: ink, width: measured[i].width, height: measured[i].height })),
          { gap: 4 });
        const dictCard = box(dictCol, { padding: 16, strokeColor: p.roles.artifact.stroke,
          backgroundColor: p.roles.artifact.fill, roundness: { type: 3 }, strokeWidth: 2 });
        const cap = await text("spliceLibraryItem regenerates every id — place the same item twice, no collision",
          { fontSize: 13, color: grey.stroke });
        const title = await text("assets are bytes in the document, not paths", { fontSize: 22 });
        const body = row([logo, dictCard, figure], { gap: [70, 70], align: "center" });
        const g = column([title, body, cap], { gap: [30, 26] });
        panels.push({
          g, name: "7 · real assets: images and spliced library items",
          post: () => [
            arrowBetween(logo, dictCard, { standoff: 8, strokeColor: grey.stroke,
              strokeWidth: 2, endArrowhead: "triangle", label: { text: "sha1", fontSize: 13, fontFamily: CODE } }),
          ],
        });
      }

      // ── 8 · dark theme: measured contrast, light vs dark ──────────────────
      {
        const candidates = [
          ["ink / canvas", ink, p.canvas],
          ["local / local", p.roles.local.stroke, p.roles.local.fill],
          ["ink / artifact", ink, p.roles.artifact.stroke],
          ["ink / pass", ink, p.roles.pass.stroke],
          ["ink / decision", ink, p.roles.decision.stroke],
        ];
        const rated = candidates.map(([name, fg, bg]) => ({
          name, light: contrast(fg, bg), dark: contrast(toDarkTheme(fg), toDarkTheme(bg)),
        }));
        const trap = rated.slice(2).find((r) => r.light >= 4.5 && r.dark < 4.5)
          ?? rated.slice(2).sort((a, b) => (b.light - b.dark) - (a.light - a.dark))[0];
        const shown = [rated[0], rated[1], trap];

        const SCALE = 9, BAR_W = 32, INNER = 12, PITCH = 132;
        const maxH = Math.max(...shown.flatMap((r) => [r.light, r.dark])) * SCALE;
        const chart = [];
        const post8 = [];
        shown.forEach((r, i) => {
          const x0 = i * PITCH;
          for (const [j, [val, fill, stroke]] of [
            [0, [r.light, p.canvas, grey.stroke]],
            [1, [r.dark, ink, ink]],
          ]) {
            const h = val * SCALE;
            const x = x0 + j * (BAR_W + INNER);
            chart.push({ type: "rectangle", x, y: maxH - h, width: BAR_W, height: h,
              strokeColor: stroke, backgroundColor: fill, strokeWidth: 2, roughness: 0 });
            post8.push(async (base) => {
              const t = await text(val.toFixed(1), { fontSize: 12, fontFamily: CODE, color: grey.stroke });
              t.x = base.x + x + (BAR_W - t.width) / 2;
              t.y = base.y + maxH - h - t.height - 4;
              return t;
            });
          }
          post8.push(async (base) => {
            const t = await text(r.name, { fontSize: 12, color: grey.stroke });
            t.x = base.x + x0 + (BAR_W * 2 + INNER - t.width) / 2;
            t.y = base.y + maxH + 10;
            return t;
          });
        });
        const axis = { type: "line", x: -8, y: maxH, width: 2 * PITCH + BAR_W * 2 + INNER + 16, height: 0,
          points: [[0, 0], [2 * PITCH + BAR_W * 2 + INNER + 16, 0]], strokeColor: grey.stroke,
          strokeWidth: 2, roughness: 0, roundness: null };
        const chartGroup = group([...chart, axis], 2 * PITCH + BAR_W * 2 + INNER + 8, maxH + 2);
        const filterCap = await text("dark = invert(93%) hue-rotate(180deg) — one CSS filter over the light colours",
          { fontSize: 13, fontFamily: CODE, color: grey.stroke });
        const verdict = await text(
          `"${trap.name}" clears 4.5:1 in light (${trap.light.toFixed(1)}) and drops to ${trap.dark.toFixed(1)} dark — gate it with check.js --dark`,
          { fontSize: 13, color: grey.stroke });
        const title = await text("dark is a filter, and it does not preserve contrast", { fontSize: 22 });
        const g = column([title, chartGroup, filterCap, verdict], { gap: [36, 44, 10] });
        panels.push({
          g, name: "8 · dark exports: contrast re-measured, not assumed",
          post: async () => {
            const base = chartGroup;
            const out = [];
            for (const fn of post8) out.push(await fn(base));
            const thr = 4.5 * SCALE;
            out.push({ type: "line", x: base.x - 8, y: base.y + maxH - thr,
              width: 2 * PITCH + BAR_W * 2 + INNER + 16, height: 0,
              points: [[0, 0], [2 * PITCH + BAR_W * 2 + INNER + 16, 0]],
              strokeColor: p.roles.decision.stroke, strokeStyle: "dashed", strokeWidth: 1,
              roughness: 0, roundness: null });
            // decision gold fails 4.5:1 as text on canvas (3.72:1) — the gate
            // proved it; grey carries the label, the dashed gold line carries the role
            const thrLab = await text("4.5:1", { fontSize: 12, fontFamily: CODE,
              color: grey.stroke });
            thrLab.x = base.x + base.width + 14;
            thrLab.y = base.y + maxH - thr - thrLab.height / 2;
            out.push(thrLab);
            return out;
          },
        });
      }

      // ── 9 · the workflow: four commands on a timeline ──────────────────────
      {
        const steps = [
          ["CLAUDE_PLUGIN_ROOT=<plugin> node gen-tour.js",
           "the generator is the source of truth — withAuthoring measures, gates and writes the .excalidraw and its SVG"],
          ["node tools/check.js tour.excalidraw --json --dark",
           "re-prove any file: exit 0 clean, 1 defects, 2 unreadable; --dark re-scores contrast on the dark export"],
          ["node tools/render.js tour.excalidraw --out /tmp/tour",
           "SVG plus one PNG per frame in reading order; iterate with --frame N, --dark, --padding, --background"],
          ["node tools/revise.js tour.excalidraw",
           "after hand edits: re-measure text, repair bindings, re-infer frames, prune orphaned image bytes, re-gate, rewrite"],
        ];
        const stepEls = [];
        for (const [cmd, note] of steps) {
          const c = await text(cmd, { fontSize: 14, fontFamily: CODE });
          const w = await wrap(note, 430, { fontSize: 13 });
          stepEls.push(column([c, { type: "text", text: w.text, fontSize: 13, fontFamily: PROSE,
            strokeColor: grey.stroke, width: w.width, height: w.height }], { gap: 6 }));
        }
        const stepsCol = column(stepEls, { gap: 30, x: 36 });
        const title = await text("four commands run the whole loop", { fontSize: 22 });
        const g = column([title, stepsCol], { gap: 30 });
        panels.push({
          g, name: "9 · the workflow, end to end",
          post: () => {
            const dots = stepEls.map((s) => {
              const first = flat(s)[0];
              return { type: "ellipse", x: stepsCol.x - 36, y: first.y + first.height / 2 - 7,
                width: 14, height: 14, strokeColor: grey.stroke,
                backgroundColor: grey.fill, strokeWidth: 2 };
            });
            const y0 = dots[0].y + 7;
            const y1 = dots[dots.length - 1].y + 7;
            const spine = { type: "line", x: dots[0].x + 7, y: y0, width: 0, height: y1 - y0,
              points: [[0, 0], [0, y1 - y0]], strokeColor: grey.faint, strokeWidth: 2, roundness: null };
            return [spine, ...dots];
          },
        });
      }

      // ── place the band, run post passes, bind frames ───────────────────────
      row(panels.map((pl) => pl.g), { gap: 170, align: "start" });
      for (const [i, pl] of panels.entries()) {
        const own = idsOf(pl.g, `p${i + 1}`);   // ids exist before arrows bind to shapes
        const extra = await pl.post();
        extras.push(...extra);
        const children = [...own, ...extra.flatMap((e) => idsOf(e, `p${i + 1}x`))];
        frames.push({ type: "frame", id: uid("frame"), children, name: pl.name });
      }
      return [...panels.map((pl) => pl.g), ...extras, ...frames];
    },
  });
});
