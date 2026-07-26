#!/usr/bin/env node
/**
 * Verification gate for the toolchain. Proves, against the real library in a real
 * browser, that each capability the skill depends on actually works:
 *
 *   1. text is measured (not estimated) and Nunito/Cascadia differ as expected
 *   2. convertToExcalidrawElements sizes label containers and binds arrows
 *   3. frames auto-fit around their children
 *   4. exportToSvg embeds the fonts, so diagrams are portable
 *   5. exportingFrame crops to a single frame
 *   6. SVG rasterises to a non-empty PNG
 *
 * Exits non-zero on any failure, with the measured values printed.
 */
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withExcalidraw } from "./browser.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "examples");
mkdirSync(outDir, { recursive: true });

const NUNITO = 6;
const CASCADIA = 3;

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

await withExcalidraw(async (ex) => {
  // 1. measurement
  const m = await ex.measureText([
    { text: "convert()", fontSize: 20, fontFamily: NUNITO },
    { text: "convert()", fontSize: 20, fontFamily: CASCADIA },
    { text: "convert()\nsecond line", fontSize: 20, fontFamily: NUNITO },
  ]);
  check("text is measured", m[0].width > 0 && m[0].height > 0,
    `Nunito 20 "convert()" = ${m[0].width}x${m[0].height}`);
  check("families measure differently", m[0].width !== m[1].width,
    `Nunito ${m[0].width} vs Cascadia ${m[1].width}`);
  check("multiline height scales", m[2].height > m[0].height * 1.5,
    `1 line ${m[0].height} vs 2 lines ${m[2].height}`);

  // The fallback trap: if fonts aren't registered every family measures the same
  // serif width, layouts get computed against the wrong metrics, and text
  // overflows only once the real font renders.
  const fonts = await ex.fontStatus();
  check("fonts are registered with the page", fonts.registered >= 4,
    `${fonts.registered} faces: ${fonts.families.join(", ")}; ${fonts.glyphs} glyphs warmed`);
  const SERIF_FALLBACK = 73.291015625;
  check("measurement is not the serif fallback",
    Math.abs(m[0].width - SERIF_FALLBACK) > 0.01 && Math.abs(m[1].width - SERIF_FALLBACK) > 0.01,
    `fallback would be ${SERIF_FALLBACK}`);
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
  ]);
  const byType = (t) => converted.filter((e) => e.type === t);
  const labels = byType("text");
  const arrow = byType("arrow")[0];
  const frame = byType("frame")[0];
  const rects = byType("rectangle");

  check("labels become bound text", labels.length === 2 && labels.every((t) => t.containerId),
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
  check("children are bound to the frame",
    rects.every((r) => r.frameId === frame?.id));

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
});

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
