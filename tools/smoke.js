#!/usr/bin/env node
/**
 * Verification gate for the toolchain. Proves, against the real library in a real
 * browser, that each capability the skill depends on actually works:
 *
 *   1. text is measured (not estimated) and the house families measure distinctly
 *   2. convertToExcalidrawElements sizes label containers and binds arrows
 *   3. frames auto-fit around their children
 *   4. exportToSvg embeds the fonts, so diagrams are portable
 *   5. exportingFrame crops to a single frame
 *   6. SVG rasterises to a non-empty PNG
 *   7. text metrics are unchanged after rasterising every frame
 *
 * Exits non-zero on any failure, with the measured values printed.
 */
import { writeFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withExcalidraw } from "./browser.js";

// Verification output is throwaway: elements carry random seeds, so writing
// under version control would dirty the repo on every run.
const outDir = mkdtempSync(join(tmpdir(), "aiworx-smoke-"));
console.log(`artifacts: ${outDir}`);

const NUNITO = 6;
const CASCADIA = 3;
const EXCALIFONT = 5;

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

await withExcalidraw(async (ex) => {
  // 1. measurement
  const ITEMS = [
    { text: "convert()", fontSize: 20, fontFamily: NUNITO },
    { text: "convert()", fontSize: 20, fontFamily: CASCADIA },
    { text: "convert()\nsecond line", fontSize: 20, fontFamily: NUNITO },
    { text: "convert()", fontSize: 20, fontFamily: EXCALIFONT },
  ];
  const m = await ex.measureText(ITEMS);
  check("text is measured", m[0].width > 0 && m[0].height > 0,
    `Nunito 20 "convert()" = ${m[0].width}x${m[0].height}`);
  check("multiline height scales", m[2].height > m[0].height * 1.5,
    `1 line ${m[0].height} vs 2 lines ${m[2].height}`);

  // The fallback trap: if fonts aren't registered every family measures the same
  // fallback width, layouts get computed against the wrong metrics, and text
  // overflows only once the real font renders. The tell is relative — distinct
  // registered families collapsing to one width — not any particular fallback
  // value, which is the browser's to choose and changes across Chrome releases.
  const fonts = await ex.fontStatus();
  const HOUSE = ["Nunito", "Cascadia", "Excalifont"];
  check("house families are registered with the page",
    HOUSE.every((f) => fonts.families.some((name) => name.includes(f))),
    `${fonts.registered} faces: ${fonts.families.join(", ")}; ${fonts.glyphs} glyphs warmed`);
  const familyWidths = [m[0].width, m[1].width, m[3].width];
  check("no two families collapse to one fallback width",
    new Set(familyWidths).size === familyWidths.length,
    `Nunito ${familyWidths[0]}, Cascadia ${familyWidths[1]}, Excalifont ${familyWidths[2]}`);
  const glyphProbe = await ex.measureText([
    { text: "→ ✓ ·", fontSize: 20, fontFamily: NUNITO },
  ]);
  check("new glyphs trigger a re-warm", glyphProbe[0].width > 0,
    `"→ ✓ ·" = ${glyphProbe[0].width}`);

  // 2 + 3. skeleton conversion: labels, bindings, frame auto-fit
  const converted = await ex.convert([
    { type: "rectangle", id: "a", x: 0, y: 0, width: 180, height: 80,
      label: { text: "parse", fontSize: 20, fontFamily: NUNITO } },
    { type: "rectangle", id: "b", x: 400, y: 0, width: 180, height: 80,
      label: { text: "layout", fontSize: 20, fontFamily: NUNITO } },
    { type: "arrow", x: 190, y: 40, start: { id: "a" }, end: { id: "b" } },
    { type: "frame", children: ["a", "b"], name: "1 · stages" },
    // a second frame, so the raster loop below exercises the multi-frame path
    // that single-frame examples never did — which is how the font-loss bug survived
    { type: "rectangle", id: "c", x: 700, y: 0, width: 180, height: 80,
      label: { text: "verify", fontSize: 20, fontFamily: NUNITO } },
    { type: "frame", children: ["c"], name: "2 · verify" },
  ]);
  const byType = (t) => converted.filter((e) => e.type === t);
  const labels = byType("text");
  const arrow = byType("arrow")[0];
  const [frame, frame2] = byType("frame");
  const rects = byType("rectangle");

  check("labels become bound text", labels.length === 3 && labels.every((t) => t.containerId),
    `${labels.length} text els, containerIds ${labels.map((t) => t.containerId).join(",")}`);
  check("label is sized by the library", labels[0].width > 0 && labels[0].height > 0,
    `${labels[0].width}x${labels[0].height}`);
  check("container records boundElements",
    rects.every((r) => (r.boundElements ?? []).some((b) => b.type === "text")));
  check("arrow binds both ends", !!arrow?.startBinding && !!arrow?.endBinding,
    `start=${arrow?.startBinding?.elementId} end=${arrow?.endBinding?.elementId}`);
  check("frame auto-fits children",
    frame && frame.width >= 580 && frame.height >= 80,
    `frame ${frame?.x},${frame?.y} ${frame?.width}x${frame?.height}`);
  check("children are bound to their frames",
    rects.filter((r) => r.frameId === frame?.id).length === 2 &&
      rects.filter((r) => r.frameId === frame2?.id).length === 1,
    `frame1 has ${rects.filter((r) => r.frameId === frame?.id).length}, ` +
      `frame2 has ${rects.filter((r) => r.frameId === frame2?.id).length}`);

  // 4. font embedding
  const appState = { viewBackgroundColor: "#FCFCFB" };
  const codeEl = await ex.convert([
    { type: "text", x: 0, y: 140, text: "images_scale = 2.0", fontSize: 16, fontFamily: CASCADIA },
  ]);
  const elements = [...converted, ...codeEl];
  const whole = await ex.exportSvg({ elements, appState });
  const fontFaces = (whole.svg.match(/@font-face/g) ?? []).length;
  check("fonts are embedded in the SVG", fontFaces > 0, `${fontFaces} @font-face blocks`);
  check("Nunito is embedded", /Nunito/i.test(whole.svg));
  check("Cascadia is embedded", /Cascadia/i.test(whole.svg));
  check("no external font URLs", !/@font-face[^}]*url\(https?:/i.test(whole.svg));

  // 5. per-frame export crops
  const framed = await ex.exportSvg({ elements, appState, exportingFrame: frame });
  check("exportingFrame crops to the frame",
    framed.width < whole.width && framed.height <= whole.height,
    `frame ${framed.width}x${framed.height} vs whole ${whole.width}x${whole.height}`);

  // 6. rasterise
  const svgPath = join(outDir, "smoke.svg");
  const pngPath = join(outDir, "smoke.png");
  writeFileSync(svgPath, whole.svg);
  writeFileSync(join(outDir, "smoke.excalidraw"), JSON.stringify(
    { type: "excalidraw", version: 2, source: "aiworx-excalidraw", elements, appState, files: {} },
    null, 2,
  ));
  await ex.svgToPng(whole.svg, pngPath);
  check("PNG is written and non-trivial", statSync(pngPath).size > 2000,
    `${statSync(pngPath).size} bytes`);

  // 7. measurement survives rasterisation. Rasterising used to rewrite the
  // document and drop the warmed fonts, so every measurement after the first
  // PNG silently fell back — invisible in single-frame runs, fatal in bands.
  for (const [i, f] of [frame, frame2].entries()) {
    const cropped = await ex.exportSvg({ elements, appState, exportingFrame: f });
    await ex.svgToPng(cropped.svg, join(outDir, `smoke-frame0${i + 1}.png`));
  }
  const m2 = await ex.measureText(ITEMS);
  const dims = (r) => r.map((x) => `${x.width}x${x.height}`).join(", ");
  check("metrics are identical after rasterising every frame",
    JSON.stringify(m2) === JSON.stringify(m),
    `before ${dims(m)} — after ${dims(m2)}`);
});

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
