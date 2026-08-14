#!/usr/bin/env node
/**
 * Contract suite for the shared document loader (tools/document.js).
 *
 * check.js, render.js and author.js's reviseDiagram each used to read, parse
 * and shape-check an .excalidraw file with their own divergent rules — render.js
 * never checked `data.type === "excalidraw"`, so foreign JSON reached Chrome
 * and died as a PageError instead of a clean refusal. readExcalidrawDocument is
 * the one loader all three now share; this suite pins its four failure kinds
 * and the machine-readable `kind` each thrown error carries.
 *
 * Exits non-zero on any mismatch.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readExcalidrawDocument } from "../tools/document.js";
import { DocumentError } from "../tools/errors.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const scratch = mkdtempSync(join(tmpdir(), "document-"));
const file = (name, content) => {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
};

/** Calls readExcalidrawDocument and returns the thrown error, or null. */
const throws = (path) => {
  try {
    readExcalidrawDocument(path);
    return null;
  } catch (err) {
    return err;
  }
};

// ---- a valid document parses and comes back as-is ----
{
  const path = file("valid.excalidraw", JSON.stringify({ type: "excalidraw", elements: [] }));
  const data = readExcalidrawDocument(path);
  check("a valid document returns the parsed object", data?.type === "excalidraw");
  check("a valid document's elements survive", Array.isArray(data?.elements) && data.elements.length === 0);
}

// ---- every failure mode raises DocumentError with a machine kind ----

const CASES = [
  {
    name: "missing file",
    path: () => join(scratch, "does-not-exist.excalidraw"),
    kind: "unreadable",
    what: "cannot read",
  },
  {
    name: "empty file",
    path: () => file("empty.excalidraw", ""),
    kind: "empty-file",
    what: "empty file",
  },
  {
    name: "whitespace-only file",
    path: () => file("whitespace.excalidraw", "   \n\t  "),
    kind: "empty-file",
    what: "empty file",
  },
  {
    name: "invalid JSON",
    path: () => file("invalid.excalidraw", "{nope"),
    kind: "invalid-json",
    what: "not valid JSON",
  },
  {
    name: "foreign JSON with an elements array",
    path: () => file("foreign.excalidraw", JSON.stringify({ elements: [] })),
    kind: "not-excalidraw",
    what: "not an Excalidraw document",
  },
  {
    name: "wrong type",
    path: () => file("wrong-type.excalidraw", JSON.stringify({ type: "json", elements: [] })),
    kind: "not-excalidraw",
    what: "not an Excalidraw document",
  },
];

for (const c of CASES) {
  const path = c.path();
  const err = throws(path);
  check(`${c.name}: throws DocumentError`, err instanceof DocumentError, err?.constructor?.name);
  check(`${c.name}: kind is "${c.kind}"`, err?.kind === c.kind, err?.kind);
  check(`${c.name}: what mentions "${c.what}"`, (err?.what ?? "").includes(c.what), err?.what);
  check(`${c.name}: where is the file path`, err?.where === path, err?.where);
  check(`${c.name}: next is non-empty`, Boolean(err?.next), err?.next);
}

rmSync(scratch, { recursive: true, force: true });

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\ndocument loader holds");
process.exit(fail.length ? 1 : 0);
