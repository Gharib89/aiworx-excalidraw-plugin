#!/usr/bin/env node
/**
 * Contract suite for the shared error base (tools/errors.js).
 *
 * Two halves:
 *   1. the base holds — every error the tools throw derives from one NamedError,
 *      carries its own class name, and stays catchable by class, so a caller can
 *      dispatch on `instanceof` instead of matching name strings
 *   2. the duplication stays gone — one definition of the base, one UsageError
 *      shared by both CLIs, no `err.name ===` dispatch left in tools/, and
 *      page.js still independent of the base (it is minified into the bundle,
 *      where a renamed class would break new.target.name)
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NamedError, UsageError, loadDependency } from "../tools/errors.js";
import {
  SkeletonError, GateError, WrapError, DocumentError, AssetError, LibraryError,
} from "../tools/author.js";
// browser.js is imported for its error classes only — importing the module never
// launches Chrome, so this suite still runs without one.
import {
  StaleBundleError, BundleLoadError, PageError, ChromeLaunchError, MissingDependencyError,
} from "../tools/browser.js";
import { LayoutError } from "../tools/layout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = join(root, "tools");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const sources = readdirSync(toolsDir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ file: f, text: readFileSync(join(toolsDir, f), "utf8") }));

// ---- 1. the base holds ----

const DERIVED = [
  UsageError,
  SkeletonError, GateError, WrapError, DocumentError, AssetError, LibraryError,
  StaleBundleError, BundleLoadError, PageError, ChromeLaunchError, MissingDependencyError,
  LayoutError,
];

for (const Cls of DERIVED) {
  const err = new Cls("boom");
  check(`${Cls.name} extends the shared base`, err instanceof NamedError);
  check(`${Cls.name} is catchable as itself`, err instanceof Cls);
  check(`${Cls.name} names itself`, err.name === Cls.name, `got ${err.name}`);
  check(`${Cls.name} keeps its message`, err.message === "boom", err.message);
}

// GateError carries the gate's structured problems alongside the joined prose
{
  const problems = [{ code: "OUT_OF_FRAME", message: "text outside its frame" }];
  const err = new GateError("text outside its frame", { problems });
  check("GateError carries .problems", err.problems === problems);
  check("GateError defaults .problems to empty", new GateError("x").problems.length === 0);
}

// ---- 2. the duplication stays gone ----

const definitions = (needle) =>
  sources.filter((s) => new RegExp(`class ${needle}\\b`).test(s.text)).map((s) => s.file);

check("NamedError is defined once, in errors.js",
  definitions("NamedError").join(",") === "errors.js", definitions("NamedError").join(",") || "nowhere");
check("UsageError is defined once, in errors.js",
  definitions("UsageError").join(",") === "errors.js", definitions("UsageError").join(",") || "nowhere");

const nameDispatch = sources
  .flatMap((s) => s.text.split("\n").map((line, i) => ({ file: s.file, n: i + 1, line })))
  // dispatch on an error-class *name string*; `.name === item` lookups elsewhere are not that
  .filter(({ line }) => /\.name\s*===\s*["'][A-Za-z]*Error["']/.test(line));
check("no error-name dispatch left in tools/", nameDispatch.length === 0,
  nameDispatch.map(({ file, n }) => `${file}:${n}`).join(", "));

// ---- 3. loadDependency turns an absent package into the command that fixes it ----
// Both deferred runtime dependencies (playwright-core for rendering, elkjs for
// graph()) come through this one loader, so its contract is pinned once here.
// tests/pipeline-errors.js proves the driver's end in a real uninstalled copy.
{
  const missing = async () => {
    try {
      await loadDependency("no-such-package-in-this-repo", "the probe needs a package that is not there");
      return null;
    } catch (err) {
      return err;
    }
  };
  const err = await missing();
  check("loadDependency raises MissingDependencyError for an absent package",
    err instanceof MissingDependencyError, err?.name ?? "nothing thrown");
  check("it names the package as where, and the install command as next",
    err?.where === "no-such-package-in-this-repo" && err?.next === "Run: npm install --omit=dev",
    `${err?.where} / ${err?.next}`);
  check("it says which capability the caller just lost",
    /the probe needs a package that is not there/.test(err?.what ?? ""), err?.what);
  check("the raw loader error does not reach the message",
    !/ERR_MODULE_NOT_FOUND/.test(err?.message ?? ""), err?.message);

  // a package that exists resolves to its module, so the guard cannot be a
  // blanket catch that swallows a broken install as a missing one
  const real = await loadDependency("node:path", "the probe needs a package that is there");
  check("loadDependency hands back the module when the package is there",
    typeof real.join === "function");
}

// page.js is minified into the page bundle; the minifier renames classes, so its
// FontIntegrityError must keep its string-literal name and stay off the base.
{
  const page = sources.find((s) => s.file === "page.js").text;
  check("page.js does not import the shared base", !/from\s+"\.\/errors\.js"/.test(page));
  check("FontIntegrityError keeps its literal name", /name\s*=\s*"FontIntegrityError"/.test(page));
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nerror classes hold");
process.exit(fail.length ? 1 : 0);
