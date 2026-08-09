#!/usr/bin/env node
/**
 * Vendored font suite (issue #116). Excalidraw resolves its font files at run
 * time rather than shipping the bytes: `exportToSvg` fetches each family's
 * woff2 before it can inline the base64 `@font-face` rules the warm-up reads.
 * With no asset base configured those fetches go to esm.sh, which made every
 * browser-dependent test depend on live internet.
 *
 * The fix vendors the warmed families into `dist/fonts/` and points
 * `window.EXCALIDRAW_ASSET_PATH` at the loader's own directory. That only holds
 * while `dist/` actually carries the bytes, and `dist/` is un-ignored by name —
 * a rebundle that dropped the copy, or a .gitignore that swallowed it, would
 * leave a repo that still passes online and fails offline. These checks need no
 * Chrome, so they run in `test:fast` and catch that on every gate run.
 *
 * The offline behaviour itself — zero network, real faces — is proven against a
 * real browser in tests/font-warm.js.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDORED_FONTS, FONT_SOURCE_DIR, FONT_OUTPUT_DIR } from "../tools/fonts.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distFonts = join(root, FONT_OUTPUT_DIR);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const woff2In = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".woff2")).sort() : [];

// ---- 1. every warmed family is on disk, with bytes ----
{
  check("the font set is not empty", VENDORED_FONTS.length > 0);
  for (const family of VENDORED_FONTS) {
    const dir = join(distFonts, family);
    const files = woff2In(dir);
    check(`dist/fonts/${family} ships woff2 files`, files.length > 0, `${files.length} files`);
    const empty = files.filter((f) => statSync(join(dir, f)).size === 0);
    check(`dist/fonts/${family} files are non-empty`, empty.length === 0, empty.join(", "));
  }
}

// ---- 2. the vendored bytes are the pinned package's, not a stale copy ----
// @excalidraw/excalidraw is a devDependency, so `npm ci --omit=dev` runs this
// suite without it. Absent, there is nothing to compare against and the check
// reports what it skipped rather than passing silently on no evidence.
{
  const pkgFonts = join(root, FONT_SOURCE_DIR);
  if (!existsSync(pkgFonts)) {
    console.log("SKIP  vendored bytes match the pinned package — devDependencies not installed");
  } else {
    for (const family of VENDORED_FONTS) {
      const from = join(pkgFonts, family);
      const to = join(distFonts, family);
      const want = woff2In(from);
      const got = woff2In(to);
      check(
        `dist/fonts/${family} carries every file the package ships`,
        want.length > 0 && want.every((f) => got.includes(f)),
        `package ${want.length}, dist ${got.length}`,
      );
      const differing = want.filter(
        (f) => got.includes(f) && !readFileSync(join(from, f)).equals(readFileSync(join(to, f))),
      );
      check(`dist/fonts/${family} bytes match the package`, differing.length === 0,
        differing.join(", "));
    }
  }
}

// ---- 3. the loader points Excalidraw at those files, before the bundle runs ----
{
  const loader = readFileSync(join(root, "dist/index.html"), "utf8");
  const assetAt = loader.indexOf("EXCALIDRAW_ASSET_PATH");
  const bundleAt = loader.indexOf("excalidraw-page.js");
  check("the loader sets EXCALIDRAW_ASSET_PATH", assetAt !== -1, loader.trim());
  // Excalidraw builds its font URLs while the bundle evaluates, so a base set
  // afterwards is read too late and every family falls back to esm.sh.
  check("the loader sets it before loading the bundle",
    assetAt !== -1 && bundleAt !== -1 && assetAt < bundleAt, `asset@${assetAt} bundle@${bundleAt}`);
  // Resolved from the loader's own location: dist/ is copied to wherever the
  // plugin is installed, so no absolute path baked at bundle time can be right.
  check("the base is resolved from the loader's own location",
    /location\.href/.test(loader), loader.trim());
}

// ---- 4. .gitignore does not swallow the vendored files ----
// dist/ is un-ignored by name, so a new file under it is silently left
// uncommitted — the failure mode this whole suite exists to make loud.
{
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  check("dist/fonts is un-ignored explicitly", /^!dist\/fonts\//m.test(gitignore),
    gitignore.split("\n").filter((l) => l.startsWith("!dist")).join(" | "));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nfonts are vendored");
process.exit(fail.length ? 1 : 0);
