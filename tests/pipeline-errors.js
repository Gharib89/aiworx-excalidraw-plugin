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
 *   4. Chrome is looked for in the documented order, and finding none names
 *      the CHROME_PATH override
 *
 * The copy-based probes run against a throwaway copy of the pipeline so the
 * repo stays clean; the page-error probe runs the real pipeline with a bad
 * call.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * A module specifier is a URL, not a path. `C:\…\browser.js` reads as a `C:`
 * scheme and the loader refuses it with ERR_UNSUPPORTED_ESM_URL_SCHEME, so every
 * probe below crosses the boundary through node:url before it interpolates.
 */
const specifier = (...parts) => pathToFileURL(join(...parts)).href;
/**
 * A cold Chromium launch plus the bundle load is ~20 s on a slow machine, so a
 * probe budget near that turns a passing assertion into a coin flip. This
 * ceiling only has to catch a probe that hangs outright — no assertion below
 * reads the clock; the fail-fast claim is proven by which error comes back.
 */
const PROBE_TIMEOUT = 90_000;

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
  for (const f of ["tools/browser.js", "tools/errors.js", "tools/page.js", "tools/bundle.js", "tools/fingerprint.js", "package.json", "package-lock.json"]) {
    copyFileSync(join(root, f), join(dir, f));
  }
  copyFileSync(join(root, "dist/excalidraw-page.js"), join(dir, "dist/excalidraw-page.js"));
  // the copy resolves playwright-core through the real install. "junction" is the
  // one directory link Windows creates without elevation; ignored on POSIX.
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "junction");
  return dir;
}

/**
 * Shadow playwright-core for one probe copy. A bare specifier resolves from the
 * importing file upward, so a stub under `tools/node_modules` wins over the real
 * install symlinked at the copy root — and only for that copy's tools/browser.js.
 * The stub appends each launch's options to a file and then fails, which turns
 * "no browser work happened" into a file that does not exist instead of a
 * wall-clock budget, and makes the executable the driver picked observable.
 */
function stubChromium(dir) {
  const marker = join(dir, "launched");
  const pkg = join(dir, "tools/node_modules/playwright-core");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "playwright-core", version: "0.0.0", type: "module", main: "index.js" }),
  );
  writeFileSync(
    join(pkg, "index.js"),
    `import { appendFileSync } from "node:fs";
     export const chromium = {
       launch: async (opts) => {
         appendFileSync(${JSON.stringify(marker)}, JSON.stringify(opts) + "\\n");
         throw new Error("stub chromium: launch was reached");
       },
     };\n`,
  );
  return marker;
}

/** The launch options the driver tried, in order. */
const attempts = (marker) =>
  existsSync(marker)
    ? readFileSync(marker, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    : [];

const probe = (dir, env) =>
  spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      `import { withExcalidraw } from "${specifier(dir, "tools/browser.js")}";
       await withExcalidraw(async () => {});
       console.log("ran");`],
    { encoding: "utf8", timeout: PROBE_TIMEOUT, env: { ...process.env, ...env } },
  );

// ---- 1. stale bundle: sources changed after the bundle was stamped ----
{
  const dir = makeCopy();
  const marker = stubChromium(dir);
  appendFileSync(join(dir, "tools/page.js"), "\n// tampered after bundling\n");
  const r = probe(dir);
  check("stale bundle: refuses to run", r.status !== 0, `exit ${r.status}`);
  check("stale bundle: names StaleBundleError", /StaleBundleError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("stale bundle: tells the user to rebundle", /npm run bundle/.test(r.stderr));
  check("stale bundle: fails before any browser work", !existsSync(marker));
}

// ---- 1a. stale bundle: a bundled dep resolved to a new version, no rebundle ----
// `npm install` can move a floating range (react ^19) in the lockfile without
// any source file changing — the stamp must move with the resolved versions.
{
  const dir = makeCopy();
  const marker = stubChromium(dir);
  const lockPath = join(dir, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages["node_modules/react"].version = "19.99.0";
  writeFileSync(lockPath, JSON.stringify(lock));
  const r = probe(dir);
  check("dep bump: refuses to run", r.status !== 0, `exit ${r.status}`);
  check("dep bump: names StaleBundleError", /StaleBundleError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("dep bump: fails before any browser work", !existsSync(marker));
}

// ---- 1b. control: the stub is wired in, so the marker's absence is evidence ----
{
  const dir = makeCopy();
  const marker = stubChromium(dir);
  const r = probe(dir);
  check("stub control: a fresh bundle does reach the launch", existsSync(marker),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? `exit ${r.status}`);
}

// ---- 2. broken bundle with a valid stamp: page error surfaces, fast ----
{
  const dir = makeCopy();
  const { FINGERPRINT_MARKER, expectedFingerprint } = await import(specifier(dir, "tools/fingerprint.js"));
  writeFileSync(
    join(dir, "dist/excalidraw-page.js"),
    `throw new Error("boom: bundle exploded");\n${FINGERPRINT_MARKER}${expectedFingerprint()}\n`,
  );
  // the copied fingerprint.js resolves paths relative to itself, so expectedFingerprint()
  // above hashed the copy's own sources — the stamp is valid for the copy
  const r = probe(dir);
  check("broken bundle: exits non-zero", r.status !== 0, `exit ${r.status}`);
  check("broken bundle: names BundleLoadError", /BundleLoadError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("broken bundle: carries the page's exception", /boom: bundle exploded/.test(r.stderr));
  // Which of the two racers won is in the message, not the clock: the ready-flag
  // timeout reports "never signalled ready" (browser.js), the pageerror reject
  // reports the exception above. The exception alone does not separate them —
  // withIssues appends the collected pageerror to the timeout message too — so
  // this is the assertion that pins the fast path. A wall-clock budget here
  // measured the cold Chromium launch instead and flaked on a slow runner (#72).
  check("broken bundle: fails fast, not by timeout", !/never signalled ready/.test(r.stderr),
    r.stderr.match(/never signalled ready[^\n]*/)?.[0] ?? "");
}

// ---- 3. a throwing page call surfaces as a PageError naming the call ----
{
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      `import { withExcalidraw } from "${specifier(root, "tools/browser.js")}";
       await withExcalidraw((ex) => ex.measureText("not an array"));`],
    { encoding: "utf8", timeout: PROBE_TIMEOUT },
  );
  check("bad page call: exits non-zero", r.status !== 0, `exit ${r.status}`);
  check("bad page call: names PageError", /PageError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("bad page call: names the failing operation", /measureText failed in the page/.test(r.stderr));
}

// ---- 4. discovery order, and the error when the whole order comes up empty ----
// The stub fails every launch, so the probe walks the plan to its end and the
// recorded options are the search order the driver actually followed. An empty
// CHROME_PATH stands for "unset": the driver reads it as falsy, and passing it
// explicitly keeps a developer's own override out of the probe.
{
  const dir = makeCopy();
  const marker = stubChromium(dir);
  const r = probe(dir, { CHROME_PATH: "" });
  const tried = attempts(marker);
  check("no CHROME_PATH: the driver asks Chromium for the system Chrome",
    tried[0]?.channel === "chrome", JSON.stringify(tried[0]));
  // the fallback paths are Linux locations, so which of them follow the channel
  // depends on the machine: exactly those that exist here, in order, no others
  const { CHROME_CANDIDATES } = await import(specifier(root, "tools/browser.js"));
  const present = CHROME_CANDIDATES.filter((p) => existsSync(p));
  check("no CHROME_PATH: exactly the installed candidates follow the channel",
    JSON.stringify(tried.slice(1).map((t) => t.executablePath)) === JSON.stringify(present),
    `${tried.length} attempts, ${present.length} candidates installed`);
  check("nothing launches: names ChromeLaunchError", /ChromeLaunchError/.test(r.stderr),
    r.stderr.trim().split("\n").find((l) => l.includes("Error")) ?? r.stderr.trim().slice(0, 120));
  check("nothing launches: names the override", /CHROME_PATH/.test(r.stderr));
  check("nothing launches: reports every place it looked",
    tried.every((t) => r.stderr.includes(t.channel ?? t.executablePath)),
    `tried ${tried.length}`);
}

// ---- 4b. CHROME_PATH is not one candidate among several — it is the only one ----
{
  const dir = makeCopy();
  const marker = stubChromium(dir);
  probe(dir, { CHROME_PATH: "/opt/my/chrome" });
  const tried = attempts(marker);
  check("CHROME_PATH wins: it is the executable launched",
    tried.length === 1 && tried[0].executablePath === "/opt/my/chrome", JSON.stringify(tried));
  check("CHROME_PATH wins: no channel discovery",
    tried.every((t) => t.channel === undefined), JSON.stringify(tried));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nfailure paths are loud");
process.exit(fail.length ? 1 : 0);
