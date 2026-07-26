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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const out = Object.entries(result.metafile.outputs);
for (const [file, meta] of out) {
  console.log(`${file}  ${(meta.bytes / 1024 / 1024).toFixed(2)} MB`);
}
