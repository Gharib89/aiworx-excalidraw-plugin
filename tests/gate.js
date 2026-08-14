#!/usr/bin/env node
/**
 * Fixture suite for the geometry gate (tools/check.js). Every other step trusts
 * the gate's exit code, so the gate itself is proven here: one clean file must
 * exit 0, and one planted-defect file per live rule must exit 1 *and* name the
 * defect in its output. A second section covers the batch face: many files in
 * one invocation, the combined exit code, and the --json report.
 *
 * Exits non-zero on any mismatch, with the gate's actual output printed.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "tools/check.js");
const fixture = (name) => join(root, "tests/fixtures", `${name}.excalidraw`);

// `code` is the stable problem code the defect must carry in --json;
// `errorCode` the same for file-level failures that never reach the rules.
const CASES = [
  { name: "clean", exit: 0, expect: "no mechanical defects" },
  { name: "duplicate-id", exit: 1, expect: "duplicate id dup", code: "duplicate-id" },
  { name: "frames-overlap", exit: 1, expect: "frames overlap", code: "frame-overlap" },
  { name: "missing-container", exit: 1, expect: "references missing container ghost", code: "missing-container" },
  // a referent that is present but tombstoned is deleted, not missing: the rules
  // read past isDeleted, so the message must not send the author hunting for an
  // element the file still holds
  { name: "deleted-container", exit: 1, expect: "references deleted container tomb", code: "missing-container" },
  { name: "text-overflows-container", exit: 1, expect: "text overflows container", code: "text-overflow" },
  // the app wraps bound text into the padded interior, not the container's box —
  // and for ellipse and diamond only the inscribed text area holds ink
  { name: "text-overflows-padding", exit: 1, expect: "text overflows container", code: "text-overflow" },
  { name: "text-overflows-ellipse", exit: 1, expect: "text overflows container", code: "text-overflow" },
  { name: "text-overflows-diamond", exit: 1, expect: "text overflows container", code: "text-overflow" },
  // a shape clips its text, a line does not: the same width is a defect above
  // and correct rendering here
  { name: "arrow-label-wide", exit: 0, expect: "no mechanical defects" },
  { name: "missing-frame", exit: 1, expect: "references missing frame ghost", code: "missing-frame" },
  { name: "deleted-frame", exit: 1, expect: "references deleted frame tomb", code: "missing-frame" },
  { name: "escapes-frame", exit: 1, expect: "escapes frame", code: "frame-escape" },
  { name: "rotated-escapes-frame", exit: 1, expect: "escapes frame", code: "frame-escape" },
  // containment is judged on ink, not on the box: the corners of a rotated
  // ellipse's box poke past the frame while the ellipse itself fits — and the
  // same ellipse pushed until its own ink pokes out is still reported
  { name: "rotated-ellipse-in-frame", exit: 0, expect: "no mechanical defects" },
  { name: "rotated-ellipse-escapes-frame", exit: 1, expect: "escapes frame", code: "frame-escape" },
  // inside the frame, but flush with its border: a frame export crops at the
  // border, so the panel renders it clipped
  { name: "frame-edge-crowding", exit: 1, expect: "inside the 4px minimum inset", code: "frame-edge-crowding" },
  { name: "unbound-over-frame", exit: 1, expect: "without being bound to it", code: "unbound-over-frame" },
  // overlap is judged on the rotated outline, not its axis-aligned box
  { name: "rotated-clear-of-frame", exit: 0, expect: "no mechanical defects" },
  { name: "arrow-binding-missing", exit: 1, expect: "points at missing element ghost", code: "dangling-binding" },
  // the same distinction the container and frame rules already draw: a referent
  // the file still holds, tombstoned, is deleted — the author undeletes it,
  // where an absent one has to be re-pointed
  { name: "deleted-binding", exit: 1, expect: "points at deleted element tomb", code: "dangling-binding" },
  { name: "empty", exit: 1, expect: "empty file", errorCode: "empty-file" },
  { name: "invalid-json", exit: 1, expect: "not valid JSON", errorCode: "invalid-json" },
  { name: "foreign-json", exit: 1, expect: "not an Excalidraw document", errorCode: "not-excalidraw" },
  { name: "does-not-exist", exit: 2, expect: "cannot read", errorCode: "unreadable" },
  { name: "degenerate-zero-size", exit: 1, expect: "zero size", code: "degenerate" },
  // a linear element carries no size of its own: it degenerates when its points
  // coincide, which the zero-size branch never sees
  { name: "degenerate-zero-length", exit: 1, expect: "zero length", code: "degenerate" },
  { name: "degenerate-non-finite", exit: 1, expect: "non-finite geometry", code: "non-finite-geometry" },
  { name: "unknown-type", exit: 1, expect: 'unknown element type "widget"', code: "unknown-type" },
  { name: "free-texts-overlap", exit: 1, expect: "free texts overlap", code: "free-text-overlap" },
  { name: "rotated-texts-overlap", exit: 1, expect: "free texts overlap", code: "free-text-overlap" },
  { name: "rotated-texts-clear", exit: 0, expect: "no mechanical defects" },
  { name: "arrow-crosses-shape", exit: 1, expect: "crosses rectangle r1", code: "arrow-crossing" },
  // a vertex inside the shape is still a pass-through; only a run that begins at
  // the arrow's tail or is still open at its head is binding hygiene
  { name: "arrow-vertex-inside-shape", exit: 1, expect: "crosses rectangle r1", code: "arrow-crossing" },
  { name: "arrow-ends-inside-shape", exit: 0, expect: "no mechanical defects" },
  { name: "arrowhead-inside-target", exit: 1, expect: "lands inside its target", code: "arrow-buried" },
  { name: "text-struck-by-arrow", exit: 1, expect: "arrow a1 strikes through text t1", code: "text-struck-by-arrow" },
  // a bound label is exempt from its own container arrow — arrow-label-wide
  // (below, still a pass case) is exactly that — but a different arrow
  // striking the same label is still a strike
  { name: "bound-label-other-arrow", exit: 1, expect: "arrow a2 strikes through text t1", code: "text-struck-by-arrow" },
  { name: "text-clear-of-arrow", exit: 0, expect: "no mechanical defects" },
  { name: "off-canvas-stray", exit: 1, expect: "off-canvas stray", code: "stray" },
  // two elements and one gap between them: the gap is the defect, so it is
  // reported once — not once per end (counted below)
  { name: "off-canvas-stray-pair", exit: 1, expect: "off-canvas stray", code: "stray" },
  { name: "off-canvas-strays-two", exit: 1, expect: "off-canvas stray", code: "stray" },
  { name: "low-contrast-text", exit: 1, expect: "needs 4.5:1", code: "low-contrast" },
  // every run scores both themes: a pair that only fails once the dark filter
  // has run is caught without any flag
  { name: "dark-contrast", exit: 1, expect: "under the dark theme", code: "low-contrast" },
  // opacity composes into the ratio: these colours pass solid and fail blended
  { name: "low-contrast-opacity", exit: 1, expect: "needs 4.5:1", code: "low-contrast" },
  { name: "low-contrast-ground-opacity", exit: 1, expect: "needs 4.5:1", code: "low-contrast" },
  // the browser treats an invalid opacity as the initial 1: the pale ink is
  // scored solid and fails, instead of a NaN blend silently passing everything
  { name: "opacity-non-numeric", exit: 1, expect: "needs 4.5:1", code: "low-contrast" },
  // a colour the rule cannot parse is a problem, never a silent fallback…
  { name: "unparseable-color", exit: 1, expect: "not a hex colour", code: "unparseable-color" },
  { name: "transparent-ink", exit: 1, expect: "renders invisible", code: "unparseable-color" },
  { name: "unparseable-canvas", exit: 1, expect: "viewBackgroundColor", code: "unparseable-color" },
  // …but "transparent" as a fill legitimately means the canvas shows through
  { name: "transparent-fill", exit: 0, expect: "no mechanical defects" },
  { name: "text-over-image", exit: 1, expect: 'text "over the screenshot" sits over image i1', code: "text-over-image" },
  { name: "foreign-font", exit: 1, expect: "outside the house pair", code: "foreign-font" },
  { name: "image-missing-bytes", exit: 1, expect: "missing from the files dictionary", code: "missing-image-bytes" },
  { name: "malformed-element", exit: 1, expect: "element at index 1 is not an element object", code: "malformed-element" },
];

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

for (const c of CASES) {
  const r = spawnSync(process.execPath, [gate, fixture(c.name)], { encoding: "utf8" });
  const output = r.stdout + r.stderr;
  check(`${c.name}: exits ${c.exit}`, r.status === c.exit, `got ${r.status}`);
  check(`${c.name}: names the defect`, output.includes(c.expect),
    output.includes(c.expect) ? `"${c.expect}"` : `expected "${c.expect}" in:\n${output.trim()}`);
  if (c.code || c.errorCode) {
    const j = spawnSync(process.execPath, [gate, "--json", fixture(c.name)], { encoding: "utf8" });
    let f = null;
    try {
      f = JSON.parse(j.stdout).files[0];
    } catch {}
    if (c.code) {
      check(`${c.name}: --json carries code ${c.code}`,
        (f?.problems ?? []).some((p) => p.code === c.code && p.message.includes(c.expect)),
        f ? JSON.stringify(f.problems.map((p) => p.code)) : j.stdout.trim().slice(0, 120));
    } else {
      check(`${c.name}: --json error carries code ${c.errorCode}`,
        f?.error?.code === c.errorCode && f.error.message.includes(c.expect),
        JSON.stringify(f?.error));
    }
  }
}

// ---- one gap is one stray problem ----
//
// The rule measures each element's nearest neighbour, so two elements far from
// each other are each other's nearest and both clear the threshold. That is one
// gap seen twice, not two defects: the pair fixture must yield exactly one
// stray, and the three-element fixture must still name the single outlier.
{
  const strays = (name) => {
    const j = spawnSync(process.execPath, [gate, "--json", fixture(name)], { encoding: "utf8" });
    return JSON.parse(j.stdout).files[0].problems.filter((p) => p.code === "stray");
  };
  const pair = strays("off-canvas-stray-pair");
  check("two elements one gap apart report one stray, not two",
    pair.length === 1, JSON.stringify(pair.map((p) => p.elements)));
  const trio = strays("off-canvas-stray");
  check("an outlier beside a cluster is still named alone",
    trio.length === 1 && trio[0].elements.includes("s1"),
    JSON.stringify(trio.map((p) => p.elements)));
  // Two elements that are nearer each other than to the diagram are still two
  // typos, not one gap: collapsing every mutually-nearest pair would silence the
  // second one, so the collapse is confined to a document that holds nothing else.
  const two = strays("off-canvas-strays-two");
  check("two separate strays are both named",
    two.length === 2 && ["s1", "s2"].every((id) => two.some((p) => p.elements.includes(id))),
    JSON.stringify(two.map((p) => p.elements)));
}

// ---- many files at once, and the machine-readable report ----
//
// The single-file cases above are the compatibility contract: this section only
// adds what more than one argument, and --json, are supposed to do.
{
  const run = (...args) => spawnSync(process.execPath, [gate, ...args], { encoding: "utf8" });
  const CLEAN = fixture("clean");
  const DIRTY = fixture("duplicate-id");
  const ABSENT = fixture("does-not-exist");

  const EXAMPLE = join(root, "examples/example.excalidraw");
  const both = run(CLEAN, EXAMPLE);
  check("two clean files exit 0", both.status === 0, `exit ${both.status}`);
  check("two clean files each get a summary",
    both.stdout.includes(CLEAN) && both.stdout.includes(EXAMPLE) &&
      /2 files checked, 0 failed/.test(both.stdout),
    both.stdout.trim().split("\n").pop());

  const mixed = run(CLEAN, DIRTY);
  check("one bad file fails the batch", mixed.status === 1, `exit ${mixed.status}`);
  check("the failing file's defect is named", mixed.stderr.includes("duplicate id dup"),
    mixed.stderr.trim().split("\n").filter(Boolean).slice(0, 2).join(" | "));
  check("the clean file is still reported", mixed.stdout.includes("clean — no mechanical defects"));
  check("the roll-up names which file failed",
    /1 failed: /.test(mixed.stderr) && mixed.stderr.includes(DIRTY),
    mixed.stderr.trim().split("\n").pop());

  const unreadable = run(CLEAN, ABSENT);
  check("an unreadable input outranks a mere defect", unreadable.status === 2, `exit ${unreadable.status}`);

  // A document the rules cannot even walk must not take the batch down with it:
  // every other file is still owed its report.
  const hostile = run(fixture("malformed-element"), CLEAN);
  check("a malformed document does not abort the batch",
    hostile.status === 1 && hostile.stdout.includes("clean — no mechanical defects"),
    `exit ${hostile.status}: ${hostile.stdout.trim().split("\n").pop()}`);

  // A path can start with -- ; the conventional end-of-options marker is how you
  // say so, and it is not itself an input.
  const marker = run("--", CLEAN);
  check("-- ends the options", marker.status === 0 && marker.stdout.includes(CLEAN), `exit ${marker.status}`);
  const markerJson = run("--json", "--", CLEAN);
  check("-- composes with a flag before it",
    markerJson.status === 0 && JSON.parse(markerJson.stdout).files.length === 1, `exit ${markerJson.status}`);

  // A mistyped flag must never be read as a file path. Single-dash spellings of
  // the real flags are the likely typo, and treating one as an input turns a
  // typo into "cannot read -json" — or, with a real file also named, into a
  // silently ignored flag.
  for (const typo of ["-json", "-dark", "-"]) {
    const bad = run(typo, CLEAN);
    check(`${typo} is rejected as an unknown flag`,
      bad.status === 2 && bad.stderr.includes(`UsageError: ${typo}: unknown flag`),
      `exit ${bad.status}: ${bad.stderr.trim().split("\n")[0]}`);
  }
  // …and a real file whose name starts with a dash still reaches the gate
  // through the end-of-options marker.
  const dashed = run("--", "-dashed.excalidraw");
  check("-- still admits a dash-named path as an input",
    dashed.status === 2 && dashed.stderr.includes("-dashed.excalidraw: cannot read"),
    `exit ${dashed.status}: ${dashed.stderr.trim().split("\n")[0]}`);

  // --json: one document, exit codes unchanged
  const j = run(CLEAN, DIRTY, ABSENT, "--json");
  check("--json keeps the worst exit code", j.status === 2, `exit ${j.status}`);
  let doc = null;
  try {
    doc = JSON.parse(j.stdout);
  } catch (err) {
    doc = null;
  }
  check("--json prints one parseable document and nothing else", doc !== null,
    doc ? "" : j.stdout.trim().slice(0, 120));
  if (doc) {
    check("--json covers every file in order",
      doc.files?.length === 3 && doc.files.map((f) => f.file).join("|") === [CLEAN, DIRTY, ABSENT].join("|"),
      JSON.stringify(doc.files?.map((f) => f.ok)));
    check("--json reports ok false for the batch", doc.ok === false);
    check("--json carries per-file problems and stats",
      doc.files[0].ok === true && doc.files[0].problems.length === 0 &&
        doc.files[0].stats.elements > 0 &&
        doc.files[1].problems.some((p) => p.message.includes("duplicate id dup")),
      JSON.stringify(doc.files[1].problems));
    check("--json problems are coded objects naming their elements",
      doc.files[1].problems.some((p) => p.code === "duplicate-id" && p.elements.join() === "dup"),
      JSON.stringify(doc.files[1].problems));
    check("--json names the read failure and nulls its stats",
      doc.files[2].error?.code === "unreadable" &&
        /cannot read/.test(doc.files[2].error.message) && doc.files[2].stats === null,
      JSON.stringify(doc.files[2]));
  }

  const jClean = run(CLEAN, "--json");
  check("--json on a clean file exits 0 with ok true",
    jClean.status === 0 && JSON.parse(jClean.stdout).ok === true, `exit ${jClean.status}`);

  // The error shape matches the other CLIs: a UsageError prefix, the offending
  // token as the where, and the usage line as the next step — not a bare print.
  const bogus = run(CLEAN, "--bogus");
  check("an unknown flag is a usage error",
    bogus.status === 2 && /UsageError: --bogus: unknown flag — usage: check\.js/.test(bogus.stderr),
    `exit ${bogus.status}: ${bogus.stderr.trim().split("\n")[0]}`);
  const noArgs = run();
  check("no input is a usage error",
    noArgs.status === 2 && /UsageError: .*usage: check\.js/.test(noArgs.stderr),
    `exit ${noArgs.status}`);
}

// ---- structured problem objects: per-code fields sit flat at top level ----
//
// The code registry is append-only and messages carry no contract, so machine
// consumers key on these shapes. One fixture per field-bearing code.
{
  const jsonFile = (name) => {
    const r = spawnSync(process.execPath, [gate, "--json", fixture(name)], { encoding: "utf8" });
    return JSON.parse(r.stdout).files[0];
  };
  const find = (f, code) => (f.problems ?? []).find((p) => p.code === code);

  const malformed = find(jsonFile("malformed-element"), "malformed-element");
  check("malformed-element carries index and no elements",
    malformed?.index === 1 && Array.isArray(malformed.elements) && malformed.elements.length === 0,
    JSON.stringify(malformed));

  const contrast = find(jsonFile("low-contrast-text"), "low-contrast");
  check("low-contrast carries ratio, needs, ink, bg, theme",
    typeof contrast?.ratio === "number" && contrast.ratio < contrast.needs &&
      /^#[0-9A-Fa-f]{6}$/.test(contrast.ink) && /^#[0-9A-Fa-f]{6}$/.test(contrast.bg) &&
      contrast.theme === "light" && contrast.elements.join() === "t1",
    JSON.stringify(contrast));

  // one run, both themes: a dark-only failure is stamped dark, and no light
  // problem is invented for a pair that clears the light ratio
  const darkOnly = (jsonFile("dark-contrast").problems ?? []).filter((p) => p.code === "low-contrast");
  check("a dark-only failure yields exactly one problem, stamped theme dark",
    darkOnly.length === 1 && darkOnly[0].theme === "dark", JSON.stringify(darkOnly));
  const bothThemes = (jsonFile("low-contrast-text").problems ?? []).filter((p) => p.code === "low-contrast");
  check("a pair failing both themes yields one problem per theme",
    bothThemes.map((p) => p.theme).sort().join() === "dark,light", JSON.stringify(bothThemes.map((p) => p.theme)));

  const named = find(jsonFile("unparseable-color"), "unparseable-color");
  check("unparseable-color carries field and value and names the element",
    named?.field === "strokeColor" && named.value === "salmon" && named.elements.join() === "t1",
    JSON.stringify(named));
  check("a flagged element gets no low-contrast score",
    !find(jsonFile("unparseable-color"), "low-contrast"),
    JSON.stringify(jsonFile("unparseable-color").problems));

  const canvasProblem = find(jsonFile("unparseable-canvas"), "unparseable-color");
  check("an unparseable canvas names no element and the rest is still scored",
    canvasProblem?.field === "viewBackgroundColor" && canvasProblem.value === "papayawhip" &&
      canvasProblem.elements.length === 0 && !find(jsonFile("unparseable-canvas"), "low-contrast"),
    JSON.stringify(jsonFile("unparseable-canvas").problems));

  const overImage = (jsonFile("text-over-image").problems ?? []).filter((p) => p.code === "text-over-image");
  check("text-over-image is theme-independent: emitted once, no theme field",
    overImage.length === 1 && !("theme" in overImage[0]), JSON.stringify(overImage));

  const overflow = find(jsonFile("text-overflows-container"), "text-overflow");
  check("text-overflow names text then container",
    overflow?.elements.join() === "t1,r1", JSON.stringify(overflow));

  const escape = find(jsonFile("escapes-frame"), "frame-escape");
  check("frame-escape carries element and frame boxes",
    escape?.elements.join() === "r1,f1" &&
      [escape.element, escape.frame].every((b) => ["x1", "y1", "x2", "y2"].every((k) => typeof b?.[k] === "number")),
    JSON.stringify(escape));

  const crowding = find(jsonFile("frame-edge-crowding"), "frame-edge-crowding");
  check("frame-edge-crowding carries the clearance and the inset it needs",
    crowding?.clearance === 2 && crowding.needs === 4 && crowding.elements.join() === "r1,f1",
    JSON.stringify(crowding));

  const buried = find(jsonFile("arrowhead-inside-target"), "arrow-buried");
  check("arrow-buried carries depth and names arrow then target",
    typeof buried?.depth === "number" && buried.depth > 0 && buried.elements.join() === "a1,r2",
    JSON.stringify(buried));

  const struck = find(jsonFile("text-struck-by-arrow"), "text-struck-by-arrow");
  check("text-struck-by-arrow carries clearance and needs, and names text then arrow",
    struck?.clearance === 0 && struck.needs === 6 && struck.elements.join() === "t1,a1",
    JSON.stringify(struck));

  const struckLabel = find(jsonFile("bound-label-other-arrow"), "text-struck-by-arrow");
  check("a bound label struck by a different arrow names the label then that arrow",
    struckLabel?.elements.join() === "t1,a2",
    JSON.stringify(struckLabel));

  check("a label sitting on its own container arrow gets no text-struck-by-arrow",
    !find(jsonFile("arrow-label-wide"), "text-struck-by-arrow"),
    JSON.stringify(jsonFile("arrow-label-wide").problems));
}

// ---- every committed band, held to the same gate ----
//
// A band is generator output, and authorDiagram gates before it writes, so a
// defect in a committed artifact means someone edited the file instead of
// re-running its generator — exactly what the examples are documented not to
// allow. Walked rather than listed, so a band added later is covered the day it
// lands and not the day someone remembers this file.
{
  const bands = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? bands(join(dir, e.name))
        : e.name.endsWith(".excalidraw") ? [join(root, dir, e.name)] : []);

  const committed = bands("examples");
  // a walk that finds nothing would pass the check below without reading a file;
  // the count itself is not pinned, so adding or retiring a band stays a one-file change
  check("the walk finds the committed bands", committed.length > 0, `${committed.length} found`);

  const all = spawnSync(process.execPath, [gate, ...committed], { encoding: "utf8" });
  check("every committed band is gate-clean", all.status === 0,
    all.status === 0 ? `${committed.length} clean`
      : all.stderr.trim().split("\n").filter(Boolean).slice(0, 4).join(" | "));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall gate fixtures behave");
process.exit(fail.length ? 1 : 0);
