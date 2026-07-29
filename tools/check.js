#!/usr/bin/env node
/**
 * Mechanical gate, CLI face. The rules live in tools/verify.js so the authoring
 * API can run them in-process before writing; this wrapper adds the file-level
 * checks (readable, parseable, actually an Excalidraw document) and the output.
 *
 * Usage: node tools/check.js diagram.excalidraw
 * Exits non-zero listing every defect found.
 */
import { readFileSync } from "node:fs";
import { verifyDocument } from "./verify.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: check.js <file.excalidraw>");
  process.exit(2);
}

// 0. the file itself — everything below assumes a parseable Excalidraw document
let raw;
try {
  raw = readFileSync(input, "utf8");
} catch (err) {
  console.error(`${input}: cannot read — ${err.message}`);
  process.exit(2);
}
if (raw.trim() === "") {
  console.error(`${input}: empty file — not an Excalidraw document`);
  process.exit(1);
}
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error(`${input}: not valid JSON — ${err.message}`);
  process.exit(1);
}
if (data?.type !== "excalidraw" || !Array.isArray(data.elements)) {
  console.error(`${input}: not an Excalidraw document (type ${JSON.stringify(data?.type)})`);
  process.exit(1);
}

const { problems, stats } = verifyDocument(data);

console.log(
  `${input}: ${stats.elements} elements, ${stats.frames} frames, ` +
    `${stats.texts} text` +
    (stats.outsideAll ? `, ${stats.outsideAll} outside every frame` : ""),
);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.error("  " + p));
  process.exit(1);
}
console.log("clean — no mechanical defects");
