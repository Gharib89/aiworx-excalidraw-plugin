#!/usr/bin/env node
/**
 * Derive the diagram palette from the AIWorx brand slots and verify it.
 *
 * Strokes are the brand's own validated categorical colours, used verbatim. Fills
 * are derived by snapping each stroke to a fixed high lightness in OKLCH — one
 * rule for all six, rather than six hand-picked tints that drift.
 *
 * Nothing is written unless every contrast check passes: body text must clear
 * 4.5:1 on its fill, and a stroke must clear 3:1 against the canvas.
 *
 * Usage: node tools/palette.js [--write]
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- colour maths (no dependencies) ----------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const rgbToHex = (rgb) =>
  "#" +
  rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb);
}

const toOklch = (hex) => {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
};
const fromOklch = ({ L, C, h }) => rgbToHex(oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]));

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// ---------- brand input ----------
// Hex values and slot order come from the AIWorx brand tokens. The brand's own
// validation rejected the raw theme accents as marks (accent1 too dark,
// accent4/accent6 sub-3:1 on white); these are the validated categorical slots.
const CANVAS = "#FCFCFB";
const INK = "#1A1A19";
const ROLES = [
  { role: "local", stroke: "#3A44D4", hue: "blue", means: "runs locally, on this machine" },
  { role: "artifact", stroke: "#0198CB", hue: "cyan", means: "an artifact or output" },
  { role: "pass", stroke: "#6E9A21", hue: "green", means: "a check that passed, a gate held" },
  { role: "remote", stroke: "#792A8E", hue: "purple", means: "leaves the machine — API, model call" },
  { role: "decision", stroke: "#A17E00", hue: "gold", means: "a decision, a threshold, a trap" },
  { role: "fail", stroke: "#B61E24", hue: "red", means: "what goes wrong" },
];
const GREY = {
  stroke: "#5B5B58",
  fill: "#F1F1EF",
  faint: "#B9B9B4",
  ink: INK,
  canvas: CANVAS,
};

// ---------- derive fills ----------
// Tuned so that every slot clears 3:1 stroke-on-own-fill; cyan is the binding
// constraint at L=0.965 (2.98:1), so fills sit slightly lighter and less chromatic.
const FILL_L = 0.975;
const FILL_C_MAX = 0.034;

const slots = ROLES.map((r) => {
  const { L, C, h } = toOklch(r.stroke);
  const fill = fromOklch({ L: FILL_L, C: Math.min(C, FILL_C_MAX), h });
  return { ...r, fill, strokeL: +L.toFixed(3), strokeC: +C.toFixed(3) };
});

// ---------- verify ----------
const fail = [];
const rows = [];
for (const s of slots) {
  const inkOnFill = contrast(INK, s.fill);
  const strokeOnCanvas = contrast(s.stroke, CANVAS);
  const strokeOnFill = contrast(s.stroke, s.fill);
  rows.push({
    role: s.role,
    stroke: s.stroke,
    fill: s.fill,
    "ink on fill": inkOnFill.toFixed(2),
    "stroke on canvas": strokeOnCanvas.toFixed(2),
    "stroke on fill": strokeOnFill.toFixed(2),
  });
  if (inkOnFill < 4.5) fail.push(`${s.role}: body text on fill only ${inkOnFill.toFixed(2)}:1`);
  if (strokeOnCanvas < 3) fail.push(`${s.role}: stroke on canvas only ${strokeOnCanvas.toFixed(2)}:1`);
  if (strokeOnFill < 3) fail.push(`${s.role}: stroke on own fill only ${strokeOnFill.toFixed(2)}:1`);
}

// Fills must read as a tint, not as the canvas and not as a block of colour.
// A contrast ratio can't see a chroma-only difference, so use OKLab distance.
const oklabDist = (a, b) => {
  const [p, q] = [rgbToOklab(hexToRgb(a)), rgbToOklab(hexToRgb(b))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
for (const s of slots) {
  const d = oklabDist(s.fill, CANVAS);
  if (d < 0.02) fail.push(`${s.role}: fill indistinguishable from canvas (ΔOKLab ${d.toFixed(3)})`);
  if (contrast(s.fill, CANVAS) > 1.25) {
    fail.push(`${s.role}: fill too dark against canvas (${contrast(s.fill, CANVAS).toFixed(2)}:1)`);
  }
}
// Adjacent fills must be tellable apart, or the colour coding conveys nothing.
for (let i = 0; i < slots.length; i++) {
  for (let j = i + 1; j < slots.length; j++) {
    const d = oklabDist(slots[i].fill, slots[j].fill);
    if (d < 0.02) {
      fail.push(`${slots[i].role}/${slots[j].role}: fills too close (ΔOKLab ${d.toFixed(3)})`);
    }
  }
}
const greyChecks = {
  "grey stroke on canvas": contrast(GREY.stroke, CANVAS),
  "ink on canvas": contrast(INK, CANVAS),
  "ink on grey fill": contrast(INK, GREY.fill),
};
for (const [name, v] of Object.entries(greyChecks)) {
  if (v < 4.5) fail.push(`${name} only ${v.toFixed(2)}:1`);
}

console.table(rows);
console.log(
  Object.entries(greyChecks)
    .map(([k, v]) => `${k}: ${v.toFixed(2)}:1`)
    .join("\n"),
);

if (fail.length) {
  console.error(`\n${fail.length} contrast failure(s):`);
  fail.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("\nall contrast checks passed");

if (process.argv.includes("--write")) {
  const out = {
    $comment:
      `Diagram palette for the AIWorx Excalidraw plugin. Strokes are the brand's validated categorical slots; fills are derived by OKLCH lightness-snapping (L=${FILL_L}, C<=${FILL_C_MAX}) and verified for contrast by tools/palette.js.`,
    canvas: CANVAS,
    ink: INK,
    fontFamily: { prose: 6, code: 3, $comment: "6 = Nunito, 3 = Cascadia; both ship with Excalidraw and embed on export" },
    grey: GREY,
    roles: Object.fromEntries(
      slots.map((s) => [s.role, { stroke: s.stroke, fill: s.fill, hue: s.hue, means: s.means }]),
    ),
  };
  const path = join(root, "brand/palette.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path}`);
}
