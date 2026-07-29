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

/** Hash of everything that shapes the bundle: page source, bundler config, library version. */
export function expectedFingerprint() {
  const hash = createHash("sha256");
  for (const f of ["tools/page.js", "tools/bundle.js"]) {
    hash.update(readFileSync(join(root, f))).update("\0");
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  hash.update(pkg.devDependencies?.["@excalidraw/excalidraw"] ?? "");
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
