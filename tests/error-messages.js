#!/usr/bin/env node
/**
 * The error-message quality bar (tools/errors.js).
 *
 * Every error an agent or a user can hit states three things: **what** failed,
 * **where** it failed (a file, an element id, or the API call at fault), and the
 * one **next** action that fixes it. Next actions are commands or instructions —
 * never links, which rot faster than messages do.
 *
 * Three halves, because the bar needs both universality and truth:
 *   1. every error tools/ constructs passes `where` and `next` — a static walk
 *      of the sources, so a new one that skips the bar fails here rather than
 *      reaching a user
 *   2. the composed message really carries all three, for every error class
 *   3. real thrown errors — the ones reachable without a browser — carry them
 *      too, so the static walk is checking a field that has teeth
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NamedError, UsageError, DocumentError } from "../tools/errors.js";
import {
  SkeletonError, GateError, WrapError, AssetError, LibraryError,
  makeWrap, makeLabel, spliceLibraryItem, authorDiagram,
} from "../tools/author.js";
// browser.js is imported for its error classes only — importing never launches
// Chrome, so this suite stays in the fast (browser-free) target.
import {
  StaleBundleError, BundleLoadError, PageError, ChromeLaunchError, MissingDependencyError,
} from "../tools/browser.js";
import { LayoutError, stack, column, box, arrowBetween } from "../tools/layout.js";
import { MermaidError, makeFromMermaid } from "../tools/mermaid.js";
import { LibraryIndexError, downloadLibrary } from "../tools/library-index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = join(root, "tools");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// ---- 1. every throw site passes the bar ----

/**
 * Index of the `)` that closes the argument list opened at `from`.
 *
 * Hand-rolled because the sources are the fixture: a regex cannot tell a paren
 * in a template literal from one in the call. Frames track `${…}` nesting so an
 * object literal's `}` never reads as the end of a template hole.
 */
function closingParen(text, from) {
  const frames = [{ template: false, paren: 1, brace: 0 }];
  for (let i = from; i < text.length; i++) {
    const top = frames[frames.length - 1];
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (top.template) {
      if (c === "`") frames.pop();
      else if (c === "$" && text[i + 1] === "{") { frames.push({ template: false, paren: 0, brace: 0 }); i++; }
      continue;
    }
    if (c === "'" || c === '"') {
      while (++i < text.length && text[i] !== c) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "`") { frames.push({ template: true }); continue; }
    if (c === "(") top.paren++;
    else if (c === ")") {
      top.paren--;
      if (top.paren === 0 && frames.length === 1) return i;
    } else if (c === "{") top.brace++;
    else if (c === "}") {
      if (top.brace > 0) top.brace--;
      else if (frames.length > 1) frames.pop();
    }
  }
  return -1;
}

// Every construction, not only `throw new` — an error handed to a reject
// callback or returned from a helper reaches the user just the same, and a walk
// that only saw `throw` would exempt it.
const throwSites = (text, file) => {
  const sites = [];
  const re = /new ([A-Za-z]\w*Error)\(/g;
  for (let m; (m = re.exec(text));) {
    const end = closingParen(text, re.lastIndex);
    sites.push({
      file,
      cls: m[1],
      line: text.slice(0, m.index).split("\n").length,
      args: end === -1 ? "" : text.slice(re.lastIndex, end),
    });
  }
  return sites;
};

// errors.js only declares the classes — the one construction in it is the doc
// comment's example. page.js is minified into the page bundle and its
// FontIntegrityError reaches the user wrapped in a PageError, which carries the
// bar itself.
const sites = readdirSync(toolsDir)
  .filter((f) => f.endsWith(".js") && f !== "page.js" && f !== "errors.js")
  .flatMap((f) => throwSites(readFileSync(join(toolsDir, f), "utf8"), f));

check("the sources yield throw sites to audit", sites.length > 0, `${sites.length} sites`);
check("every throw site's argument list parses", sites.every((s) => s.args !== ""),
  sites.filter((s) => s.args === "").map((s) => `${s.file}:${s.line}`).join(", "));

// An empty string would satisfy the key and say nothing, so reject it here — the
// tempting way to keep an old message shape is to blank the locus out.
const missing = (key) => sites.filter((s) =>
  !new RegExp(`\\b${key}:`).test(s.args) || new RegExp(`\\b${key}:\\s*(""|'')`).test(s.args));
for (const key of ["where", "next"]) {
  const bad = missing(key);
  check(`every throw site states a non-empty ${key}`, bad.length === 0,
    bad.map((s) => `${s.file}:${s.line} ${s.cls}`).join(", "));
}

const linked = sites.filter((s) => /https?:\/\//.test(s.args));
check("no error message links to docs", linked.length === 0,
  linked.map((s) => `${s.file}:${s.line}`).join(", "));

// A refusal formats every value it quotes with `shown`, never with raw
// JSON.stringify — which throws on a BigInt and on a circular object, replacing
// the named error with the very TypeError the check exists to prevent.
//
// The ban is unconditional inside an adopting module rather than aimed at the
// caller-supplied values that are actually at risk: which ones those are is not
// decidable from the source, and a rule with per-site exemptions is one a later
// refusal talks itself out of. `shown` renders a module-owned constant
// identically, so paying it everywhere costs nothing.
//
// Importing `shown` is what opts a module in. Elsewhere the idiom still appears
// on values that provably serialise (a JSON.parse result), where a ban is noise.
const adopters = new Set(readdirSync(toolsDir).filter((f) =>
  f.endsWith(".js") && /\bshown\b[^\n]*from "\.\/errors\.js"/.test(readFileSync(join(toolsDir, f), "utf8"))));
check("a module imports the shared value formatter", adopters.size > 0, [...adopters].join(", "));

const rawJson = sites.filter((s) => adopters.has(s.file) && /JSON\.stringify\(/.test(s.args));
check("no refusal in a shown-adopting module formats a value with raw JSON.stringify",
  rawJson.length === 0, rawJson.map((s) => `${s.file}:${s.line} ${s.cls}`).join(", "));

// ---- 2. the composed message carries all three ----

const CLASSES = [
  NamedError, UsageError, DocumentError,
  SkeletonError, GateError, WrapError, AssetError, LibraryError,
  StaleBundleError, BundleLoadError, PageError, ChromeLaunchError, MissingDependencyError,
  LayoutError, MermaidError, LibraryIndexError,
];

for (const Cls of CLASSES) {
  const err = new Cls("it broke", { where: "d.excalidraw", next: "Run: npm run bundle" });
  check(`${Cls.name} composes what/where/next into the message`,
    err.message === "d.excalidraw: it broke — Run: npm run bundle", err.message);
  check(`${Cls.name} keeps the three fields readable`,
    err.what === "it broke" && err.where === "d.excalidraw" && err.next === "Run: npm run bundle");
}

// A locus-free construction still reads as a plain message — re-wraps and test
// fixtures depend on it.
check("a bare message stays untouched", new UsageError("boom").message === "boom");

// GateError keeps its structured problems alongside the bar's fields.
{
  const problems = [{ code: "OUT_OF_FRAME", message: "text outside its frame" }];
  const err = new GateError("1 defect", { where: "d.excalidraw", next: "Move it inside.", problems });
  check("GateError still carries .problems", err.problems === problems);
  check("GateError defaults .problems to empty", new GateError("x").problems.length === 0);
}

// ---- 3. real errors clear the bar ----

const measured = (word, fontSize) => ({ width: word.length * fontSize * 0.5, height: fontSize });
const fakeMeasure = async (items) => items.map((it) => measured(it.text, it.fontSize));
const rect = (id) => ({ type: "rectangle", id, x: 0, y: 0, width: 100, height: 40 });

const thrown = async (label, fn, Cls) => {
  let err;
  try { await fn(); } catch (e) { err = e; }
  if (!(err instanceof Cls)) {
    check(`${label} throws ${Cls.name}`, false, err ? `${err.name}: ${err.message}` : "nothing thrown");
    return;
  }
  check(`${label} states what failed`, Boolean(err.what), err.message);
  check(`${label} states where`, Boolean(err.where), err.message);
  check(`${label} states the next action`, Boolean(err.next), err.message);
  check(`${label} reads all three in one message`,
    Boolean(err.where) && Boolean(err.next)
      && err.message.includes(err.where) && err.message.includes(err.next), err.message);
};

// These three reject at options validation, before withExcalidraw runs — this
// suite is in test:fast and chromeless.js re-runs it with CHROME_PATH pointed
// at nothing, so a guard that slipped past the browser launch would go red.
await thrown("authorDiagram with a misspelled option",
  () => authorDiagram({ out: "x.excalidraw", build: async () => [], regster: {} }), SkeletonError);
await thrown("authorDiagram with null options", () => authorDiagram(null), SkeletonError);
await thrown("authorDiagram with the deleted background option",
  () => authorDiagram({ out: "x.excalidraw", build: async () => [], background: "#fff" }), SkeletonError);

await thrown("wrap with a zero width", () => makeWrap(fakeMeasure)("hello", 0), WrapError);
await thrown("stack with no items", () => stack([]), LayoutError);
await thrown("stack with an unknown direction", () => stack([rect("a")], { direction: "diagonal" }), LayoutError);
await thrown("box with a non-numeric angle", () => box(rect("a"), { angle: "sideways" }), LayoutError);
await thrown("arrowBetween an unbindable group",
  () => arrowBetween(column([rect("a")]), rect("b")), LayoutError);
// fromMermaid refuses an empty source before it reaches the page, so this one
// real refusal is checkable without a browser; the rest live in tests/mermaid.js.
await thrown("fromMermaid with no source", () => makeFromMermaid(null)(""), MermaidError);
await thrown("splice from a missing library", () => spliceLibraryItem(join(root, "no-such.excalidrawlib")), LibraryError);
// A malformed handle is refused before any transport is touched, so this one
// index refusal is checkable offline; the rest live in tests/library.js.
await thrown("download with a handle that is not a library source",
  () => downloadLibrary("../../etc/passwd"), LibraryIndexError);

// ---- 4. a refusal survives the value it refuses ----

// JSON.stringify throws on both of these, so a refusal that formatted the value
// with it raised a TypeError out of the error path instead of its own named
// error: the check reached its verdict and then failed to say so.
const circular = {};
circular.self = circular;
// The build never runs — each of these refuses in the options validation ahead
// of it — so a driver that hands out no page at all is enough to stay chromeless.
const noPage = (fn) => fn({});

for (const [name, bad] of [["a BigInt", 1n], ["a circular object", circular]]) {
  await thrown(`splice with ${name} text mode`,
    () => spliceLibraryItem(join(root, "no-such.excalidrawlib"), { text: bad }), LibraryError);
  await thrown(`label with ${name}`, () => makeLabel(fakeMeasure, { sublabel: 16 })(bad), WrapError);
  await thrown(`authorDiagram with ${name} preset`,
    () => authorDiagram({ out: "x.excalidraw", build: async () => [], preset: bad, driver: noPage }),
    SkeletonError);
  await thrown(`authorDiagram with ${name} in the register`,
    () => authorDiagram({
      out: "x.excalidraw", build: async () => [], register: { roughness: bad }, driver: noPage,
    }), SkeletonError);
  await thrown(`stack with ${name} direction`, () => stack([rect("a")], { direction: bad }), LayoutError);
  await thrown(`arrowBetween with ${name} label`,
    () => arrowBetween(rect("a"), rect("b"), { label: bad }), LayoutError);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nevery error clears the bar");
process.exit(fail.length ? 1 : 0);
