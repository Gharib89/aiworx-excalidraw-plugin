#!/usr/bin/env node
/**
 * Unit suite for spliceLibraryItem (#58, tools/author.js). Pure JSON in, out —
 * no browser, so small libraries written to a temp dir pin the whole contract:
 *
 *   1. an item is picked by index or by name; every malformed selection and
 *      every malformed library is a named LibraryError whose message says what
 *      the library does hold
 *   2. both library shapes splice: v2 `libraryItems` and legacy v1 `library`
 *   3. every id is regenerated per splice — element ids and group ids — so the
 *      same item places twice without colliding with itself or the scene
 *   4. internal references follow the remap (frameId, containerId, bindings,
 *      boundElements) and references pointing outside the item are dropped
 *   5. the item lands with its top-left corner at `at` and reports its extent
 *   6. an item whose every element is deleted is refused like an element-less
 *      one, rather than splicing to an empty group with a non-finite extent
 *   7. `text: "drop"` removes the item's own text in faces outside the house
 *      pair and leaves the group's extent, children and ids describing what
 *      survived; the default keeps it, an unknown mode is refused, and an item
 *      dropped to nothing is refused like an element-less one
 *
 * The stick-figure library (examples/) is the real-world case; everything that
 * needs a specific shape is written inline, so the expectation and the input
 * read together.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spliceLibraryItem, PROSE } from "../tools/author.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "splice-"));
const LIB = join(root, "examples/stick-figure.excalidrawlib");
console.log(`artifacts: ${outDir}`);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};
const throwsWith = (errorName, fn) => {
  try {
    fn();
    return { ok: false, detail: "returned instead of throwing" };
  } catch (err) {
    return { ok: err.name === errorName, message: String(err.message), detail: `${err.name}: ${String(err.message).split("\n")[0]}` };
  }
};

/** A realistic full Excalidraw element, so only the case's own fields vary. */
const el = (id, extra = {}) => ({
  id, type: "rectangle", x: 0, y: 0, width: 40, height: 40, angle: 0,
  strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
  strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
  groupIds: [], frameId: null, roundness: null, seed: 1, version: 1,
  versionNonce: 1, isDeleted: false, link: null, locked: false, ...extra,
});
const library = (name, doc) => {
  const path = join(outDir, `${name}.excalidrawlib`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
};

// ---- 1. splicing regenerates ids and group ids ----
{
  const sourceIds = new Set(
    JSON.parse(readFileSync(LIB, "utf8")).libraryItems[0].elements.map((e) => e.id),
  );
  const a = spliceLibraryItem(LIB);
  const b = spliceLibraryItem(LIB);
  check("a splice carries every element of the item", a.children.length === 5 && a.ids.length === 5);
  check("spliced ids are regenerated", a.ids.every((id) => !sourceIds.has(id)), a.ids.join(", "));
  check("two splices of one item share no ids", a.ids.every((id) => !b.ids.includes(id)));
  const groupsA = new Set(a.children.flatMap((e) => e.groupIds));
  const groupsB = new Set(b.children.flatMap((e) => e.groupIds));
  check("the item's group survives under a fresh id",
    groupsA.size === 1 && !groupsA.has("fig-group"),
    [...groupsA].join(", "));
  check("two splices get distinct group ids", [...groupsA].every((g) => !groupsB.has(g)));
}

// ---- 2. offset and extent ----
{
  const fig = spliceLibraryItem(LIB, { at: [100, 200] });
  const minX = Math.min(...fig.children.map((e) => e.x));
  const minY = Math.min(...fig.children.map((e) => e.y));
  check("at: places the item's top-left corner", Math.abs(minX - 100) < 0.5 && Math.abs(minY - 200) < 0.5,
    `min ${minX},${minY}`);
  check("the group reports the item's extent",
    Math.abs(fig.width - 36) < 0.5 && Math.abs(fig.height - 84) < 0.5,
    `${fig.width}x${fig.height}`);
  check("the group places like a layout item", fig.kind === "layout-group" && fig.x === 100 && fig.y === 200);
}

// ---- 3. selection, and every malformed input is a named error ----
{
  const byName = spliceLibraryItem(LIB, { item: "stick figure" });
  check("an item selects by name", byName.children.length === 5);
  const byIndex = spliceLibraryItem(LIB, { item: 0 });
  check("an item selects by index", byIndex.children.length === 5);

  const noName = throwsWith("LibraryError", () => spliceLibraryItem(LIB, { item: "no such item" }));
  check("an unknown item name is a LibraryError", noName.ok, noName.detail);
  // the message is the whole diagnosis: a generator that named the item wrong
  // needs to see what the library actually holds, not just that it missed
  check("the miss lists what the library holds",
    noName.message?.includes('no item "no such item"') && noName.message.includes("Pick one of its 1: stick figure"),
    noName.message);
  const noIndex = throwsWith("LibraryError", () => spliceLibraryItem(LIB, { item: 3 }));
  check("an out-of-range index is a LibraryError", noIndex.ok, noIndex.detail);
  check("the out-of-range miss also lists the items",
    noIndex.message?.includes("no item 3") && noIndex.message.includes("Pick one of its 1: stick figure"),
    noIndex.message);

  const missing = throwsWith("LibraryError", () => spliceLibraryItem(join(outDir, "nope.excalidrawlib")));
  check("a missing library file is a LibraryError", missing.ok, missing.detail);
  check("the unreadable file names the path and the read failure",
    missing.message?.includes("cannot read library") && missing.message.includes("nope.excalidrawlib"),
    missing.message);

  const badJson = join(outDir, "bad.excalidrawlib");
  writeFileSync(badJson, "{ not json");
  const bad = throwsWith("LibraryError", () => spliceLibraryItem(badJson));
  check("unparseable library JSON is a LibraryError", bad.ok, bad.detail);

  const noItems = library("empty", { type: "excalidrawlib", version: 2, libraryItems: [] });
  const empty = throwsWith("LibraryError", () => spliceLibraryItem(noItems));
  check("a library with no items is a LibraryError", empty.ok, empty.detail);

  // neither shape present at all — a scene handed to the library reader, say
  const foreign = library("foreign", { type: "excalidraw", version: 2, elements: [] });
  const notALibrary = throwsWith("LibraryError", () => spliceLibraryItem(foreign));
  check("a document that is not a library is a LibraryError", notALibrary.ok, notALibrary.detail);
  check("the non-library names the type it found",
    notALibrary.message?.includes("no library items found") && notALibrary.message.includes('"excalidraw"'),
    notALibrary.message);

  // an item present but element-less is as unusable as a missing one
  const hollow = library("hollow", { type: "excalidrawlib", version: 2, libraryItems: [{ name: "hollow", elements: [] }] });
  const noElements = throwsWith("LibraryError", () => spliceLibraryItem(hollow));
  check("an item with no elements is a LibraryError", noElements.ok, noElements.detail);
}

// ---- 4. v1 library format, and binding sanitisation ----
{
  const rect = el("a", {
    boundElements: [{ id: "conn", type: "arrow" }, { id: "ghost", type: "arrow" }],
  });
  const arrow = el("conn", {
    type: "arrow", x: 50, y: 20, width: 30, height: 0, seed: 2, versionNonce: 2,
    points: [[0, 0], [30, 0]],
    startBinding: { elementId: "a", focus: 0, gap: 10 },
    endBinding: { elementId: "ghost", focus: 0, gap: 10 },
  });
  const v1 = library("v1", { type: "excalidrawlib", version: 1, library: [[rect, arrow]] });
  const spliced = spliceLibraryItem(v1);
  check("a v1 library splices", spliced.children.length === 2);
  const [r, arr] = spliced.children;
  check("an in-item binding is remapped", arr.startBinding?.elementId === r.id,
    `${arr.startBinding?.elementId} vs ${r.id}`);
  check("a binding pointing outside the item is dropped", arr.endBinding == null);
  check("boundElements keeps only in-item references",
    r.boundElements?.length === 1 && r.boundElements[0].id === arr.id,
    JSON.stringify(r.boundElements));
  // a v1 library has no names: index is the only handle
  const v1ByName = throwsWith("LibraryError", () => spliceLibraryItem(v1, { item: "anything" }));
  check("a v1 item has no name to select by", v1ByName.ok, v1ByName.detail);
}

// ---- 5. frame membership, containers, and groups all remap together ----
//
// A dangling frameId or containerId is exactly what the gate rejects
// (missing-frame, missing-container), so the splice must either remap a
// reference or null it — never carry the source id through.
{
  const panel = library("panel", {
    type: "excalidrawlib", version: 2,
    libraryItems: [{
      name: "panel",
      elements: [
        el("f1", { type: "frame", width: 200, height: 120, name: "panel" }),
        el("r1", { x: 10, y: 10, frameId: "f1", groupIds: ["g1"] }),
        el("t1", {
          type: "text", x: 14, y: 14, width: 30, height: 20, text: "hi",
          fontSize: 16, fontFamily: 1, containerId: "r1", frameId: "f1", groupIds: ["g1"],
        }),
        el("r2", { x: 60, y: 10, frameId: "outside-frame", groupIds: ["g1"] }),
        el("t2", {
          type: "text", x: 64, y: 14, width: 30, height: 20, text: "yo",
          fontSize: 16, fontFamily: 1, containerId: "outside-container",
        }),
      ],
    }],
  });
  const [frame, r1, t1, r2, t2] = spliceLibraryItem(panel).children;
  const fresh = new Set([frame.id, r1.id, t1.id, r2.id, t2.id]);
  check("no source id survives the splice",
    fresh.size === 5 && ["f1", "r1", "t1", "r2", "t2"].every((id) => !fresh.has(id)),
    [...fresh].join(", "));
  check("frame membership follows the frame's fresh id", r1.frameId === frame.id && t1.frameId === frame.id,
    `${r1.frameId}, ${t1.frameId} vs ${frame.id}`);
  check("a frameId pointing outside the item is nulled", r2.frameId === null, JSON.stringify(r2.frameId));
  check("a container reference follows its container", t1.containerId === r1.id,
    `${t1.containerId} vs ${r1.id}`);
  check("a containerId pointing outside the item is nulled", t2.containerId === null,
    JSON.stringify(t2.containerId));
  const groups = new Set([r1, t1, r2].flatMap((e) => e.groupIds));
  check("one source group becomes one fresh group shared by its members",
    groups.size === 1 && !groups.has("g1"), [...groups].join(", "));
  check("an element with no source group joins none", frame.groupIds.length === 0 && t2.groupIds.length === 0,
    JSON.stringify([frame.groupIds, t2.groupIds]));
}

// ---- 6. an item with nothing live in it is refused, not spliced to nothing ----
//
// The element-less guard runs after the isDeleted filter, so an item of nothing
// but tombstones is rejected exactly like a genuinely element-less one. Before
// this it cleared the guard and produced an empty group whose extent was
// Math.min/max over no boxes — width -Infinity, silently poisoning whatever
// laid it out.
{
  const dead = library("dead", {
    type: "excalidrawlib", version: 2,
    libraryItems: [{
      name: "gone",
      elements: [el("x", { isDeleted: true }), el("y", { isDeleted: true })],
    }],
  });
  const allDeleted = throwsWith("LibraryError", () => spliceLibraryItem(dead, { at: [10, 20] }));
  check("an all-deleted item is a LibraryError, not an empty group",
    allDeleted.ok, allDeleted.detail);
  check("the refusal names the item it could not use",
    allDeleted.message?.includes("no item 0 — Pick one of its 1: gone"), allDeleted.message);
  // the deleted elements are dropped, not spliced as tombstones
  const live = spliceLibraryItem(library("mixed", {
    type: "excalidrawlib", version: 2,
    libraryItems: [{
      name: "mixed",
      elements: [el("keep", { width: 40, height: 40 }), el("drop", { x: 200, isDeleted: true })],
    }],
  }));
  check("a deleted element is dropped from a live item",
    live.children.length === 1 && live.width === 40, `${live.children.length} children, width ${live.width}`);
}

// ---- 7. text: "drop" removes the item's own foreign-font labels ----
//
// Every item of a real community library labels itself in Excalidraw's own
// faces, so the default splice hands the gate text the author never wrote
// (foreign-font). "drop" removes exactly that text before the group is
// assembled, so the bounds, children and ids all describe what is left.
{
  const labelled = library("labelled", {
    type: "excalidrawlib", version: 2,
    libraryItems: [{
      name: "icon",
      elements: [
        el("box", { width: 40, height: 40, boundElements: [{ id: "label", type: "text" }] }),
        // the item's own container label, in a face outside the house pair
        el("label", {
          type: "text", x: 4, y: 12, width: 32, height: 20, text: "Kinesis",
          fontSize: 16, fontFamily: 1, containerId: "box",
        }),
        // a free foreign label wide and low enough to own the item's extent
        el("wide", {
          type: "text", x: 0, y: 100, width: 200, height: 20, text: "AWS",
          fontSize: 16, fontFamily: 5,
        }),
        el("keeper", {
          type: "text", x: 0, y: 60, width: 30, height: 20, text: "mine",
          fontSize: 16, fontFamily: PROSE,
        }),
      ],
    }],
  });

  const kept = spliceLibraryItem(labelled);
  check("the default splice still carries the item's foreign text",
    kept.children.length === 4 && kept.children.some((e) => e.fontFamily === 1),
    `${kept.children.length} children`);
  check("the default splice reports the extent the foreign text owns",
    kept.width === 200 && kept.height === 120, `${kept.width}x${kept.height}`);

  const dropped = spliceLibraryItem(labelled, { text: "drop" });
  const texts = dropped.children.filter((e) => e.type === "text");
  check('text: "drop" removes text outside the house pair',
    dropped.children.length === 2 && !texts.some((t) => t.fontFamily === 1 || t.fontFamily === 5),
    dropped.children.map((e) => `${e.type}:${e.fontFamily ?? "-"}`).join(", "));
  check('text: "drop" keeps house-pair text the item wrote',
    texts.length === 1 && texts[0].text === "mine" && texts[0].fontFamily === PROSE,
    JSON.stringify(texts.map((t) => t.text)));
  // an extent measured over dropped elements is the same lie as an empty
  // group's -Infinity: it reserves space nothing occupies
  check('text: "drop" reports the extent of what is left',
    dropped.width === 40 && dropped.height === 80, `${dropped.width}x${dropped.height}`);
  check('text: "drop" keeps ids and children in step',
    dropped.ids.length === dropped.children.length
      && dropped.ids.every((id, i) => id === dropped.children[i].id),
    `${dropped.ids.length} ids, ${dropped.children.length} children`);
  const box = dropped.children.find((e) => e.type === "rectangle");
  check('a container whose bound text was dropped keeps no dangling reference',
    box?.boundElements?.length === 0, JSON.stringify(box?.boundElements));

  // "retype" is the mode an author reaches for and this splice does not have:
  // the refusal has to name what it does have, not merely say no
  const badMode = throwsWith("LibraryError", () => spliceLibraryItem(labelled, { text: "retype" }));
  check("an unknown text mode is a LibraryError", badMode.ok, badMode.detail);
  check("the unknown text mode names the modes that exist",
    badMode.message?.includes('unknown text mode "retype"')
      && badMode.message.includes('"keep"') && badMode.message.includes('"drop"'),
    badMode.message);

  // nothing but foreign text left is nothing to splice, exactly like an item of
  // nothing but tombstones — not a group with a non-finite extent
  const allForeign = library("all-foreign", {
    type: "excalidrawlib", version: 2,
    libraryItems: [{
      name: "words only",
      elements: [el("w", {
        type: "text", width: 30, height: 20, text: "AWS", fontSize: 16, fontFamily: 1,
      })],
    }],
  });
  check("the same item splices whole by default", spliceLibraryItem(allForeign).children.length === 1);
  const nothingLeft = throwsWith("LibraryError", () => spliceLibraryItem(allForeign, { text: "drop" }));
  check("an item dropped to nothing is refused, not spliced to an empty group",
    nothingLeft.ok, nothingLeft.detail);
  // "no item 0 — pick one of its 1" would be false and circular here: the item
  // is there, and picking it again is what just failed
  check("the dead end names the drop, not a missing item",
    nothingLeft.message?.includes("text outside the house pair and nothing else")
      && nothingLeft.message.includes("pictogram"),
    nothingLeft.message);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nspliceLibraryItem holds its contract");
process.exit(fail.length ? 1 : 0);
