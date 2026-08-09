#!/usr/bin/env node
/**
 * Bundle the browser entry into dist/. The bundle is committed so an installed
 * plugin works without a build step; only playwright-core is needed at runtime.
 *
 * Fonts are vendored into dist/fonts/ on purpose: exportToSvg embeds whatever
 * font files it can reach, and reaching for them over the network would put a
 * CDN on the hot path of every measurement — silently substituting fonts, or
 * failing outright, whenever it is slow or absent. See tools/fonts.js.
 *
 * Asset loaders below still inline anything the entry *imports*; the font files
 * are not among them, because Excalidraw holds them as path strings it fetches
 * at run time rather than as imports esbuild could see.
 */
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, appendFileSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FINGERPRINT_MARKER, expectedFingerprint } from "./fingerprint.js";
import { VENDORED_FONTS, FONT_SOURCE_DIR, FONT_OUTPUT_DIR } from "./fonts.js";

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

// Vendor the font files the page warms. Excalidraw resolves them at run time
// rather than shipping the bytes — esbuild's dataurl loader never sees them,
// because the library holds them as path *strings* it fetches later. Copied
// from the locked package so the bytes always match the pinned version, and
// rewritten from scratch each bundle so a family dropped from the set does not
// linger in dist/. See tools/fonts.js.
const fontOut = join(root, FONT_OUTPUT_DIR);
rmSync(fontOut, { recursive: true, force: true });
for (const family of VENDORED_FONTS) {
  cpSync(join(root, FONT_SOURCE_DIR, family), join(fontOut, family), { recursive: true });
}

// The loader page browser.js navigates to. Letting Chrome pull the bundle off
// disk through a relative <script src> is 3-4x faster than handing the same
// bytes to addScriptTag, which reads the file in Node and ships all of it to the
// page as a string over CDP. The charset is explicit because a file: document
// otherwise guesses, and the bundle carries non-ASCII.
//
// EXCALIDRAW_ASSET_PATH is set here, in its own script, for two reasons the
// bundle itself cannot satisfy: the library builds its font URLs while the
// bundle evaluates, so a base assigned any later is read too late; and it is
// resolved from the loader's own location, because dist/ is copied to wherever
// the plugin is installed and no path baked in at bundle time would survive.
const loaderFile = join(root, "dist/index.html");
const loader =
  `<!doctype html><meta charset="utf-8">` +
  `<script>window.EXCALIDRAW_ASSET_PATH=new URL("./",location.href).href</script>` +
  `<script src="excalidraw-page.js"></script>\n`;
writeFileSync(loaderFile, loader);

const out = Object.entries(result.metafile.outputs);
for (const [file, meta] of out) {
  console.log(`${file}  ${(meta.bytes / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`dist/index.html  ${Buffer.byteLength(loader)} B  (loader page)`);
console.log(`${FONT_OUTPUT_DIR}/  ${VENDORED_FONTS.join(", ")}`);
console.log(
  src === scrubbed ? "no third-party keys found" : "stripped third-party collab config",
);
