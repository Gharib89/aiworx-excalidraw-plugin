#!/usr/bin/env node
/**
 * Guards palette.md's published hexes against brand/palette.json and the dark
 * derivation, both of which tools/palette.js can rewrite with `--write`.
 *
 * Nothing else checks this: a re-tuned role colour or a re-run of the dark
 * derivation ships stale prose with green CI unless something reads the
 * numbers back out of the doc and compares them to the source of truth.
 *
 * The invariants:
 *
 *   1. every role row in the Roles table — stroke and fill — matches
 *      brand/palette.json's roles.<name>.stroke/.fill, and the table covers
 *      exactly the six roles the json has, no more, no fewer.
 *   2. the `palette.canvas` hex quoted in prose matches palette.canvas.
 *   3. the "Dark exports" section's three quoted numbers — the dark canvas,
 *      the dark ink, and `pass`'s dark stroke-on-own-fill ratio — match what
 *      tools/color.js's toDarkTheme/contrast actually compute from the light
 *      values. Pure functions, no Chrome.
 *   4. the "Brand onboarding" section's hue-angle table matches toOklch of the
 *      same strokes — the mapping procedure it teaches is arithmetic against
 *      those angles, so a re-tuned stroke silently invalidates the recipe.
 *   5. the worked example's diff table names every role once and quotes each
 *      role's `means` prose verbatim from brand/palette.json.
 *   6. that section's two worked-example overrides still behave as the prose
 *      says: the as-mined one is refused with exactly the failures it quotes,
 *      and the iterated one passes every claim. A tightened contrast rule that
 *      turns the worked example into a lie goes red here.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDarkTheme, contrast, toOklch } from "../tools/color.js";
import { deriveBrandPalette, parseBrandOverride, verifyPalette, THEMES } from "../tools/brand.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const palette = JSON.parse(read("brand/palette.json"));
const doc = read("skills/excalidraw-diagram/reference/palette.md");

// ---- 1. the Roles table matches brand/palette.json's roles, exactly ----
const roleRows = [...doc.matchAll(/^\|\s*`([a-z]+)`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|$/gm)].map(
  (m) => ({ role: m[1], stroke: m[2], fill: m[3] }),
);
check("the Roles table has rows", roleRows.length > 0);

const jsonRoles = Object.keys(palette.roles);
/**
 * A doc table names every role in brand/palette.json, once each. Deduplicating
 * before the count is what makes a repeated row fail instead of standing in for
 * the role it displaced.
 */
const coversAllRoles = (label, docRoles) => {
  const named = new Set(docRoles);
  check(
    `${label} covers exactly the six roles in brand/palette.json, once each`,
    named.size === docRoles.length && named.size === jsonRoles.length && jsonRoles.every((r) => named.has(r)),
    `doc: ${docRoles.join(", ") || "none"} — json: ${jsonRoles.join(", ")}`,
  );
};
coversAllRoles("the Roles table", roleRows.map((r) => r.role));

for (const row of roleRows) {
  const want = palette.roles[row.role];
  if (!want) {
    check(`palette.md role "${row.role}" exists in brand/palette.json`, false);
    continue;
  }
  check(
    `palette.md's ${row.role} stroke matches brand/palette.json`,
    row.stroke === want.stroke,
    `doc ${row.stroke}, json ${want.stroke}`,
  );
  check(
    `palette.md's ${row.role} fill matches brand/palette.json`,
    row.fill === want.fill,
    `doc ${row.fill}, json ${want.fill}`,
  );
}

// ---- 2. the palette.canvas claim ----
const canvasMatch = doc.match(/`palette\.canvas`\s*=\s*`(#[0-9A-Fa-f]{6})`/);
check("palette.md quotes palette.canvas", canvasMatch !== null);
if (canvasMatch) {
  check(
    "palette.md's palette.canvas matches brand/palette.json",
    canvasMatch[1] === palette.canvas,
    `doc ${canvasMatch[1]}, json ${palette.canvas}`,
  );
}

// ---- 3. the Dark exports section's derived constants ----
const darkMatch = doc.match(/the canvas becomes `(#[0-9A-Fa-f]{6})`, ink `(#[0-9A-Fa-f]{6})`/);
check("palette.md quotes the dark canvas and ink", darkMatch !== null);
if (darkMatch) {
  const [, docDarkCanvas, docDarkInk] = darkMatch;
  const wantDarkCanvas = toDarkTheme(palette.canvas);
  const wantDarkInk = toDarkTheme(palette.ink);
  check(
    "palette.md's dark canvas matches toDarkTheme(palette.canvas)",
    docDarkCanvas === wantDarkCanvas,
    `doc ${docDarkCanvas}, computed ${wantDarkCanvas}`,
  );
  check(
    "palette.md's dark ink matches toDarkTheme(palette.ink)",
    docDarkInk === wantDarkInk,
    `doc ${docDarkInk}, computed ${wantDarkInk}`,
  );
}

const ratioMatch = doc.match(/`pass` stroke-on-own-fill at (\d+\.\d+):1/);
check("palette.md quotes pass's dark stroke-on-own-fill ratio", ratioMatch !== null);
if (ratioMatch) {
  const docRatio = ratioMatch[1];
  // tools/palette.js's "stroke on own fill" check, under the dark paint function.
  const pass = palette.roles.pass;
  const wantRatio = contrast(toDarkTheme(pass.stroke), toDarkTheme(pass.fill)).toFixed(2);
  check(
    "palette.md's quoted ratio matches contrast(toDarkTheme(pass.stroke), toDarkTheme(pass.fill))",
    docRatio === wantRatio,
    `doc ${docRatio}:1, computed ${wantRatio}:1`,
  );
}

// ---- the Brand onboarding section ----
// Scoped to its own heading: the file has an earlier schema block and an
// earlier role table, and neither belongs to the onboarding invariants.
const onboarding = (doc.split(/^## Brand onboarding$/m)[1] ?? "").split(/^## /m)[0];
check("palette.md has a Brand onboarding section", onboarding !== "");

// ---- 4. the hue table matches brand/palette.json and toOklch of its strokes ----
const hueDegrees = (hex) => Math.round((((toOklch(hex).h * 180) / Math.PI) + 360) % 360) % 360;
const hueRows = [...onboarding.matchAll(/^\|\s*`([a-z]+)`\s*\|\s*([a-z]+)\s*\|\s*(\d+)°\s*\|/gm)].map((m) => ({
  role: m[1],
  hue: m[2],
  angle: Number(m[3]),
}));
coversAllRoles("the onboarding hue table", hueRows.map((r) => r.role));
for (const row of hueRows) {
  const want = palette.roles[row.role];
  if (!want) continue; // coversAllRoles already reported it
  check(
    `the onboarding table's ${row.role} hue name matches brand/palette.json`,
    row.hue === want.hue,
    `doc ${row.hue}, json ${want.hue}`,
  );
  check(
    `the onboarding table's ${row.role} hue angle matches toOklch of its stroke`,
    row.angle === hueDegrees(want.stroke),
    `doc ${row.angle}°, computed ${hueDegrees(want.stroke)}°`,
  );
}

// ---- 5. the worked example's diff table quotes the role vocabulary verbatim ----
// The `means` column is a cache of brand/palette.json's own prose (SKILL.md's
// House style table renders the same strings), so it is held to the source.
const diffRows = [...onboarding.matchAll(/^\|\s*`([a-z]+)`\s*\|\s*`#[0-9A-Fa-f]{6}`[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/gm)].map(
  (m) => ({ role: m[1], means: m[2] }),
);
coversAllRoles("the worked example's diff table", diffRows.map((r) => r.role));
for (const row of diffRows) {
  const want = palette.roles[row.role];
  if (!want) continue; // coversAllRoles already reported it
  check(
    `the diff table's ${row.role} meaning matches brand/palette.json`,
    row.means === want.means,
    `doc "${row.means}", json "${want.means}"`,
  );
}

// ---- 6. the worked example still behaves as the prose says ----
// Fenced blocks, paired by their opening fence: matching bare ``` first would
// pair a json block's closing fence with the next block's opening one.
const blocks = [...onboarding.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2] }));
const overrides = blocks.filter((b) => b.lang === "json").map((b) => b.body);
check("the worked example carries two overrides — as mined, then iterated", overrides.length === 2, `${overrides.length} found`);
if (overrides.length === 2) {
  // A block the schema rejects is a FAIL line like any other — a stack trace
  // out of parseBrandOverride would leave the suite's own report unreadable.
  const failuresOf = (source, label) => {
    try {
      const derived = deriveBrandPalette(parseBrandOverride(source, label));
      return THEMES.flatMap((theme) => verifyPalette(derived, theme.paint).fail.map((f) => `${theme.name}: ${f}`));
    } catch (err) {
      check(`the ${label} override parses as a brand override`, false, err.message);
      return null;
    }
  };
  const mined = failuresOf(overrides[0], "worked example, as mined");
  const iterated = failuresOf(overrides[1], "worked example, iterated");

  // The doc quotes verifyPalette's own failure lines, theme prefix included —
  // the same strings tools/palette.js prints from that list.
  const quoted = blocks
    .filter((b) => b.lang === "" || b.lang === "text")
    .map((b) => b.body.trim().split("\n").map((l) => l.trim()))
    .find((lines) => lines.some((l) => l.includes("stroke on own fill only")));
  check("the worked example quotes the refusal", quoted !== undefined);
  if (quoted && mined) {
    check(
      "the quoted refusal matches what verifyPalette reports for the as-mined override",
      quoted.length === mined.length && quoted.every((l, i) => l === mined[i]),
      `doc ${quoted.length} line(s), tool ${mined.length}: ${mined.join(" | ")}`,
    );
  }
  if (iterated) {
    check("the iterated worked example passes every contrast claim", iterated.length === 0, iterated.join(" | "));
  }
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\npalette.md matches brand/palette.json and its dark derivation");
process.exit(fail.length ? 1 : 0);
