#!/usr/bin/env node
/**
 * Glyph-coverage suite (issue #228).
 *
 * A character no vendored face carries falls through to whatever font the
 * machine supplies, so its measured width is the machine's rather than the
 * repo's, the one thing vendoring the woff2 files into `dist/fonts/` exists to
 * prevent. Two `plugin-tour` strings drifted 3.09px per machine that way, and
 * the shipped rubric was recommending the glyph that did it.
 *
 * Coverage is read from the cmap of the committed woff2 files, not from the
 * `unicodeRange` Excalidraw declares beside them: the package is a
 * devDependency and unreachable from a consumer install, and the declared
 * ranges over-claim: one Nunito subset declares U+2191/U+2193 whose glyphs the
 * shipped bytes do not carry, so a range check would call them covered and the
 * text would still measure per-machine.
 *
 * These checks read committed bytes and need no Chrome, so they run in
 * `test:fast`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_OUTPUT_DIR, VENDORED_FONTS } from "../tools/fonts.js";
import { VENDORED_FAMILY, coveredCodepoints, formatCodepoint, uncoveredCodepoints } from "../tools/glyphs.js";
import { artifacts } from "./lib/examples.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const PROSE = 6;
const CODE = 3;

// ---- 1. the reader answers from the committed bytes ----
{
  const nunito = coveredCodepoints(PROSE);
  // reads every committed woff2, so a file the parser chokes on fails here
  const sizes = Object.entries(VENDORED_FAMILY).map(([n, f]) => `${f}=${coveredCodepoints(Number(n)).size}`);
  check("every vendored family reports a non-empty codepoint set",
    Object.keys(VENDORED_FAMILY).every((n) => coveredCodepoints(Number(n)).size > 0), sizes.join(", "));
  check("printable ASCII is covered in the prose face",
    uncoveredCodepoints(Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(""), PROSE).length === 0);
  // the registry and CONTEXT.md both spell this split out, so it is pinned here
  const cascadia = coveredCodepoints(CODE);
  check("the prose face carries neither tick nor cross nor arrow",
    [0x2713, 0x2717, 0x2192, 0x2191, 0x2193].every((cp) => !nunito.has(cp)),
    [0x2713, 0x2717, 0x2192, 0x2191, 0x2193].filter((cp) => nunito.has(cp)).map(formatCodepoint).join(", "));
  check("the code face carries the tick and the arrows",
    [0x2713, 0x2192, 0x2191, 0x2193].every((cp) => cascadia.has(cp)),
    [0x2713, 0x2192, 0x2191, 0x2193].filter((cp) => !cascadia.has(cp)).map(formatCodepoint).join(", "));
  check("the code face carries no cross either", !cascadia.has(0x2717));
  check("the marks house rule 5 names are carried by both house faces",
    [0x2b, 0xd7].every((cp) => nunito.has(cp) && cascadia.has(cp)));
  check("uncoveredCodepoints names the offending codepoints in order",
    uncoveredCodepoints("✗ a ✓", PROSE).join() === [0x2717, 0x2713].join(),
    uncoveredCodepoints("✗ a ✓", PROSE).join());
  check("a character is reported once however often it is drawn",
    uncoveredCodepoints("✓✓✓", PROSE).length === 1);
  check("a family that ships no vendored face is not judged",
    uncoveredCodepoints("✓", 999).length === 0);
}

// ---- 2. the vendored directories the reader reads are the ones dist/ ships ----
{
  const dirs = readdirSync(join(root, FONT_OUTPUT_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  check("dist/fonts holds exactly the vendored families",
    dirs.join() === [...VENDORED_FONTS].sort().join(), dirs.join());
}

// ---- 3. no committed band draws a glyph its own face lacks ----
// The bands are the repo's visual regression corpus, so a band whose width
// depends on the machine that generated it makes `git diff examples/` unusable
// as the "did my change move geometry?" answer.
{
  const files = artifacts(root).filter((a) => a.endsWith(".excalidraw"));
  check("the walk found the committed bands", files.length > 0, `${files.length} files`);
  for (const file of files) {
    const { elements = [] } = JSON.parse(readFileSync(join(root, file), "utf8"));
    const drifting = elements
      .filter((e) => e?.type === "text" && !e.isDeleted)
      .flatMap((e) => uncoveredCodepoints(e.text, e.fontFamily).map((cp) => `${e.id} ${formatCodepoint(cp)}`));
    check(`${file} draws only vendored glyphs`, drifting.length === 0, drifting.join(", "));
  }
}

// ---- 4. the rubric recommends only glyphs the prose face carries ----
// House rule 5 tells authors to ride a mark alongside red and green. It used to
// name ✓/✗, which is how the defect above reached a user diagram in the first
// place, so the marks it names now are held to the shipped bytes.
{
  const rubric = readFileSync(join(root, "skills/excalidraw-diagram/reference/rubric.md"), "utf8");
  const marks = [...rubric.matchAll(/`(\+)`\/`(×)`/g)].flatMap((m) => [m[1], m[2]]);
  check("house rule 5 names a covered mark pair", marks.length >= 2, marks.join(" "));
  check("every mark the rubric names is carried by the prose face",
    uncoveredCodepoints(marks.join(""), PROSE).length === 0,
    uncoveredCodepoints(marks.join(""), PROSE).map(formatCodepoint).join(", "));
  check("the rubric no longer recommends drawing ✓ or ✗",
    !/`✓`|`✗`|✓\/✗/.test(rubric), (rubric.match(/.{0,40}[✓✗].{0,40}/) ?? [""])[0]);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nevery drawn glyph is vendored");
process.exit(fail.length ? 1 : 0);
