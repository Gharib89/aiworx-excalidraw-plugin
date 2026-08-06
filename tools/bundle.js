#!/usr/bin/env node
/**
 * Bundle the browser entry into dist/. The bundle is committed so an installed
 * plugin works without a build step; only playwright-core is needed at runtime.
 *
 * Fonts are inlined as data URLs on purpose: exportToSvg embeds whatever font
 * files it can reach, and a bundle that fetches them over the network would
 * silently produce diagrams with substituted fonts.
 */
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FINGERPRINT_MARKER, expectedFingerprint } from "./fingerprint.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = await esbuild.build({
  entryPoints: [join(root, "tools/page.js")],
  outfile: join(root, "dist/excalidraw-page.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  metafile: true,
  legalComments: "none",
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".ttf": "dataurl",
    ".png": "dataurl",
    ".svg": "dataurl",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.PREVIEW_ENV": "undefined",
    "import.meta.env": "{}",
  },
});

// The published Excalidraw chunks carry their own collaboration config — the
// public excalidraw-room-persistence Firebase web key. We never initialise
// Firebase (headless export does no collaboration), and committing another
// project's key trips secret scanners, so strip it from our output.
const outFile = join(root, "dist/excalidraw-page.js");
const src = readFileSync(outFile, "utf8");
const scrubbed = src
  .replace(/AIza[0-9A-Za-z_-]{35}/g, "")
  .replace(/https:\/\/[a-z-]+\.firebaseio\.com/g, "")
  .replace(/[a-z-]+\.firebaseapp\.com/g, "");
if (scrubbed !== src) writeFileSync(outFile, scrubbed);

const leftover = scrubbed.match(/AIza[0-9A-Za-z_-]{35}/g);
if (leftover) {
  console.error(`ERROR: ${leftover.length} API key(s) remain in the bundle`);
  process.exit(1);
}

// Stamp the bundle with a fingerprint of its inputs so browser.js can refuse
// to run a committed bundle that no longer matches the sources.
appendFileSync(outFile, `\n${FINGERPRINT_MARKER}${expectedFingerprint()}\n`);

// The loader page browser.js navigates to. Letting Chrome pull the bundle off
// disk through a relative <script src> is 3-4x faster than handing the same
// bytes to addScriptTag, which reads the file in Node and ships all of it to the
// page as a string over CDP. The charset is explicit because a file: document
// otherwise guesses, and the bundle carries non-ASCII.
const loaderFile = join(root, "dist/index.html");
const loader = `<!doctype html><meta charset="utf-8"><script src="excalidraw-page.js"></script>\n`;
writeFileSync(loaderFile, loader);

const out = Object.entries(result.metafile.outputs);
for (const [file, meta] of out) {
  console.log(`${file}  ${(meta.bytes / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`dist/index.html  ${loader.length} B  (loader page)`);
console.log(
  src === scrubbed ? "no third-party keys found" : "stripped third-party collab config",
);
