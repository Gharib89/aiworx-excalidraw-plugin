#!/usr/bin/env node
/**
 * Fingerprint closure suite (issue #159). `expectedFingerprint()` used to hash
 * a hand-picked list of five lockfile versions (the bundled roots), but the
 * bundle also carries their full transitive closure — mermaid, scheduler,
 * dompurify, d3, and whatever else floats underneath. A `package-lock.json`
 * regeneration can move one of those without moving any of the five hashed
 * names, changing the real bundle while the stamp stays green.
 *
 * `bundledClosure()` fixes that by walking the lockfile's dependency graph
 * from the bundled roots instead of hashing a fixed name list, so the set of
 * hashed versions can never drift from what actually ends up in the bundle.
 * These fixture cases pin its resolution rules (npm's nearest-node_modules
 * lookup, reachability, unmet optional peers) independently of the real
 * lockfile, which the first case then exercises for real.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_ROOTS, bundledClosure, expectedFingerprint } from "../tools/fingerprint.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const ROOTS = BUNDLED_ROOTS;

/** Minimal fixture lockfile: all five bundled roots present, no deps unless overridden. */
const fixtureLock = (packageOverrides = {}) => ({
  packages: {
    "": {},
    ...Object.fromEntries(ROOTS.map((r) => [`node_modules/${r}`, { version: "1.0.0" }])),
    ...packageOverrides,
  },
});

// ---- 1. real lockfile integration (the motivating case) ----
{
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const closure = bundledClosure(lock);
  check("closure includes a mermaid entry", closure.some((e) => e.startsWith("mermaid@")),
    closure.filter((e) => e.startsWith("mermaid")).join(", "));
  for (const name of ROOTS) {
    check(`closure includes ${name}`, closure.some((e) => e.startsWith(`${name}@`)));
  }
  const fp = expectedFingerprint();
  check("expectedFingerprint returns a 16-char lowercase hex string", /^[0-9a-f]{16}$/.test(fp), fp);
}

// ---- 2. synthetic transitive bump ----
{
  const lockA = fixtureLock({
    "node_modules/@excalidraw/excalidraw": { version: "1.0.0", dependencies: { leaf: "^2" } },
    "node_modules/leaf": { version: "2.0.0" },
  });
  const expectedA = [
    "@excalidraw/excalidraw@1.0.0",
    "@excalidraw/mermaid-to-excalidraw@1.0.0",
    "esbuild@1.0.0",
    "leaf@2.0.0",
    "react-dom@1.0.0",
    "react@1.0.0",
  ];
  const closureA = bundledClosure(lockA);
  check("transitive leaf is included at its resolved version", JSON.stringify(closureA) === JSON.stringify(expectedA),
    closureA.join(", "));

  const lockB = fixtureLock({
    "node_modules/@excalidraw/excalidraw": { version: "1.0.0", dependencies: { leaf: "^2" } },
    "node_modules/leaf": { version: "3.0.0" },
  });
  const closureB = bundledClosure(lockB);
  check("bumping the transitive leaf's version changes the closure",
    JSON.stringify(closureB) !== JSON.stringify(closureA));
  check("the bumped closure carries the new name@version", closureB.includes("leaf@3.0.0"),
    closureB.join(", "));
}

// ---- 3. nested duplicate versions resolve independently ----
{
  const lock = fixtureLock({
    "node_modules/@excalidraw/excalidraw": { version: "1.0.0", dependencies: { x: "*" } },
    "node_modules/react": { version: "1.0.0", dependencies: { x: "*" } },
    "node_modules/x": { version: "1.0.0" },
    "node_modules/@excalidraw/excalidraw/node_modules/x": { version: "2.0.0" },
  });
  const closure = bundledClosure(lock);
  check("the top-level copy of x is walked (react's nearest resolution)", closure.includes("x@1.0.0"),
    closure.join(", "));
  check("the nested copy of x is walked (excalidraw's nearest resolution)", closure.includes("x@2.0.0"),
    closure.join(", "));
}

// ---- 4. unreachable package excluded ----
{
  const lockA = fixtureLock({ "node_modules/devtool": { version: "9.9.9" } });
  const lockB = fixtureLock({ "node_modules/devtool": { version: "9.9.10" } });
  const closureA = bundledClosure(lockA);
  const closureB = bundledClosure(lockB);
  check("an unreachable package is excluded", !closureA.some((e) => e.startsWith("devtool@")),
    closureA.join(", "));
  check("bumping an unreachable package's version leaves the closure identical",
    JSON.stringify(closureA) === JSON.stringify(closureB));
}

// ---- 5. unmet optional peer skipped ----
{
  const lock = fixtureLock({
    "node_modules/react": { version: "1.0.0", peerDependencies: { "missing-peer": "*" } },
  });
  let closure;
  let threw = false;
  try {
    closure = bundledClosure(lock);
  } catch {
    threw = true;
  }
  check("an unmet optional peer does not throw", !threw);
  check("the unmet peer is absent from the closure",
    !threw && !closure.some((e) => e.startsWith("missing-peer@")), closure?.join(", "));
}

// ---- 6. unresolved required dependency throws ----
{
  const lock = fixtureLock({
    "node_modules/react": { version: "1.0.0", dependencies: { gone: "^1" } },
  });
  let threw = false;
  try {
    bundledClosure(lock);
  } catch {
    threw = true;
  }
  check("a required dependency with no lockfile entry throws", threw);
}

// ---- 7. missing root throws ----
{
  const lock = fixtureLock();
  delete lock.packages["node_modules/react"];
  let threw = false;
  try {
    bundledClosure(lock);
  } catch {
    threw = true;
  }
  check("a lockfile missing a bundled root throws", threw);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nfingerprint closure walks the bundled roots correctly");
process.exit(fail.length ? 1 : 0);
