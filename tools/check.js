#!/usr/bin/env node
/**
 * Geometry gate. Catches the defects that are invisible in JSON and tedious to
 * spot by eye, so eyes are spent on composition instead.
 *
 * Usage: node tools/check.js diagram.excalidraw
 * Exits non-zero listing every defect found.
 */
import { readFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("usage: check.js <file.excalidraw>");
  process.exit(2);
}

const data = JSON.parse(readFileSync(input, "utf8"));
const els = (data.elements ?? []).filter((e) => !e.isDeleted);
const frames = els.filter((e) => e.type === "frame");
const others = els.filter((e) => e.type !== "frame");
const byId = new Map(els.map((e) => [e.id, e]));

const problems = [];
const note = (msg) => problems.push(msg);

// Arrows and lines carry their shape in points; x/y is only the origin.
function bounds(e) {
  if ((e.type === "arrow" || e.type === "line") && Array.isArray(e.points)) {
    const xs = e.points.map((p) => e.x + p[0]);
    const ys = e.points.map((p) => e.y + p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  return {
    x1: e.x,
    y1: e.y,
    x2: e.x + Math.abs(e.width ?? 0),
    y2: e.y + Math.abs(e.height ?? 0),
  };
}
const overlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const contains = (outer, inner, pad = 0.5) =>
  inner.x1 >= outer.x1 - pad &&
  inner.y1 >= outer.y1 - pad &&
  inner.x2 <= outer.x2 + pad &&
  inner.y2 <= outer.y2 + pad;

// 1. duplicate ids — silently drops elements on import
const seen = new Set();
for (const e of els) {
  if (seen.has(e.id)) note(`duplicate id ${e.id} (${e.type})`);
  seen.add(e.id);
}

// 2. frames must not overlap: a band reads left to right, and overlapping frames
//    make exportingFrame pick up a neighbour's elements
for (let i = 0; i < frames.length; i++) {
  for (let j = i + 1; j < frames.length; j++) {
    if (overlap(bounds(frames[i]), bounds(frames[j]))) {
      note(`frames overlap: "${frames[i].name ?? frames[i].id}" and "${frames[j].name ?? frames[j].id}"`);
    }
  }
}

// 3. bound text must fit its container, or it renders clipped
for (const t of others.filter((e) => e.type === "text" && e.containerId)) {
  const c = byId.get(t.containerId);
  if (!c) {
    note(`text "${preview(t.text)}" references missing container ${t.containerId}`);
    continue;
  }
  if (t.width > (c.width ?? 0) + 1 || t.height > (c.height ?? 0) + 1) {
    note(
      `text overflows container: "${preview(t.text)}" ${round(t.width)}x${round(t.height)} in ${round(c.width)}x${round(c.height)} (${c.type} ${c.id})`,
    );
  }
}

// 4. every element bound to a frame must sit inside it
for (const e of others.filter((e) => e.frameId)) {
  const f = byId.get(e.frameId);
  if (!f) {
    note(`element ${e.id} (${e.type}) references missing frame ${e.frameId}`);
    continue;
  }
  if (!contains(bounds(f), bounds(e))) {
    const b = bounds(e);
    const fb = bounds(f);
    note(
      `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} escapes frame "${f.name ?? f.id}": element ${round(b.x1)},${round(b.y1)}–${round(b.x2)},${round(b.y2)} vs frame ${round(fb.x1)},${round(fb.y1)}–${round(fb.x2)},${round(fb.y2)}`,
    );
  }
}

// 5. an element overlapping a frame it isn't bound to is a defect: per-frame
//    export decides membership by frameId, so it renders in the wrong panel or
//    vanishes from review. Elements clear of every frame are fine — titles,
//    legends and captions legitimately sit outside the band.
let outsideAll = 0;
if (frames.length > 0) {
  for (const e of others.filter((e) => !e.frameId && !e.containerId)) {
    const host = frames.find((f) => overlap(bounds(f), bounds(e)));
    if (host) {
      note(
        `${e.type} ${e.id}${e.text ? ` "${preview(e.text)}"` : ""} sits over frame "${host.name ?? host.id}" without being bound to it`,
      );
    } else {
      outsideAll++;
    }
  }
}

// 6. bindings must resolve
for (const a of others.filter((e) => e.type === "arrow")) {
  for (const end of ["startBinding", "endBinding"]) {
    const id = a[end]?.elementId;
    if (id && !byId.get(id)) note(`arrow ${a.id} ${end} points at missing element ${id}`);
  }
}

function preview(s) {
  return String(s ?? "").split("\n")[0].slice(0, 40);
}
function round(n) {
  return Math.round(Number(n ?? 0));
}

console.log(
  `${input}: ${els.length} elements, ${frames.length} frames, ` +
    `${others.filter((e) => e.type === "text").length} text` +
    (outsideAll ? `, ${outsideAll} outside every frame` : ""),
);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.error("  " + p));
  process.exit(1);
}
console.log("geometry clean");
