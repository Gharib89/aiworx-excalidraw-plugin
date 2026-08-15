#!/usr/bin/env node
/**
 * Derive the diagram palette and verify it — the house palette by default, a
 * brand override file when one is named.
 *
 * Strokes are used verbatim. Fills are derived by snapping each stroke to a
 * fixed high lightness in OKLCH — one rule for all six, rather than six
 * hand-picked tints that drift (tools/brand.js carries the rule). Every check
 * runs twice — once on the authored colours, once on what a dark export
 * renders, because Excalidraw's dark theme is a filter over the same values
 * and its ratios are not the light ones.
 *
 * House mode: verify the constants below, and with `--write` rewrite
 * brand/palette.json — nothing is written unless every check passes. The house
 * grey is hand-pinned, not derived, so --write never moves it.
 *
 * Override mode: name a `.excalidraw-brand.json`-shaped file and the tool
 * prints the palette it derives, the contrast report for both themes, and a
 * verdict — the preflight for anyone writing an override by hand or by agent.
 * Exit 0 when every claim holds, 1 when any fails.
 *
 * Usage: node tools/palette.js [override.json] [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BrandOverrideError } from "./errors.js";
import { snapFill, deriveBrandPalette, parseBrandOverride, verifyPalette, THEMES, FILL_L, FILL_C_MAX } from "./brand.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: palette.js [override.json] [--write]  (--write only in house mode)";

// ---- brand input (house mode) ----
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
// Hand-pinned, not derived: the house grey carries a deliberate warm tint the
// override derivation (neutral chroma) does not reproduce.
const GREY = {
  stroke: "#5B5B58",
  fill: "#F1F1EF",
  faint: "#B9B9B4",
  ink: INK,
  canvas: CANVAS,
};

const args = process.argv.slice(2);
const write = args.includes("--write");
// same rule as the shared parseFlags: a dash-prefixed argument that is not a
// known flag is a typo, never a file path — `--wrote x.json` must not verify
// x.json as if --write had been dropped on purpose
const positionals = args.filter((a) => a !== "--write");
const typo = positionals.find((a) => a.startsWith("-"));
if (typo !== undefined || positionals.length > 1 || (write && positionals.length)) {
  console.error(`UsageError: ${typo ? `unknown flag ${typo} — ` : ""}${USAGE}`);
  process.exit(2);
}
const overrideFile = positionals[0] ?? null;

/** The palette under test: derived from the named override, or the house constants. */
let palette;
if (overrideFile) {
  let strokes;
  try {
    strokes = parseBrandOverride(readFileSync(overrideFile, "utf8"), overrideFile);
  } catch (err) {
    if (!(err instanceof BrandOverrideError) && err?.code !== "ENOENT") throw err;
    console.error(err instanceof BrandOverrideError ? `${err.name}: ${err.message}` : `${overrideFile}: cannot be read — ${err.message}`);
    process.exit(1);
  }
  if (strokes === null) {
    console.log(`${overrideFile} records { "defaults": "accepted" } — the house palette applies, nothing to derive`);
    process.exit(0);
  }
  palette = deriveBrandPalette(strokes);
  console.log("derived palette:");
  console.log(JSON.stringify(palette, null, 2));
} else {
  palette = {
    canvas: CANVAS,
    ink: INK,
    grey: GREY,
    roles: Object.fromEntries(ROLES.map((r) => [r.role, { stroke: r.stroke, fill: snapFill(r.stroke) }])),
  };
}

// ---- verify ----
const fail = [];
for (const theme of THEMES) {
  const result = verifyPalette(palette, theme.paint);
  console.log(`\n${theme.name} — canvas ${theme.paint(palette.canvas)}, ink ${theme.paint(palette.ink)}`);
  console.table(result.rows);
  console.log(
    Object.entries(result.greyChecks)
      .map(([k, v]) => `${k}: ${v.toFixed(2)}:1`)
      .join("\n"),
  );
  fail.push(...result.fail.map((f) => `${theme.name}: ${f}`));
}

if (fail.length) {
  console.error(`\n${fail.length} contrast failure(s):`);
  fail.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("\nall contrast checks passed");

if (write) {
  const out = {
    $comment:
      `Diagram palette for the AIWorx Excalidraw plugin. Strokes are the brand's validated categorical slots; fills are derived by OKLCH lightness-snapping (L=${FILL_L}, C<=${FILL_C_MAX}) and verified for contrast by tools/palette.js.`,
    canvas: CANVAS,
    ink: INK,
    fontFamily: { prose: 6, code: 3, $comment: "6 = Nunito, 3 = Cascadia; both ship with Excalidraw and embed on export" },
    grey: GREY,
    roles: Object.fromEntries(
      ROLES.map((r) => [r.role, { stroke: r.stroke, fill: snapFill(r.stroke), hue: r.hue, means: r.means }]),
    ),
  };
  const path = join(root, "brand/palette.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path}`);
}
