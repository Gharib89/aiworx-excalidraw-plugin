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
  // @excalidraw/mermaid-to-excalidraw is a transitive dependency, pinned by the
  // library — but page.js imports its parser directly, so the bundle carries it
  // and a lockfile move under it is exactly as stale as a move under the others.
  for (const dep of [
    "@excalidraw/excalidraw", "@excalidraw/mermaid-to-excalidraw", "react", "react-dom", "esbuild",
  ]) {
    hash.update(lock.packages[`node_modules/${dep}`]?.version ?? "").update("\0");
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
