/**
 * Brand override: the one shared discovery/derivation/verification path every
 * palette consumer loads through.
 *
 * A consumer project overrides the house palette with a small strokes-only
 * file, `.excalidraw-brand.json`, discovered by walking up from the current
 * working directory; the first hit wins. No file — or an explicit
 * `{ "defaults": "accepted" }` — means the house palette, unchanged. When the
 * file names strokes, the full palette is derived in memory on every read:
 * fills by the same OKLCH lightness-snapping rule the house palette was built
 * with, grey by neutralising chroma at the house grey's own lightness values
 * over the override's ink and canvas. The derived palette must pass every
 * contrast claim the house palette passes, in both the light and the dark
 * export; anything less refuses the run with a BrandOverrideError — never a
 * silent fall back to house colours, which is the exact failure the override
 * exists to end.
 *
 * Fonts are not overridable: the font IDs and the vendored woff2 files sit
 * under bundle discipline, so the derived palette always carries the house
 * fontFamily.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, fromOklch, oklabDist, toDarkTheme, toOklch } from "./color.js";
import { BrandOverrideError } from "./errors.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The role names an override must cover — the palette's public vocabulary. */
const ROLE_NAMES = ["local", "artifact", "pass", "remote", "decision", "fail"];

/** The shipped AIWorx palette — what every consumer gets when no override exists. */
export const housePalette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

/** The well-known override file name, shared by discovery and its documentation. */
export const OVERRIDE_FILENAME = ".excalidraw-brand.json";

/**
 * The nearest override file at or above `cwd`, or null when none exists all the
 * way up to the filesystem root.
 */
export function findBrandOverride(cwd) {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, OVERRIDE_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The palette this run authors, checks and renders with: the house palette, or
 * the one derived from the nearest brand override. Derivation and verification
 * run on every call — there is no generated palette file to go stale.
 *
 * @throws {BrandOverrideError} when an override exists but fails the schema or
 *   any contrast claim.
 */
// ---- derivation ----
// Tuned so that every slot clears 3:1 stroke-on-own-fill; cyan is the binding
// constraint at L=0.965 (2.98:1), so fills sit slightly lighter and less chromatic.
export const FILL_L = 0.975;
export const FILL_C_MAX = 0.034;

/** One rule for every fill: snap the stroke to a fixed high lightness in OKLCH. */
export function snapFill(stroke) {
  const { C, h } = toOklch(stroke);
  return fromOklch({ L: FILL_L, C: Math.min(C, FILL_C_MAX), h });
}

/** A pure neutral (zero-chroma) colour at the lightness of the given one. */
const neutralAtLightnessOf = (hex) => fromOklch({ L: toOklch(hex).L, C: 0, h: 0 });

/**
 * The full palette an override's strokes imply, in the exact shape the house
 * palette file has: fills snapped from the strokes, grey neutralised at the
 * house grey's own lightness values over the override's ink and canvas, the
 * house fontFamily (fonts are not overridable) and the house `means` prose
 * (the role vocabulary is fixed; only its colours move). No `hue` — the house
 * hue names describe house strokes, and nothing reads it at runtime.
 */
export function deriveBrandPalette({ canvas, ink, roles }) {
  return {
    canvas,
    ink,
    fontFamily: housePalette.fontFamily,
    grey: {
      stroke: neutralAtLightnessOf(housePalette.grey.stroke),
      fill: neutralAtLightnessOf(housePalette.grey.fill),
      faint: neutralAtLightnessOf(housePalette.grey.faint),
      ink,
      canvas,
    },
    roles: Object.fromEntries(
      ROLE_NAMES.map((name) => [
        name,
        { stroke: roles[name], fill: snapFill(roles[name]), means: housePalette.roles[name].means },
      ]),
    ),
  };
}

// ---- verification ----

/**
 * Every contrast and separation claim the palette makes, over one set of
 * rendered colours. `paint` is identity for the light export and the
 * dark-theme filter for the dark one; the rules are the same either way
 * because the filter changes what is on screen, not what the diagram promises
 * about it. Returns the failures plus the per-role rows and grey ratios the
 * palette tool prints as its report.
 */
export function verifyPalette(palette, paint) {
  const canvas = paint(palette.canvas);
  const ink = paint(palette.ink);
  const fail = [];
  const rows = [];
  const slots = Object.entries(palette.roles).map(([role, v]) => ({ role, ...v }));
  for (const s of slots) {
    const [stroke, fill] = [paint(s.stroke), paint(s.fill)];
    const inkOnFill = contrast(ink, fill);
    const strokeOnCanvas = contrast(stroke, canvas);
    const strokeOnFill = contrast(stroke, fill);
    rows.push({
      role: s.role,
      stroke,
      fill,
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
  for (const s of slots) {
    const fill = paint(s.fill);
    const d = oklabDist(fill, canvas);
    if (d < 0.02) fail.push(`${s.role}: fill indistinguishable from canvas (ΔOKLab ${d.toFixed(3)})`);
    if (contrast(fill, canvas) > 1.25) {
      fail.push(`${s.role}: fill too dark against canvas (${contrast(fill, canvas).toFixed(2)}:1)`);
    }
  }
  // Adjacent fills must be tellable apart, or the colour coding conveys nothing.
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const d = oklabDist(paint(slots[i].fill), paint(slots[j].fill));
      if (d < 0.02) {
        fail.push(`${slots[i].role}/${slots[j].role}: fills too close (ΔOKLab ${d.toFixed(3)})`);
      }
    }
  }
  const greyChecks = {
    "grey stroke on canvas": contrast(paint(palette.grey.stroke), canvas),
    "ink on canvas": contrast(ink, canvas),
    "ink on grey fill": contrast(ink, paint(palette.grey.fill)),
  };
  for (const [name, v] of Object.entries(greyChecks)) {
    if (v < 4.5) fail.push(`${name} only ${v.toFixed(2)}:1`);
  }
  return { fail, rows, greyChecks };
}

/** The two exports every claim is scored against: authored colours, and what
 * Excalidraw's dark-theme filter renders them as. */
export const THEMES = [
  { name: "light export", paint: (c) => c },
  { name: "dark export (invert 93% + hue-rotate 180deg)", paint: toDarkTheme },
];

/** verifyPalette over both themes: theme-prefixed failures plus each theme's report. */
export function verifyBothThemes(palette) {
  const fail = [];
  const reports = [];
  for (const theme of THEMES) {
    const result = verifyPalette(palette, theme.paint);
    reports.push({ theme: theme.name, canvas: theme.paint(palette.canvas), ink: theme.paint(palette.ink), ...result });
    fail.push(...result.fail.map((f) => `${theme.name}: ${f}`));
  }
  return { fail, reports };
}

// ---- schema ----

const HEX = /^#[0-9a-fA-F]{6}$/;

const refuse = (what, path, remedy = "Fix the override file, or delete it to keep the house palette") => {
  throw new BrandOverrideError(what, { where: path, next: remedy });
};

/**
 * The parsed strokes an override file names, or null when the file records
 * `{ "defaults": "accepted" }` — the explicit decision to keep the house
 * palette. Anything else the file could contain refuses: a schema the loader
 * would have to guess at is the silent fallback this module exists to end.
 */
export function parseBrandOverride(text, path) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    refuse(`is not valid JSON — ${err.message}`, path);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    refuse("must be a JSON object", path);
  }
  for (const key of Object.keys(data)) {
    if (!["canvas", "ink", "roles", "defaults", "$comment"].includes(key)) {
      refuse(`names an unknown key "${key}" — allowed: canvas, ink, roles, defaults, $comment`, path);
    }
  }
  // roles wins over defaults when both appear, per the override contract
  if (data.roles === undefined) {
    if (data.defaults === "accepted") return null;
    refuse(
      data.defaults === undefined
        ? 'names neither "roles" nor "defaults": "accepted"'
        : `has "defaults": ${JSON.stringify(data.defaults)} — the only accepted value is "accepted"`,
      path,
    );
  }
  if (typeof data.roles !== "object" || data.roles === null || Array.isArray(data.roles)) {
    refuse('"roles" must be an object mapping role names to stroke hexes', path);
  }
  const missing = ROLE_NAMES.filter((name) => data.roles[name] === undefined);
  if (missing.length) refuse(`is missing role(s): ${missing.join(", ")} — all six are required`, path);
  const unknown = Object.keys(data.roles).filter((name) => !ROLE_NAMES.includes(name));
  if (unknown.length) refuse(`names unknown role(s): ${unknown.join(", ")} — the roles are ${ROLE_NAMES.join(", ")}`, path);
  for (const [slot, value] of [["canvas", data.canvas], ["ink", data.ink], ...ROLE_NAMES.map((n) => [`roles.${n}`, data.roles[n]])]) {
    if (typeof value !== "string" || !HEX.test(value)) {
      refuse(`"${slot}" must be a 6-digit hex colour like #1A2B3C, got ${JSON.stringify(value)}`, path);
    }
  }
  return { canvas: data.canvas, ink: data.ink, roles: Object.fromEntries(ROLE_NAMES.map((n) => [n, data.roles[n]])) };
}

/**
 * The palette this run authors, checks and renders with: the house palette, or
 * the one derived from the nearest brand override. Derivation and verification
 * run on every call — there is no generated palette file to go stale.
 *
 * @throws {BrandOverrideError} when an override exists but fails the schema or
 *   any contrast claim.
 */
export function loadBrandPalette({ cwd = process.cwd() } = {}) {
  const path = findBrandOverride(cwd);
  if (path === null) return housePalette;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    refuse(`cannot be read — ${err.message}`, path);
  }
  const strokes = parseBrandOverride(text, path);
  if (strokes === null) return housePalette;
  const palette = deriveBrandPalette(strokes);
  const { fail } = verifyBothThemes(palette);
  if (fail.length) {
    refuse(
      `fails ${fail.length} contrast claim(s):\n${fail.map((f) => `  ${f}`).join("\n")}`,
      path,
      `Run: node tools/palette.js ${path} for the full report`,
    );
  }
  return palette;
}
