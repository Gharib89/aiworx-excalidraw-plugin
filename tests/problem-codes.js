#!/usr/bin/env node
/**
 * Guards the published problem-code registry against the code that emits the
 * codes.
 *
 * The gate's problem codes are a public, append-only contract, so the contract
 * has to be readable without reading tools/verify.js. That is
 * skills/excalidraw-diagram/reference/problem-codes.md — and a hand-written
 * registry rots the first time a rule lands without it. The invariants:
 *
 *   1. every code tools/verify.js emits appears in the element-level section,
 *      every code tools/check.js emits appears in the file-level one, and every
 *      code tools/ledger.js emits appears in the ledger one — a new rule or
 *      ledger entry that skips the registry fails here, which is the only thing
 *      standing between "public contract" and "read the source". `deprecated` counts as
 *      listed: under add-new-plus-deprecate the old code keeps coming out beside
 *      its replacement while consumers migrate, so forbidding that overlap would
 *      forbid the only migration path the append-only rule allows;
 *   2. no `live` row names a code nothing emits, so the registry cannot promise
 *      a code that was quietly dropped. A code that has finished retiring moves
 *      to `deprecated` and stays listed for good — the name is never reused;
 *   3. every emission site yields a literal code. Rules 1-2 read the sources with
 *      a regex, and a computed code (`note(code, …)`) would be invisible to it
 *      *and* absent from the registry — a silent pass in both directions.
 *      Counting call sites against literal matches is what closes that hole.
 *   4. the thresholds the registry's prose quotes for `frame-edge-crowding`,
 *      `text-struck-by-arrow`, `stray` and `degenerate`, and for every advisory
 *      that judges a quantity, match the gate's own constants — a retuned
 *      constant would otherwise leave the shipped prose lying about the number
 *      the gate actually enforces.
 *
 * Exits non-zero on any mismatch, naming the codes on each side.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRAME_EDGE_INSET,
  TEXT_ARROW_CLEARANCE,
  STRAY_GAP,
  DEGENERATE_SPAN_RATIO,
  DEGENERATE_SPAN_FLOOR,
} from "../tools/verify.js";
import { ARROW_CLEARANCE, ASPECT_BAND, FONT_FLOOR, MAX_BENDS, MAX_HUES, MAX_PANEL_WIDTH_DRIFT } from "../tools/advise.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const count = (src, re) => (src.match(re) ?? []).length;

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// The element-level codes all reach the report through verify.js's `note`
// helper, and the ledger codes through ledger.js's namesake — same helper shape,
// so the same regexes read both. The file-level ones are the `error: { code }` a
// file that never reached the rules carries instead of a problem list.
const verify = read("tools/verify.js");
const checkCli = read("tools/check.js");
const ledger = read("tools/ledger.js");
const advise = read("tools/advise.js");
const literal = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

const NOTE_CALL = /\bnote\(/g;
const NOTE_CODE = /\bnote\(\s*"([a-z][a-z-]*)"/g;
const ERROR_SITE = /error:\s*\{/g;
const ERROR_CODE = /error:\s*\{\s*code:\s*"([a-z][a-z-]*)"/g;

const emitted = {
  element: new Set(literal(verify, NOTE_CODE)),
  file: new Set(literal(checkCli, ERROR_CODE)),
  ledger: new Set(literal(ledger, NOTE_CODE)),
  advisory: new Set(literal(advise, NOTE_CODE)),
};

// Invariant 3 — every site the regexes below scan must carry a literal code.
// A site the regex cannot read is a code the registry can silently omit.
check(
  "every verify.js note() names a literal code",
  count(verify, NOTE_CALL) === count(verify, NOTE_CODE),
  `${count(verify, NOTE_CODE)} literal of ${count(verify, NOTE_CALL)} call sites`,
);
check(
  "every check.js error object names a literal code",
  count(checkCli, ERROR_SITE) === count(checkCli, ERROR_CODE),
  `${count(checkCli, ERROR_CODE)} literal of ${count(checkCli, ERROR_SITE)} sites`,
);
check(
  "every ledger.js note() names a literal code",
  count(ledger, NOTE_CALL) === count(ledger, NOTE_CODE),
  `${count(ledger, NOTE_CODE)} literal of ${count(ledger, NOTE_CALL)} call sites`,
);
check(
  "every advise.js note() names a literal code",
  count(advise, NOTE_CALL) === count(advise, NOTE_CODE),
  `${count(advise, NOTE_CODE)} literal of ${count(advise, NOTE_CALL)} call sites`,
);

const registry = read("skills/excalidraw-diagram/reference/problem-codes.md");

/**
 * Rows of one registry table, keyed by its exact `##` heading. A row is
 * `| `code` | live-or-deprecated | …`, the shape the doc's own tables use —
 * anything else in the file (prose, the field reference) is ignored.
 */
function rows(heading) {
  const section = registry.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
  if (section === undefined) return null;
  return [...section.matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|\s*(live|deprecated)\s*\|/gm)].map(
    (m) => ({ code: m[1], status: m[2] }),
  );
}

const SECTIONS = {
  element: "Element-level codes",
  file: "File-level codes",
  ledger: "Ledger codes",
  advisory: "Advisory codes",
};

for (const [level, heading] of Object.entries(SECTIONS)) {
  const listed = rows(heading);
  if (listed === null) {
    check(`the registry has a "${heading}" section`, false);
    continue;
  }
  const live = new Set(listed.filter((r) => r.status === "live").map((r) => r.code));
  const known = new Set(listed.map((r) => r.code));
  const list = (codes) => codes.sort().join(", ");

  const unlisted = [...emitted[level]].filter((c) => !known.has(c));
  check(`every ${level}-level code emitted is in the registry`, unlisted.length === 0, list(unlisted));

  const phantom = [...live].filter((c) => !emitted[level].has(c));
  check(`no ${level}-level code is listed live but never emitted`, phantom.length === 0, list(phantom));
}

// Invariant 4 — the prose quotes the same numbers the gate enforces. Anchored
// to the wording, not bare digits, so an unrelated number elsewhere in the
// doc can't false-match.
const quoted = (re, label) => {
  const m = registry.match(re);
  check(`the registry quotes a number for ${label}`, m !== null);
  return m ? Number(m[1]) : null;
};

const quotedInset = quoted(/minimum inset is \*\*(\d+)px\*\*/, "the frame-edge inset");
check(
  "the registry's frame-edge inset matches FRAME_EDGE_INSET",
  quotedInset === FRAME_EDGE_INSET,
  `doc says ${quotedInset}px, verify.js says ${FRAME_EDGE_INSET}px`,
);

const quotedClearance = quoted(/minimum clearance is \*\*(\d+)px\*\*/, "the text/arrow clearance");
check(
  "the registry's text/arrow clearance matches TEXT_ARROW_CLEARANCE",
  quotedClearance === TEXT_ARROW_CLEARANCE,
  `doc says ${quotedClearance}px, verify.js says ${TEXT_ARROW_CLEARANCE}px`,
);

// The registry table restates two of the numbers in its own cells — hold
// those copies too, or a retune ships a half-stale registry with green CI.
const tableInset = quoted(/stops less than (\d+)px from the border/, "the frame-edge inset (table cell)");
check(
  "the registry table's frame-edge inset matches FRAME_EDGE_INSET",
  tableInset === FRAME_EDGE_INSET,
  `doc says ${tableInset}px, verify.js says ${FRAME_EDGE_INSET}px`,
);

const tableClearance = quoted(/passes within (\d+)px of a text/, "the text/arrow clearance (table cell)");
check(
  "the registry table's text/arrow clearance matches TEXT_ARROW_CLEARANCE",
  tableClearance === TEXT_ARROW_CLEARANCE,
  `doc says ${tableClearance}px, verify.js says ${TEXT_ARROW_CLEARANCE}px`,
);

const quotedStrayGap = quoted(/sits more than (\d+)px from anything else/, "the stray gap");
check(
  "the registry's stray gap matches STRAY_GAP",
  quotedStrayGap === STRAY_GAP,
  `doc says ${quotedStrayGap}px, verify.js says ${STRAY_GAP}px`,
);

// The advisory table quotes every bound it judges a quantity against; each is
// held to the constant tools/advise.js exports, so a retune is a one-diff PR.
const quotedAll = (re, label) => {
  const m = registry.match(re);
  check(`the registry quotes ${label}`, m !== null);
  return m ? m.slice(1).map(Number) : null;
};
const numbers = (...xs) => xs.map(Number).join("/");
const aspect = quotedAll(/outside ([\d.]+)–([\d.]+)× the preset surface's aspect/, "the aspect band");
check("the registry's aspect band matches ASPECT_BAND", aspect && numbers(...aspect) === numbers(ASPECT_BAND.low, ASPECT_BAND.high),
  `doc says ${aspect?.join("–")}, advise.js says ${ASPECT_BAND.low}–${ASPECT_BAND.high}`);
const crowding = quotedAll(/within (\d+)px of a shape, a text or another arrow's label it is not bound to/, "the arrow clearance");
check("the registry's arrow clearance matches ARROW_CLEARANCE", crowding?.[0] === ARROW_CLEARANCE, `doc says ${crowding?.[0]}px, advise.js says ${ARROW_CLEARANCE}px`);
const bends = quotedAll(/more than (\d+) direction changes on one arrow/, "the bend ceiling");
check("the registry's bend ceiling matches MAX_BENDS", bends?.[0] === MAX_BENDS, `doc says ${bends?.[0]}, advise.js says ${MAX_BENDS}`);
const floors = quotedAll(/(\d+)px `doc-inline`, (\d+)px `doc-wide`, (\d+)px `social-og`, (\d+)px `slide-16x9`/, "the font floors");
check("the registry's font floors match FONT_FLOOR",
  floors && numbers(...floors) === numbers(FONT_FLOOR["doc-inline"], FONT_FLOOR["doc-wide"], FONT_FLOOR["social-og"], FONT_FLOOR["slide-16x9"]),
  `doc says ${floors?.join("/")}, advise.js says ${Object.values(FONT_FLOOR).join("/")}`);
const hues = quotedAll(/more than (\d+) non-grey hue families/, "the hue ceiling");
check("the registry's hue ceiling matches MAX_HUES", hues?.[0] === MAX_HUES, `doc says ${hues?.[0]}, advise.js says ${MAX_HUES}`);
const drift = quotedAll(/widest ÷ narrowest frame width above ([\d.]+)×/, "the panel width drift");
check("the registry's panel width drift matches MAX_PANEL_WIDTH_DRIFT", drift?.[0] === MAX_PANEL_WIDTH_DRIFT, `doc says ${drift?.[0]}, advise.js says ${MAX_PANEL_WIDTH_DRIFT}`);
// degenerate's collapsed-polyline arm carries two numbers, and the table cell
// restates the ratio — the same half-stale hazard the inset and clearance have
const quotedSpanRatio = quoted(/minimum is \*\*(\d+)%\*\* of the declared size/, "the degenerate span ratio");
check(
  "the registry's degenerate span ratio matches DEGENERATE_SPAN_RATIO",
  quotedSpanRatio === DEGENERATE_SPAN_RATIO * 100,
  `doc says ${quotedSpanRatio}%, verify.js says ${DEGENERATE_SPAN_RATIO * 100}%`,
);

const tableSpanRatio = quoted(/spans under (\d+)% of the size it declares/, "the degenerate span ratio (table cell)");
check(
  "the registry table's degenerate span ratio matches DEGENERATE_SPAN_RATIO",
  tableSpanRatio === DEGENERATE_SPAN_RATIO * 100,
  `doc says ${tableSpanRatio}%, verify.js says ${DEGENERATE_SPAN_RATIO * 100}%`,
);

const quotedSpanFloor = quoted(/declaring at least \*\*(\d+)px\*\*/, "the degenerate span floor");
check(
  "the registry's degenerate span floor matches DEGENERATE_SPAN_FLOOR",
  quotedSpanFloor === DEGENERATE_SPAN_FLOOR,
  `doc says ${quotedSpanFloor}px, verify.js says ${DEGENERATE_SPAN_FLOOR}px`,
);

console.log(
  fail.length
    ? `\n${fail.length} FAILED: ${fail.join(", ")}`
    : `\nthe registry matches the gate — ${emitted.element.size} element-level, ${emitted.file.size} file-level, ` +
      `${emitted.ledger.size} ledger and ${emitted.advisory.size} advisory codes`,
);
process.exit(fail.length ? 1 : 0);
