/**
 * The font families dist/ ships a copy of.
 *
 * Excalidraw resolves font files at run time instead of shipping the bytes:
 * exportToSvg fetches each family's woff2 and base64-inlines it into the
 * @font-face rules the warm-up reads. Left unconfigured it resolves them
 * against its own esm.sh fallback, which put a live network on the hot path of
 * every measurement and export (issue #116). Vendoring the files into dist/ and
 * pointing window.EXCALIDRAW_ASSET_PATH at them takes the network out entirely.
 *
 * These are the directory names under the package's dist/prod/fonts, and they
 * are exactly the families tools/page.js warms (WARM_FAMILIES 3, 5, 6, 8 —
 * Cascadia, Excalifont, Nunito, Comic Shanns), which is the set every
 * measurement and export touches. Excalidraw's remaining families stay
 * un-vendored on purpose: nothing this plugin authors can reach them (the gate
 * confines text to the house pair), and one of them — Xiaolai — is 13 MB of CJK
 * on its own, more than the rest of the repository put together.
 *
 * Adding a family here means rebundling: the list is part of the bundle
 * fingerprint (tools/fingerprint.js), so a changed set refuses a stale dist/.
 */
export const VENDORED_FONTS = ["Cascadia", "ComicShanns", "Excalifont", "Nunito"];

/** Where the package keeps them, relative to the repo root. */
export const FONT_SOURCE_DIR = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";

/** Where the bundle puts them, relative to the repo root. */
export const FONT_OUTPUT_DIR = "dist/fonts";
