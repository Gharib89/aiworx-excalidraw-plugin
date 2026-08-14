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
import { execFileSync } from "node:child_process";
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
    Object.keys(housePalette.roles).map((k) => {
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

// ---- the consumers read through the shared path ----

/** What a fresh Node process, cwd'd into `dir`, sees as the given module
 * expression — the consumer modules bind their palette at import time, so only
 * a child process can observe them under a different working directory. */
const inChild = (dir, expr) =>
  execFileSync(process.execPath, ["-e", `import(${JSON.stringify(join(root, "tools/author.js"))}).then((m) => console.log(JSON.stringify(${expr})))`], {
    cwd: dir, encoding: "utf8",
  }).trim();

check("the author module's palette export honours the override", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), JSON.stringify(swappedOverride()));
    const roles = JSON.parse(inChild(dir, "m.palette.roles"));
    assert.equal(roles.local.stroke, housePalette.roles.remote.stroke);
    assert.equal(roles.remote.stroke, housePalette.roles.local.stroke);
  });
});

check("the author module under an invalid override refuses with a BrandOverrideError", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), "{}");
    assert.throws(
      () => inChild(dir, "m.palette.roles"),
      (err) => /BrandOverrideError/.test(err.stderr ?? ""),
      "the import must fail, naming the error class",
    );
  });
});

// ---- check.js maps the refusal into its code contract ----

/** Run a CLI from `dir`, capturing exit code and both streams. */
const runCli = (dir, script, ...args) => {
  try {
    const stdout = execFileSync(process.execPath, [join(root, script), ...args], {
      cwd: dir, encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
};

const CLEAN_DIAGRAM = JSON.stringify({ type: "excalidraw", version: 2, source: "test", elements: [], appState: {} });

check("check.js under an invalid override reports invalid-brand-override and exits 2", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), "{}");
    writeFileSync(join(dir, "d.excalidraw"), CLEAN_DIAGRAM);
    const r = runCli(dir, "tools/check.js", "--json", join(dir, "d.excalidraw"));
    assert.equal(r.code, 2, `exit ${r.code}, stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.files[0].error.code, "invalid-brand-override");
  });
});

check("check.js with a valid override still checks the diagram", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), JSON.stringify(swappedOverride()));
    writeFileSync(join(dir, "d.excalidraw"), CLEAN_DIAGRAM);
    const r = runCli(dir, "tools/check.js", "--json", join(dir, "d.excalidraw"));
    assert.equal(r.code, 0, `exit ${r.code}, stderr: ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).ok, true);
  });
});

check("revise.js under an invalid override refuses before touching the file", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, ".excalidraw-brand.json"), "{}");
    writeFileSync(join(dir, "d.excalidraw"), CLEAN_DIAGRAM);
    const r = runCli(dir, "tools/revise.js", join(dir, "d.excalidraw"));
    assert.notEqual(r.code, 0, "must not exit 0");
    assert.match(r.stderr, /BrandOverrideError/);
    assert.equal(readFileSync(join(dir, "d.excalidraw"), "utf8"), CLEAN_DIAGRAM, "writes nothing");
  });
});

// ---- the palette tool is the override author's preflight ----

check("palette.js against a valid override prints the derived palette and passes", () => {
  inTempDir((dir) => {
    const file = join(dir, "brand.json");
    writeFileSync(file, JSON.stringify(swappedOverride()));
    const r = runCli(dir, "tools/palette.js", file);
    assert.equal(r.code, 0, `exit ${r.code}, stderr: ${r.stderr}`);
    // the derived grey (#5B5B5B, neutralised) appears in no house-mode output,
    // so its presence proves the tool scored the override, not the house palette
    assert.match(r.stdout, /#5B5B5B/i, "prints the derived palette");
    assert.match(r.stdout, /all contrast checks passed/);
  });
});

check("palette.js against a failing override names the claim and exits 1", () => {
  inTempDir((dir) => {
    const file = join(dir, "brand.json");
    const body = swappedOverride();
    body.roles.decision = "#FFFF00";
    writeFileSync(file, JSON.stringify(body));
    const r = runCli(dir, "tools/palette.js", file);
    assert.equal(r.code, 1, `exit ${r.code}`);
    assert.match(r.stderr, /stroke on canvas/);
  });
});

check("palette.js refuses --write together with an override file", () => {
  inTempDir((dir) => {
    const file = join(dir, "brand.json");
    writeFileSync(file, JSON.stringify(swappedOverride()));
    const r = runCli(dir, "tools/palette.js", file, "--write");
    assert.equal(r.code, 2, `exit ${r.code}`);
  });
});

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nbrand override contract holds");
process.exit(fail.length ? 1 : 0);
