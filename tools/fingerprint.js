/**
 * Content fingerprint tying the committed bundle to its inputs. bundle.js stamps
 * it into dist/excalidraw-page.js; browser.js refuses to run when the stamp does
 * not match the current sources, because a stale bundle silently reproduces
 * exactly the bugs the sources already fixed.
 *
 * The stamp certifies the bundle's inputs, not its bytes — a hand-edited dist/
 * with an intact stamp passes. That failure needs a hostile editor; staleness
 * only needs someone forgetting to rebundle, which is the case worth guarding.
 */
import { createHash } from "node:crypto";
import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FINGERPRINT_MARKER = "//# aiworxBundleFingerprint=";

// Everything the bundle actually pulls in starts from these four packages
// plus esbuild itself (issue #159). Hashing only these five names' own
// versions missed the transitive closure underneath them — mermaid, its own
// dependencies, scheduler, and the rest — which floats independently of any
// range string and can move the real bundle while the stamp stays green.
export const BUNDLED_ROOTS = [
  "@excalidraw/excalidraw", "@excalidraw/mermaid-to-excalidraw", "react", "react-dom", "esbuild",
];

/**
 * npm's nearest-node_modules resolution: for dependency `name` required by
 * the package at lockfile path `fromPath`, try progressively shorter
 * ancestor paths' node_modules until one has an entry, mirroring how npm
 * itself would resolve the require at install time. Returns the resolved
 * lockfile path, or null if nothing satisfies it (an unmet optional peer).
 */
function resolveDep(lock, fromPath, name) {
  let p = fromPath;
  for (;;) {
    const candidate = `${p ? `${p}/` : ""}node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (p === "") return null;
    const m = p.match(/(?:^|\/)node_modules\/(?:@[^/]+\/[^/]+|[^/]+)$/);
    // A path with no node_modules segment (a workspace entry like packages/app)
    // climbs straight to the root node_modules, as npm itself would.
    p = m ? p.slice(0, m.index) : "";
  }
}

/** Sorted "name@version" list of every lockfile package reachable from the bundled roots. */
export function bundledClosure(lock) {
  const visited = new Set();
  const versions = new Set();
  const queue = [];

  for (const name of BUNDLED_ROOTS) {
    const path = resolveDep(lock, "", name);
    if (path == null) {
      throw new Error(`bundledClosure: bundled root "${name}" is missing from the lockfile`);
    }
    queue.push({ name, path });
  }

  while (queue.length) {
    const { name, path } = queue.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    const entry = lock.packages[path];
    versions.add(`${name}@${entry.version}`);
    // Peers included deliberately: a resolved peer (react under react-dom) is a
    // real instance the bundle carries. Over-hashing an unused one just forces a
    // rebundle on its move; under-hashing is the silent staleness this guards.
    const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
    for (const depName of Object.keys(deps)) {
      const depPath = resolveDep(lock, path, depName);
      if (depPath != null) queue.push({ name: depName, path: depPath });
    }
  }

  return [...versions].sort();
}

/** Hash of everything that shapes the bundle: page source, bundler config, resolved dep versions. */
export function expectedFingerprint() {
  const hash = createHash("sha256");
  // tools/fonts.js is in here because it decides which font families dist/
  // carries — dropping one leaves a dist/ that still works online and fails
  // offline, which is exactly the staleness this stamp exists to refuse. The
  // font *bytes* are deliberately not hashed: they are copied verbatim from
  // @excalidraw/excalidraw, whose resolved version is already below, so they
  // can only change with a version move. Hand-edited font files pass, for the
  // same reason a hand-edited bundle does.
  for (const f of ["tools/page.js", "tools/bundle.js", "tools/fonts.js"]) {
    hash.update(readFileSync(join(root, f))).update("\0");
  }
  // Resolved versions from the lockfile, not package.json ranges: a floating
  // range (react ^19, esbuild ^0.25) can move under `npm install` without any
  // range string changing — exactly the forgot-to-rebundle case the stamp
  // exists to catch.
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  // The dependency list itself comes from walking the lockfile's transitive
  // closure under the bundled roots (issue #159), rather than a hand-picked
  // set of names — so it cannot drift from what the bundle actually carries.
  for (const dep of bundledClosure(lock)) {
    hash.update(dep).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** The fingerprint stamped at the end of the bundle, or null if none. */
export function stampedFingerprint(bundlePath) {
  const fd = openSync(bundlePath, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(200, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const tail = buf.toString("utf8");
    const i = tail.lastIndexOf(FINGERPRINT_MARKER);
    if (i === -1) return null;
    return tail.slice(i + FINGERPRINT_MARKER.length).trim() || null;
  } finally {
    closeSync(fd);
  }
}
