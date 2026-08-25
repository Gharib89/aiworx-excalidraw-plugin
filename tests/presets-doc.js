#!/usr/bin/env node
/**
 * Guards authoring.md's published preset table against tools/presets.js.
 *
 * The shipped skill travels without this repo, so that table is the only place
 * a generator author can read what `slide-16x9` actually does. Nothing else
 * checks it: retuning a ramp rung or adding a preset ships stale prose with
 * green CI unless something reads the numbers back out of the doc and compares
 * them to the source of truth. Same job palette-doc.js does for the hexes.
 *
 * The invariants:
 *
 *   1. the table lists exactly the presets PRESETS declares — no row for a
 *      preset that was dropped, no preset missing a row;
 *   2. every row's three ramp rungs match that preset's ramp;
 *   3. every row's surface matches — `fit`'s row states no dimensions, and
 *      every other row states its own width × height.
 *
 * Chrome-free: it reads a JSON-shaped module and a markdown file.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESETS, PRESET_NAMES } from "../tools/presets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(join(root, "skills/excalidraw-diagram/reference/authoring.md"), "utf8");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

/**
 * One row per preset: the name in backticks, then a surface cell, then the
 * three ramp rungs. The name cell carries "(default)" on one row, so the
 * capture stops at the backtick rather than at the cell edge.
 */
const rows = [...doc.matchAll(/^\|\s*`([a-z0-9-]+)`[^|]*\|([^|]+)\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/gm)]
  .map((m) => ({
    name: m[1],
    surface: m[2].trim(),
    ramp: { title: Number(m[3]), label: Number(m[4]), sublabel: Number(m[5]) },
  }));

check("the preset table has rows", rows.length > 0, `${rows.length} rows`);
check("the table lists exactly the presets that exist",
  JSON.stringify(rows.map((r) => r.name)) === JSON.stringify(PRESET_NAMES),
  `${rows.map((r) => r.name).join(", ")} vs ${PRESET_NAMES.join(", ")}`);

for (const row of rows) {
  const preset = PRESETS[row.name];
  if (!preset) continue; // already reported by the row-set check above
  check(`${row.name}'s published ramp matches its ramp`,
    JSON.stringify(row.ramp) === JSON.stringify(preset.ramp),
    `${JSON.stringify(row.ramp)} vs ${JSON.stringify(preset.ramp)}`);

  // `fit` targets nothing, so its cell states that in prose rather than in
  // numbers — any digit pair there would be a surface it does not have
  const stated = row.surface.match(/(\d+)\s*×\s*(\d+)/);
  check(`${row.name}'s published surface matches its surface`,
    preset.surface === null
      ? stated === null
      : stated !== null &&
        Number(stated[1]) === preset.surface.width && Number(stated[2]) === preset.surface.height,
    `"${row.surface}" vs ${JSON.stringify(preset.surface)}`);
}

console.log(
  fail.length
    ? `\n${fail.length} FAILED: ${fail.join(", ")}`
    : `\nthe published preset table matches tools/presets.js — ${rows.length} presets`,
);
process.exit(fail.length ? 1 : 0);
