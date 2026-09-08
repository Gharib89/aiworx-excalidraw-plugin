#!/usr/bin/env node
/**
 * The identity contract (#227, tools/identity.js), the half that needs no
 * browser. Chrome-free by construction: it reads the committed artifacts and
 * exercises the pure derivations, so it runs in `test:fast`. Its companion
 * `tests/band-bytes.js` regenerates the bands and compares bytes.
 *
 * Two claims:
 *
 *   1. the derivations are pure, varied, and in Excalidraw's own integer range
 *   2. every committed artifact already obeys them: no wall-clock `updated`,
 *      no `created` off the clock, and `seed` a function of the element's id,
 *      distinct per element so Rough.js jitter stays varied
 *
 * (2) is what makes the reflow reviewable: a band that drifted back to random
 * seeds fails here, not three phases later in a byte comparison.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stableId, seedFor, nonceFor, PINNED_TIME } from "../tools/identity.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// ---- 1. the derivations ----
{
  check("stableId is pure", stableId("a", "b") === stableId("a", "b"));
  check("stableId separates its parts",
    stableId("a", "b") !== stableId("ab"),
    `${stableId("a", "b")} vs ${stableId("ab")}`);
  const id = stableId("bound", "arrow-1");
  check("stableId is a 21-character url-safe id",
    id.length === 21 && /^[A-Za-z0-9_-]+$/.test(id), id);

  check("seedFor is pure", seedFor("x") === seedFor("x"));
  check("seedFor varies with the id", seedFor("x") !== seedFor("y"));
  check("nonceFor is a different derivation from seedFor", seedFor("x") !== nonceFor("x"));

  // Excalidraw mints these as Math.floor(Math.random() * 2 ** 31); a value
  // outside that range is not something the editor would ever have written.
  const many = Array.from({ length: 500 }, (_, i) => seedFor(`e${i}`));
  check("every seed is a non-negative int31",
    many.every((s) => Number.isInteger(s) && s >= 0 && s < 2 ** 31));
  check("500 ids give 500 distinct seeds", new Set(many).size === 500);
}

// ---- 2. the committed artifacts obey the contract ----
const BANDS = [
  "examples/example.excalidraw",
  "examples/plugin-tour/plugin-tour.excalidraw",
  "examples/triage-graph/triage-graph.excalidraw",
];

for (const band of BANDS) {
  const doc = JSON.parse(readFileSync(join(root, band), "utf8"));
  const els = doc.elements;

  const wrongSeed = els.filter((e) => e.seed !== seedFor(e.id));
  check(`${band}: every seed is derived from its element's id`,
    wrongSeed.length === 0,
    wrongSeed.length ? `${wrongSeed.length} of ${els.length}, first ${wrongSeed[0].id}` : `${els.length} elements`);

  const wrongNonce = els.filter((e) => e.versionNonce !== nonceFor(e.id));
  check(`${band}: every versionNonce is derived from its element's id`,
    wrongNonce.length === 0,
    wrongNonce.length ? `${wrongNonce.length} of ${els.length}` : undefined);

  const clockStamped = els.filter((e) => e.updated !== PINNED_TIME);
  check(`${band}: no element carries a wall-clock updated`,
    clockStamped.length === 0,
    clockStamped.length ? `${clockStamped.length} of ${els.length}, first ${clockStamped[0].updated}` : undefined);

  const files = Object.values(doc.files ?? {});
  const clockCreated = files.filter((f) => f.created !== PINNED_TIME);
  check(`${band}: no image file carries a wall-clock created`,
    clockCreated.length === 0,
    `${files.length} file(s)`);

  // The point of deriving the seed rather than fixing it: two same-size
  // rectangles sharing a seed would carry identical Rough.js jitter and the
  // hand-drawn look would go mechanical.
  check(`${band}: no two elements share a seed`,
    new Set(els.map((e) => e.seed)).size === els.length,
    `${new Set(els.map((e) => e.seed)).size} seeds over ${els.length} elements`);

  // A random id is a random seed by construction, so the ids have to be stable
  // too. Nothing here can prove an id is derived rather than minted, but a
  // duplicate would mean two elements sharing one derivation.
  check(`${band}: every element id is unique`,
    new Set(els.map((e) => e.id)).size === els.length);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nthe identity contract holds");
process.exit(fail.length ? 1 : 0);
