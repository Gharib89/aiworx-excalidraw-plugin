#!/usr/bin/env node
/**
 * Unit suite for makeWrap (tools/author.js). No browser — measure is injected,
 * so a deterministic fake pins the text handling itself:
 *
 *   1. mid-word breaks land on grapheme boundaries — surrogate pairs (emoji),
 *      ZWJ sequences, and CJK survive intact on every line
 *   2. the repair loop converges on long texts — the pass bound scales with
 *      the input instead of a fixed count
 *   3. empty and whitespace-only input yield an empty block
 *
 * The fake measures a string as the sum of its grapheme widths: ASCII letters
 * 10px, spaces 6px, everything else 20px. A lone surrogate — what a code-unit
 * slice produces mid-emoji — is one narrow 10px grapheme, matching how a real
 * renderer draws the replacement glyph narrower than the emoji it broke.
 */
import { makeWrap } from "../tools/author.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (s) => [...segmenter.segment(s)].map((g) => g.segment);
const isLoneSurrogate = (g) => g.length === 1 && /[\uD800-\uDFFF]/.test(g);
const graphemeWidth = (g) => {
  if (isLoneSurrogate(g)) return 10;
  if (g === " ") return 6;
  return /^[\x20-\x7E]$/.test(g) ? 10 : 20;
};
const fakeWidth = (s, penalty = 0) => {
  const gs = graphemes(s);
  return gs.reduce((w, g) => w + graphemeWidth(g), 0) + (gs.length >= 8 ? penalty : 0);
};
const fakeMeasure = (penalty = 0) => async (specs) =>
  specs.map(({ text, fontSize }) => {
    const rows = text.split("\n");
    return {
      width: Math.max(...rows.map((r) => fakeWidth(r, penalty))),
      height: rows.length * Math.ceil(fontSize * 1.25),
    };
  });

// every line sits on grapheme boundaries of the source: walking the source's
// clusters must reproduce each line exactly, whole clusters at a time
const onClusterBoundaries = (source, lines) => {
  const clusters = graphemes(source);
  let at = 0;
  for (const line of lines) {
    let built = "";
    while (built.length < line.length && at < clusters.length) built += clusters[at++];
    if (built !== line) return false;
  }
  return at === clusters.length;
};

const wrap = makeWrap(fakeMeasure());

// ---- 1. surrogate pairs: a broken emoji run keeps every pair intact ----
{
  // 40 emoji at 20px each; 90px fits 4 whole emoji, and a code-unit cut would
  // land mid-pair (4 emoji + a 10px lone surrogate also "fits" 90px)
  const word = "\u{1F642}".repeat(40);
  const w = await wrap(word, 90, { fontSize: 16 });
  check("emoji run wraps without exceeding the width", w.lines.length > 1 && w.width <= 90,
    `${w.lines.length} lines, block ${w.width}`);
  check("no line carries a lone surrogate",
    w.lines.every((line) => graphemes(line).every((g) => !isLoneSurrogate(g))),
    JSON.stringify(w.lines.find((line) => graphemes(line).some(isLoneSurrogate))));
  check("emoji lines sit on grapheme boundaries", onClusterBoundaries(word, w.lines));
}

// ---- 2. ZWJ sequences: the family stays a family ----
{
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}"; // 👨‍👩‍👧‍👦, 11 code units
  const word = family.repeat(6);
  const w = await wrap(word, 70, { fontSize: 16 });
  check("ZWJ run wraps without exceeding the width", w.lines.length > 1 && w.width <= 70,
    `${w.lines.length} lines, block ${w.width}`);
  check("no ZWJ sequence is split across lines",
    w.lines.every((line) => line.length % family.length === 0) &&
      onClusterBoundaries(word, w.lines),
    JSON.stringify(w.lines));
}

// ---- 3. CJK: an unspaced run breaks cleanly ----
{
  const word = "漢字文書".repeat(10);
  const w = await wrap(word, 100, { fontSize: 16 });
  check("CJK run wraps at 5 chars per 100px", w.lines.every((l) => graphemes(l).length <= 5) &&
    w.lines.join("") === word, `${w.lines.length} lines`);
}

// ---- 4. convergence: repair passes scale with the text, not a fixed cap ----
{
  // the penalised measure makes every greedy-packed "aaaa aaaa" line measure
  // 136px against a 100px width, so each of the 150 paragraphs needs one
  // repair pass — a fixed 100-pass cap threw here despite steady progress
  const wrapPenalised = makeWrap(fakeMeasure(50));
  const text = Array.from({ length: 150 }, () => "aaaa aaaa").join("\n");
  let w, err;
  try {
    w = await wrapPenalised(text, 100, { fontSize: 16 });
  } catch (e) {
    err = e;
  }
  check("150 repairable paragraphs converge", !err, err && `${err.name}: ${err.message}`);
  if (w) {
    check("every repaired line fits", w.lines.every((l) => fakeWidth(l, 50) <= 100),
      `widest ${Math.max(...w.lines.map((l) => fakeWidth(l, 50)))}`);
  }
}

// ---- 5. empty and whitespace-only input ----
{
  for (const [name, input] of [["empty string", ""], ["whitespace-only", "   \n \t \n  "]]) {
    const w = await wrap(input, 100, { fontSize: 16 });
    check(`${name} yields an empty block`,
      w.text === "" && w.width === 0 && w.height === 0 && w.lines.length === 0,
      JSON.stringify(w));
  }
}

// ---- 6. a width too narrow for one grapheme is still a WrapError ----
{
  let err;
  try {
    await wrap("\u{1F642}word", 15, { fontSize: 16 });
  } catch (e) {
    err = e;
  }
  check("unsatisfiable width is a WrapError", err?.name === "WrapError",
    err ? err.message : "resolved");
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nwrap handles graphemes");
process.exit(fail.length ? 1 : 0);
