/**
 * Which codepoints the vendored faces actually carry.
 *
 * A character no vendored face covers is not rendered by the house font at all:
 * the browser skips the face and takes the glyph from whatever the machine
 * supplies, so the text measures to the machine's metrics rather than the
 * repo's, the one thing vendoring the woff2 files into `dist/fonts/` exists to
 * prevent (issue #228).
 *
 * Coverage is read from each file's own `cmap`, not from the `unicodeRange`
 * Excalidraw declares beside it, for two reasons. The declarations live in
 * `@excalidraw/excalidraw`, a devDependency absent from a consumer install,
 * while `dist/fonts/` ships. And they over-claim: one Nunito subset declares
 * U+2191/U+2193 whose glyphs its bytes do not contain, and CSS then falls back
 * for them anyway, so a range check would call them covered while the text still
 * measured per-machine. The shipped bytes are the only honest answer.
 *
 * Reading is lazy and cached per family: the gate is a CLI, and a diagram that
 * draws only the prose face must not pay for decompressing the code face.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { FONT_OUTPUT_DIR } from "./fonts.js";

/**
 * Excalidraw's `fontFamily` numbers against the `dist/fonts/` directory names.
 * These are the four families tools/page.js warms (WARM_FAMILIES) and
 * tools/fonts.js vendors; the gate confines text to the house pair (3, 6) and
 * refuses any other number as `foreign-font`, so the remaining two are only
 * ever reached by a file authored elsewhere.
 */
export const VENDORED_FAMILY = Object.freeze({ 3: "Cascadia", 5: "Excalifont", 6: "Nunito", 8: "ComicShanns" });

const distFonts = resolve(dirname(fileURLToPath(import.meta.url)), "..", FONT_OUTPUT_DIR);
const cache = new Map();

/**
 * Every codepoint the named family's vendored faces carry, unioned across its
 * subset files. An unvendored `fontFamily` yields an empty set, which
 * `uncoveredCodepoints` reads as "nothing to judge" rather than "covers
 * nothing": a family whose bytes this repo does not ship makes no claim about
 * the machine's metrics either way.
 */
export function coveredCodepoints(fontFamily) {
  const family = VENDORED_FAMILY[fontFamily];
  if (!family) return new Set();
  if (!cache.has(family)) {
    const dir = join(distFonts, family);
    const set = new Set();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".woff2"))) {
      for (const cp of cmapCodepoints(readTable(join(dir, file), CMAP))) set.add(cp);
    }
    cache.set(family, set);
  }
  return cache.get(family);
}

/**
 * The codepoints in `text` the family's vendored faces do not carry, in the
 * order they are first drawn and each reported once, because a character that drifts
 * drifts wherever it appears, so the finding is about the character, not its
 * occurrences.
 */
export function uncoveredCodepoints(text, fontFamily) {
  const covered = coveredCodepoints(fontFamily);
  if (!covered.size) return [];
  const out = [];
  const seen = new Set();
  for (const ch of String(text ?? "")) {
    const cp = ch.codePointAt(0);
    // whitespace and the line breaks a wrapped label carries are laid out, not
    // drawn from a glyph, and no vendored subset declares them
    if (cp <= 0x20 || seen.has(cp) || covered.has(cp)) continue;
    seen.add(cp);
    out.push(cp);
  }
  return out;
}

/** `U+2713`, the form a codepoint is named by in a message and in the registry. */
export const formatCodepoint = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

// ---- woff2 ----

/**
 * woff2 keeps its table directory in the clear and the tables themselves in one
 * brotli stream, so a table is found by summing the declared lengths of the
 * tables before it. Only `cmap` is wanted here, and `cmap` is never one of the
 * two tables woff2 may transform, so no de-transforming is needed.
 *
 * Table tags are indices into the spec's fixed known-tags list rather than
 * four-character strings; `cmap` is index 0, and `glyf`/`loca` (the two whose
 * transform flag reads inverted) are 10 and 11.
 */
const CMAP = 0;
const GLYF = 10;
const LOCA = 11;
const WOFF2_HEADER = 48;

function readTable(file, want) {
  const buf = readFileSync(file);
  if (buf.length < WOFF2_HEADER || buf.toString("latin1", 0, 4) !== "wOF2") {
    throw new Error(`${file} is not a woff2 file`);
  }
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  const cursor = { at: WOFF2_HEADER };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[cursor.at++];
    const tag = flags & 0x3f;
    // a tag outside the known list spells itself out in the next four bytes
    if (tag === 0x3f) cursor.at += 4;
    const origLength = uintBase128(buf, cursor);
    const transform = (flags >> 6) & 0x03;
    const transformed = tag === GLYF || tag === LOCA ? transform === 0 : transform !== 0;
    dir.push({ tag, length: transformed ? uintBase128(buf, cursor) : origLength });
  }
  const tables = brotliDecompressSync(buf.subarray(cursor.at, cursor.at + compressedLength));
  let at = 0;
  for (const table of dir) {
    if (table.tag === want) return tables.subarray(at, at + table.length);
    at += table.length;
  }
  throw new Error(`${file} carries no table ${want}`);
}

/** woff2's variable-length integer: seven bits per byte, high bit continues. */
function uintBase128(buf, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[cursor.at++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("malformed UIntBase128");
}

/**
 * The codepoints a `cmap` maps to a real glyph. A subset font's segments can
 * still name a character it dropped, mapping it to glyph 0, the missing-glyph
 * box, so a zero glyph id is not coverage.
 *
 * Formats 4 (BMP) and 12 (full range) are the two Unicode subtables the
 * families ship; a file offering both is read from 12, which is the superset.
 */
function cmapCodepoints(cmap) {
  let best = null;
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const record = 4 + i * 8;
    const platform = cmap.readUInt16BE(record);
    const encoding = cmap.readUInt16BE(record + 2);
    const offset = cmap.readUInt32BE(record + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = cmap.readUInt16BE(offset);
    if (format !== 4 && format !== 12) continue;
    if (!best || format === 12) best = { offset, format };
  }
  if (!best) throw new Error("cmap carries no format 4 or 12 Unicode subtable");
  return best.format === 4 ? segmentMapped(cmap, best.offset) : segmentedCoverage(cmap, best.offset);
}

/** Format 4: parallel end/start/delta/rangeOffset arrays over the BMP. */
function segmentMapped(cmap, offset) {
  const segX2 = cmap.readUInt16BE(offset + 6);
  const ends = offset + 14;
  const starts = ends + segX2 + 2; // + the reserved pad between the two arrays
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const out = new Set();
  for (let i = 0; i < segX2 / 2; i++) {
    const start = cmap.readUInt16BE(starts + i * 2);
    const end = cmap.readUInt16BE(ends + i * 2);
    // the required final segment maps 0xFFFF and describes no real character
    if (start === 0xffff) continue;
    const delta = cmap.readInt16BE(deltas + i * 2);
    const range = cmap.readUInt16BE(ranges + i * 2);
    for (let cp = start; cp <= end; cp++) {
      let glyph;
      if (range === 0) glyph = (cp + delta) & 0xffff;
      else {
        glyph = cmap.readUInt16BE(ranges + i * 2 + range + (cp - start) * 2);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) out.add(cp);
    }
  }
  return out;
}

/** Format 12: groups of (start, end, first glyph id). */
function segmentedCoverage(cmap, offset) {
  const out = new Set();
  for (let i = 0, n = cmap.readUInt32BE(offset + 12); i < n; i++) {
    const group = offset + 16 + i * 12;
    const glyph = cmap.readUInt32BE(group + 8);
    if (!glyph) continue;
    const end = cmap.readUInt32BE(group + 4);
    for (let cp = cmap.readUInt32BE(group); cp <= end; cp++) out.add(cp);
  }
  return out;
}
