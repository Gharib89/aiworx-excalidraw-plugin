#!/usr/bin/env node
/**
 * Dark-theme export suite. Excalidraw's dark export is not a second palette: it
 * is one CSS filter chain on the root <svg>, so every dark pixel is a pure
 * function of the light one. That makes dark contrast computable — this suite
 * pins the maths against the browser and proves the gate can be pointed at it:
 *
 *   1. toDarkTheme reproduces what Chrome's filter pipeline actually produces
 *   2. the transform's own invariants (idempotent hue pair, mid-grey fixed point)
 *   3. check.js --dark scores contrast on the transformed colours, so a pair that
 *      passes light and fails dark is caught — and a clean file stays clean
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toDarkTheme, contrast } from "../tools/color.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "tools/check.js");
const fixture = (name) => join(root, "tests/fixtures", `${name}.excalidraw`);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// ---- 1. the transform against the browser ----
// Ground truth: each light colour filled into a canvas under
// ctx.filter = "invert(93%) hue-rotate(180deg)" — the exact chain exportToSvg
// puts on the root <svg> for a dark export — and the centre pixel read back.
// Chrome 8-bit rounding differs from float maths by at most one or two levels.
const MEASURED = [
  ["#FCFCFB", "#141413"], // canvas
  ["#1A1A19", "#D6D6D5"], // ink
  ["#5B5B58", "#9E9E9B"], // grey stroke
  ["#F1F1EF", "#1D1D1B"], // grey fill
  ["#B9B9B4", "#4F4F4B"], // grey faint
  ["#3A44D4", "#9BA4FF"], // local
  ["#0198CB", "#199BC7"], // artifact
  ["#6E9A21", "#61871F"], // pass
  ["#792A8E", "#E4A0F6"], // remote
  ["#A17E00", "#A18316"], // decision
  ["#B61E24", "#FF9A9F"], // fail
  ["#000000", "#EDEDED"],
  ["#FFFFFF", "#111111"],
  ["#145A32", "#82BE9B"], // the dark-contrast fixture's ink
  ["#F5B7B1", "#6E3934"], // the dark-contrast fixture's fill
];
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const delta = (a, b) => Math.max(...channels(a).map((v, i) => Math.abs(v - channels(b)[i])));

let worst = 0;
for (const [light, chrome] of MEASURED) {
  const got = toDarkTheme(light);
  const d = delta(got, chrome);
  worst = Math.max(worst, d);
  check(`${light} transforms as Chrome renders it`, d <= 2, `got ${got}, Chrome ${chrome} (Δ${d})`);
}
check("no colour drifts more than two 8-bit levels from the browser", worst <= 2, `worst Δ${worst}`);

// ---- 2. invariants of the chain ----
{
  // The point of the theme: the light ground goes dark and the dark ink goes
  // light. Applying it twice does not return the original — invert(93%) has slope
  // -0.86, so the pair contracts toward mid-grey — which is why nothing here
  // treats the transform as reversible.
  check("the canvas darkens and the ink lightens",
    contrast(toDarkTheme("#FCFCFB"), "#000000") < 1.5 && contrast(toDarkTheme("#1A1A19"), "#FFFFFF") < 1.5,
    `${toDarkTheme("#FCFCFB")} / ${toDarkTheme("#1A1A19")}`);
  // 93%, not 100%: the inversion pivots at 0.5 regardless of amount, so mid-grey
  // barely moves and greys stay greys instead of swapping ends of the ramp.
  check("mid-grey is near-fixed", delta(toDarkTheme("#808080"), "#7F7F7F") <= 2, toDarkTheme("#808080"));
  check("a bad hex is null, not a crash", toDarkTheme("transparent") === null);
}

// ---- 3. the gate under --dark ----
{
  const run = (args) => {
    const r = spawnSync(process.execPath, [gate, ...args], { encoding: "utf8" });
    return { status: r.status, output: r.stdout + r.stderr };
  };

  const lightRatio = contrast("#145A32", "#F5B7B1");
  const darkRatio = contrast(toDarkTheme("#145A32"), toDarkTheme("#F5B7B1"));
  check("the fixture really does flip", lightRatio >= 4.5 && darkRatio < 4.5,
    `light ${lightRatio.toFixed(2)}:1, dark ${darkRatio.toFixed(2)}:1`);

  const light = run([fixture("dark-contrast")]);
  check("the fixture passes the light gate", light.status === 0, light.output.trim().split("\n").pop());

  const dark = run([fixture("dark-contrast"), "--dark"]);
  check("--dark catches it", dark.status === 1, `exit ${dark.status}`);
  check("--dark names the dark ground", dark.output.includes("under the dark theme"), dark.output.trim());
  check("--dark reports the transformed pair", dark.output.includes(toDarkTheme("#F5B7B1")), dark.output.trim());

  const clean = run([fixture("clean"), "--dark"]);
  check("a clean file stays clean under --dark", clean.status === 0, clean.output.trim().split("\n").pop());

  const example = run([join(root, "examples/example.excalidraw"), "--dark"]);
  check("the committed example passes under --dark", example.status === 0,
    example.output.trim().split("\n").pop());

  const planted = run([fixture("low-contrast-text"), "--dark"]);
  check("a light-theme failure is still a failure under --dark", planted.status === 1, `exit ${planted.status}`);

  // A misspelt flag that scored the light theme anyway would report a pass the
  // author never asked for, so an unknown flag is a usage error.
  const typo = run([fixture("dark-contrast"), "--drak"]);
  check("a misspelt flag is a usage error", typo.status === 2 && typo.output.includes("unknown flag --drak"),
    `exit ${typo.status}: ${typo.output.trim().split("\n")[0]}`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\ndark-theme contrast behaves");
process.exit(fail.length ? 1 : 0);
