/**
 * Colour maths shared by the palette validator (palette.js) and the gate's
 * contrast rule (check.js). No dependencies; contrast follows WCAG relative
 * luminance, perceptual distance uses OKLab.
 */

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

/** "#RGB"/"#RRGGBB" to canonical "#RRGGBB"; null for anything else ("transparent", undefined…). */
export function normalizeHex(c) {
  if (typeof c !== "string") return null;
  const m = c.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join("") : m[1];
  return "#" + h.toUpperCase();
}

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

export const toOklch = (hex) => {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
};
export const fromOklch = ({ L, C, h }) => rgbToHex(oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]));

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Alpha-composite fg over bg: fg·a + bg·(1−a) per channel, in non-linear sRGB —
 * the space the browser composites element opacity in. Both colours "#RRGGBB",
 * alpha 0..1. Commutes with toDarkTheme while the transform stays in gamut (the
 * filter chain is affine per channel until a channel clamps at 0 or 255);
 * tests/dark.js pins that on in-gamut pairs.
 */
export const blend = (fg, bg, alpha) => {
  const b = hexToRgb(bg);
  return rgbToHex(hexToRgb(fg).map((c, i) => c * alpha + b[i] * (1 - alpha)));
};

// Excalidraw's dark export is not a second palette: exportToSvg puts one CSS
// filter chain on the root <svg> — invert(93%) hue-rotate(180deg) — and every
// pixel, background rect included, goes through it. So a dark colour is a pure
// function of its light one, and dark contrast is computable from the light
// values. Images carry a counter-filter so photographs survive; shapes do not.
// The shorthand filter functions operate on non-linear sRGB (filter-effects §8),
// which is why this works on the hex values directly.
const DARK_INVERT = 0.93;
const HUE_ROTATE = 180;

const invert = (rgb, amount) => rgb.map((c) => c * (1 - amount) + (1 - c) * amount);

// filter-effects §8.6: the luminance-preserving hue rotation matrix.
function hueRotate(rgb, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  const m = [
    [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
    [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283],
    [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
  ];
  return m.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
}

/**
 * A colour as it renders in a dark-theme export. Null for anything that isn't a
 * hex — "transparent" has no dark form. Verified against Chrome in tests/dark.js.
 */
export function toDarkTheme(color) {
  const hex = normalizeHex(color);
  if (!hex) return null;
  return rgbToHex(hueRotate(invert(hexToRgb(hex), DARK_INVERT), HUE_ROTATE));
}

export const oklabDist = (a, b) => {
  const [p, q] = [rgbToOklab(hexToRgb(a)), rgbToOklab(hexToRgb(b))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
