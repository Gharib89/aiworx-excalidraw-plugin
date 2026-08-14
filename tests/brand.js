#!/usr/bin/env node
/**
 * Contract suite for the brand override (tools/brand.js).
 *
 * One shared path discovers `.excalidraw-brand.json` by walking up from cwd,
 * derives the full palette from its strokes with the same OKLCH rule the house
 * palette was built with, verifies the same contrast claims, and refuses loudly
 * when any fail. These tests hold that contract: house palette untouched when
 * no override exists, walk-up discovery, derivation, and the refusal paths.
 *
 * Everything here is file reading and colour math — no browser.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadBrandPalette, housePalette as houseExport } from "../tools/brand.js";
import { BrandOverrideError } from "../tools/errors.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.log(`FAIL  ${name}  — ${err.message}`);
    fail.push(name);
  }
};

/** A throwaway directory tree, torn down after the block runs. */
const inTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "brand-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const housePalette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

// ---- no override: the house palette, unchanged ----

check("no override file anywhere up from cwd returns the house palette", () => {
  inTempDir((dir) => {
    const p = loadBrandPalette({ cwd: dir });
    assert.equal(p, houseExport, "the very object, so downstream output is byte-identical");
    assert.deepEqual(p, housePalette, "and it matches brand/palette.json");
  });
});

// ---- a valid override: strokes verbatim, everything else derived ----

/** House strokes with local and remote swapped — a valid palette (same colour
 * set, so every contrast claim still holds) that no house-palette fallback can
 * imitate: local must come out purple, remote blue, each with the fill the
 * committed palette derived for that stroke. */
const swappedOverride = () => ({
  canvas: housePalette.canvas,
  ink: housePalette.ink,
  roles: Object.fromEntries(
    Object.entries(housePalette.roles).map(([k, v]) => {
      const from = k === "local" ? "remote" : k === "remote" ? "local" : k;
      return [k, housePalette.roles[from].stroke];
    }),
  ),
});

check("override strokes are used verbatim and fills come out of the OKLCH rule", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), JSON.stringify(swappedOverride()));
    const p = loadBrandPalette({ cwd: dir });
    assert.equal(p.roles.local.stroke, housePalette.roles.remote.stroke, "local stroke");
    assert.equal(p.roles.local.fill, housePalette.roles.remote.fill, "local fill");
    assert.equal(p.roles.remote.stroke, housePalette.roles.local.stroke, "remote stroke");
    assert.equal(p.roles.remote.fill, housePalette.roles.local.fill, "remote fill");
    assert.equal(p.roles.pass.stroke, housePalette.roles.pass.stroke, "pass stroke");
  });
});

check("the derived palette keeps the house fontFamily — fonts are not overridable", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), JSON.stringify(swappedOverride()));
    assert.deepEqual(loadBrandPalette({ cwd: dir }).fontFamily, housePalette.fontFamily);
  });
});

check("grey is derived: neutral chroma at the house grey's lightness, override ink/canvas", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), JSON.stringify(swappedOverride()));
    const grey = loadBrandPalette({ cwd: dir }).grey;
    // known-good neutrals at the house grey's L values (#5B5B58 / #F1F1EF / #B9B9B4)
    assert.deepEqual(grey, {
      stroke: "#5B5B5B", fill: "#F1F1F1", faint: "#B9B9B9",
      ink: housePalette.ink, canvas: housePalette.canvas,
    });
  });
});

check("an override at the project root is found from a nested subdirectory", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), JSON.stringify(swappedOverride()));
    const nested = join(dir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    const p = loadBrandPalette({ cwd: nested });
    assert.equal(p.roles.local.stroke, housePalette.roles.remote.stroke);
  });
});

// ---- the explicit decision to keep the house palette ----

check('{ "defaults": "accepted" } returns the house palette, identical to no file', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), '{ "defaults": "accepted" }');
    assert.equal(loadBrandPalette({ cwd: dir }), houseExport);
  });
});

check("roles wins when both roles and defaults appear", () => {
  inTempDir((dir) => {
    writeFileSync(
      join(dir, ".excalidraw-brand.json"),
      JSON.stringify({ ...swappedOverride(), defaults: "accepted" }),
    );
    assert.equal(loadBrandPalette({ cwd: dir }).roles.local.stroke, housePalette.roles.remote.stroke);
  });
});

// ---- refusals: schema ----

/** The BrandOverrideError a bad file body provokes — asserting the class and
 * the what/where/next bar in one place. */
const refusalFor = (dir, body) => {
  writeFileSync(join(dir, ".excalidraw-brand.json"), body);
  try {
    loadBrandPalette({ cwd: dir });
  } catch (err) {
    assert.equal(err instanceof BrandOverrideError, true, `expected BrandOverrideError, got ${err.name}`);
    assert.equal(err.where, join(dir, ".excalidraw-brand.json"), "where names the override file");
    assert.notEqual(err.next, "", "next says what to do");
    return err;
  }
  assert.fail("expected a refusal, got a palette");
};

check("invalid JSON refuses", () => {
  inTempDir((dir) => assert.match(refusalFor(dir, "{nope").what, /not valid JSON/));
});

check("a file with neither roles nor accepted defaults refuses", () => {
  inTempDir((dir) => assert.match(refusalFor(dir, "{}").what, /neither/));
});

check('a defaults value other than "accepted" refuses', () => {
  inTempDir((dir) => assert.match(refusalFor(dir, '{ "defaults": "yes" }').what, /only accepted value/));
});

check("a missing role refuses and names it", () => {
  inTempDir((dir) => {
    const body = swappedOverride();
    delete body.roles.decision;
    assert.match(refusalFor(dir, JSON.stringify(body)).what, /missing role\(s\): decision/);
  });
});

check("an unknown role refuses and names it", () => {
  inTempDir((dir) => {
    const body = swappedOverride();
    body.roles.warning = "#123456";
    assert.match(refusalFor(dir, JSON.stringify(body)).what, /unknown role\(s\): warning/);
  });
});

check("an unknown top-level key refuses — a typo must not silently drop a slot", () => {
  inTempDir((dir) => {
    const body = { ...swappedOverride(), cnavas: "#FFFFFF" };
    assert.match(refusalFor(dir, JSON.stringify(body)).what, /unknown key "cnavas"/);
  });
});

check("a non-hex stroke refuses and names the slot", () => {
  inTempDir((dir) => {
    const body = swappedOverride();
    body.roles.pass = "green";
    assert.match(refusalFor(dir, JSON.stringify(body)).what, /"roles.pass" must be a 6-digit hex/);
  });
});

check("roles without canvas and ink refuses", () => {
  inTempDir((dir) => {
    const body = swappedOverride();
    delete body.canvas;
    assert.match(refusalFor(dir, JSON.stringify(body)).what, /"canvas" must be a 6-digit hex/);
  });
});

// ---- refusals: contrast ----

check("an override failing a contrast claim refuses and names the failed claim", () => {
  inTempDir((dir) => {
    const body = swappedOverride();
    body.roles.decision = "#FFFF00"; // yellow on a white-ish canvas: nowhere near 3:1
    const err = refusalFor(dir, JSON.stringify(body));
    assert.match(err.what, /decision/);
    assert.match(err.what, /stroke on canvas/);
  });
});

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nbrand override contract holds");
process.exit(fail.length ? 1 : 0);
