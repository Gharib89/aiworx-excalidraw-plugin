#!/usr/bin/env node
/**
 * Failure-path suite for the browser pipeline (tools/browser.js). The happy
 * path is smoke.js's job; this file proves the loud-failure claims:
 *
 *   1. a committed bundle that no longer matches the sources is refused with
 *      a StaleBundleError before any browser launches
 *   2. a bundle that throws on load surfaces the page's exception as a
 *      BundleLoadError immediately, not as a generic 30-second timeout
 *   3. a call that throws inside the page comes back as a PageError naming
 *      the failing operation
 *
 * The first two run against a throwaway copy of the pipeline so the repo
 * stays clean; the third runs the real pipeline with a bad call.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

/** Copy just enough of the plugin for withExcalidraw to run. */
function makeCopy() {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-errors-"));
  mkdirSync(join(dir, "tools"));
  mkdirSync(join(dir, "dist"));
  for (const f of ["tools/browser.js", "tools/page.js", "tools/bundle.js", "tools/fingerprint.js", "package.json"]) {
    copyFileSync(join(root, f), join(dir, f));
  }
  copyFileSync(join(root, "dist/excalidraw-page.js"), join(dir, "dist/excalidraw-page.js"));
  // the copy resolves playwright-core through the real install. "junction" is the
  // one directory link Windows creates without elevation; ignored on POSIX.
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "junction");
  return dir;
}

const probe = (dir) =>
  spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      `import { withExcalidraw } from "${join(dir, "tools/browser.js")}";
       await withExcalidraw(async () => {});
       console.log("ran");`],
    { encoding: "utf8", timeout: 25_000 },
  );

// ---- 1. stale bundle: sources changed after the bundle was stamped ----
{
  const dir = makeCopy();
  appendFileSync(join(dir, "tools/page.js"), "\n// tampered after bundling\n");
  const start = Date.now();
  const r = probe(dir);
  check("stale bundle: refuses to run", r.status !== 0, `exit ${r.status}`);
  check("stale bundle: names StaleBundleError", /StaleBundleError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("stale bundle: tells the user to rebundle", /npm run bundle/.test(r.stderr));
  check("stale bundle: fails before any browser work", Date.now() - start < 5_000,
    `${Date.now() - start}ms`);
}

// ---- 2. broken bundle with a valid stamp: page error surfaces, fast ----
{
  const dir = makeCopy();
  const { FINGERPRINT_MARKER, expectedFingerprint } = await import(join(dir, "tools/fingerprint.js"));
  writeFileSync(
    join(dir, "dist/excalidraw-page.js"),
    `throw new Error("boom: bundle exploded");\n${FINGERPRINT_MARKER}${expectedFingerprint()}\n`,
  );
  // the copied fingerprint.js resolves paths relative to itself, so expectedFingerprint()
  // above hashed the copy's own sources — the stamp is valid for the copy
  const start = Date.now();
  const r = probe(dir);
  check("broken bundle: exits non-zero", r.status !== 0, `exit ${r.status}`);
  check("broken bundle: names BundleLoadError", /BundleLoadError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("broken bundle: carries the page's exception", /boom: bundle exploded/.test(r.stderr));
  check("broken bundle: fails fast, not by timeout", Date.now() - start < 20_000,
    `${Date.now() - start}ms`);
}

// ---- 3. a throwing page call surfaces as a PageError naming the call ----
{
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      `import { withExcalidraw } from "${join(root, "tools/browser.js")}";
       await withExcalidraw((ex) => ex.measureText("not an array"));`],
    { encoding: "utf8", timeout: 25_000 },
  );
  check("bad page call: exits non-zero", r.status !== 0, `exit ${r.status}`);
  check("bad page call: names PageError", /PageError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("bad page call: names the failing operation", /measureText failed in the page/.test(r.stderr));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nfailure paths are loud");
process.exit(fail.length ? 1 : 0);
