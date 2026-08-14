/**
 * One loader for every tool that opens an .excalidraw file: read, refuse empty,
 * parse, verify the Excalidraw shape. Throws DocumentError with a machine
 * `kind` so check.js can map file-level failures to its code contract while
 * render/revise print the same error as-is. Local imports only — check.js
 * stays dependency-free.
 */
import { readFileSync } from "node:fs";
import { DocumentError } from "./errors.js";

export function readExcalidrawDocument(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new DocumentError(`cannot read — ${err.message}`, {
      kind: "unreadable", where: file, next: "Check that the file exists and is readable.",
    });
  }
  if (raw.trim() === "") {
    throw new DocumentError("empty file — not an Excalidraw document", {
      kind: "empty-file", where: file, next: 'Pass a file with type: "excalidraw" and an elements array.',
    });
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new DocumentError(`not valid JSON — ${err.message}`, {
      kind: "invalid-json", where: file, next: "Fix the JSON syntax error.",
    });
  }
  if (data?.type !== "excalidraw" || !Array.isArray(data.elements)) {
    throw new DocumentError(`not an Excalidraw document (type ${JSON.stringify(data?.type)})`, {
      kind: "not-excalidraw", where: file, next: 'Pass a file with type: "excalidraw" and an elements array.',
    });
  }
  return data;
}
