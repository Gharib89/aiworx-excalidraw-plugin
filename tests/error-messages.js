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
 *   1. every throw site in tools/ passes `where` and `next` — a static walk of
 *      the sources, so a new throw that skips the bar fails here rather than
 *      reaching a user (page.js is exempt: it is minified into the page bundle
 *      and its FontIntegrityError reaches the user wrapped in a PageError, which
 *      carries the bar itself)
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
  makeWrap, spliceLibraryItem,
} from "../tools/author.js";
// browser.js is imported for its error classes only — importing never launches
// Chrome, so this suite stays in the fast (browser-free) target.
import {
  StaleBundleError, BundleLoadError, PageError, ChromeLaunchError, MissingDependencyError,
} from "../tools/browser.js";
import { LayoutError, stack, column, box, arrowBetween } from "../tools/layout.js";

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

const throwSites = (text, file) => {
  const sites = [];
  const re = /throw new ([A-Za-z]\w*Error)\(/g;
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

const sites = readdirSync(toolsDir)
  .filter((f) => f.endsWith(".js") && f !== "page.js")
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

// ---- 2. the composed message carries all three ----

const CLASSES = [
  NamedError, UsageError, DocumentError,
  SkeletonError, GateError, WrapError, AssetError, LibraryError,
  StaleBundleError, BundleLoadError, PageError, ChromeLaunchError, MissingDependencyError,
  LayoutError,
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

await thrown("wrap with a zero width", () => makeWrap(fakeMeasure)("hello", 0), WrapError);
await thrown("stack with no items", () => stack([]), LayoutError);
await thrown("stack with an unknown direction", () => stack([rect("a")], { direction: "diagonal" }), LayoutError);
await thrown("box with a non-numeric angle", () => box(rect("a"), { angle: "sideways" }), LayoutError);
await thrown("arrowBetween an unbindable group",
  () => arrowBetween(column([rect("a")]), rect("b")), LayoutError);
await thrown("splice from a missing library", () => spliceLibraryItem(join(root, "no-such.excalidrawlib")), LibraryError);

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nevery error clears the bar");
process.exit(fail.length ? 1 : 0);
