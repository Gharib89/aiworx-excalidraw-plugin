/**
 * Authoring helpers. A generator script describes what it wants; this module
 * measures, converts, verifies, and writes the artifacts. The geometry gate
 * (tools/verify.js) runs in-process before anything touches disk — a generator
 * cannot produce a file the gate would reject.
 *
 *   import { authorDiagram } from "<plugin>/tools/author.js";
 *
 *   await authorDiagram({
 *     out: "docs/diagrams/thing.excalidraw",
 *     build: async ({ measure, wrap, palette, PROSE, CODE, stack, row, column, box, arrowBetween }) =>
 *       [ ...skeleton or layout groups ],
 *   });
 *
 * A human-edited file re-enters the pipeline through reviseDiagram, which
 * round-trips it through the library's restore (refreshed text metrics,
 * repaired bindings) and the same gate.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { withExcalidraw } from "./browser.js";
import { bounds, contains } from "./geometry.js";
import { verifyDocument, KNOWN } from "./verify.js";
import { stack, row, column, box, arrowBetween, flatten } from "./layout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const palette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

export const PROSE = palette.fontFamily.prose;
export const CODE = palette.fontFamily.code;

class NamedError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}
/** The build callback returned something that is not a usable skeleton. */
export class SkeletonError extends NamedError {}
/** The built document failed the geometry gate; nothing was written. */
export class GateError extends NamedError {}
/** Text cannot be wrapped to the requested width. */
export class WrapError extends NamedError {}
/** The input file is not a parseable Excalidraw document. */
export class DocumentError extends NamedError {}
/** An image asset cannot be read, recognised, or sized. */
export class AssetError extends NamedError {}
/** A library file cannot be read, parsed, or the requested item found. */
export class LibraryError extends NamedError {}

/**
 * Wrap text to a pixel width using real measurements.
 *
 * Word widths come from one batch measurement and lines are filled greedily;
 * every line is then re-measured and overfull lines are repaired — the last
 * word moves down, and a word that alone exceeds the width is broken at the
 * widest character boundary that fits. The result never exceeds `maxWidth`.
 */
export function makeWrap(measure) {
  return async function wrap(text, maxWidth, { fontSize = 18, fontFamily = PROSE } = {}) {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
      throw new WrapError(`wrap needs a positive pixel width, got ${maxWidth}`);
    }
    const paragraphs = String(text).split("\n");
    const words = [...new Set(paragraphs.flatMap((p) => p.split(/\s+/)).filter(Boolean))];
    if (words.length === 0) return { text: "", width: 0, height: 0, lines: [] };

    const widthOf = async (strs) => {
      const nonEmpty = strs.filter(Boolean);
      const m = await measure(nonEmpty.map((s) => ({ text: s, fontSize, fontFamily })));
      const byStr = new Map(nonEmpty.map((s, i) => [s, m[i].width]));
      return strs.map((s) => (s ? byStr.get(s) : 0));
    };

    const wordWidths = new Map();
    (await widthOf(words)).forEach((w, i) => wordWidths.set(words[i], w));
    const [aSpaceA, aa] = await widthOf(["a a", "aa"]);
    const space = aSpaceA - aa;

    const lines = [];
    for (const para of paragraphs) {
      let line = [];
      let w = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const ww = wordWidths.get(word) ?? 0;
        const next = line.length ? w + space + ww : ww;
        if (line.length && next > maxWidth) {
          lines.push(line.join(" "));
          line = [word];
          w = ww;
        } else {
          line.push(word);
          w = next;
        }
      }
      lines.push(line.join(" "));
    }

    // The greedy fill worked from summed word widths; the renderer draws whole
    // lines. Re-measure and repair until every line actually fits.
    for (let pass = 0; ; pass++) {
      if (pass > 100) throw new WrapError(`wrap did not converge for width ${maxWidth}px`);
      const measured = await widthOf(lines);
      const i = measured.findIndex((w) => w > maxWidth);
      if (i === -1) break;
      const parts = lines[i].split(" ");
      if (parts.length > 1) {
        lines.splice(i, 1, parts.slice(0, -1).join(" "), parts[parts.length - 1]);
        continue;
      }
      // a single word wider than the requested width: break it mid-word
      const word = parts[0];
      const prefixWidths = await widthOf(
        Array.from({ length: word.length }, (_, n) => word.slice(0, n + 1)),
      );
      if (prefixWidths[0] > maxWidth) {
        throw new WrapError(
          `width ${maxWidth}px cannot fit even one character of "${word}" at ${fontSize}px`,
        );
      }
      let cut = 1;
      while (cut < word.length && prefixWidths[cut] <= maxWidth) cut++;
      lines.splice(i, 1, word.slice(0, cut), word.slice(cut));
    }

    const joined = lines.join("\n");
    const [boxM] = await measure([{ text: joined, fontSize, fontFamily }]);
    return { text: joined, width: boxM.width, height: boxM.height, lines };
  };
}

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** Intrinsic pixel size from a PNG's IHDR chunk; null for anything else. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") {
    return null;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Place a real image: the bytes go into the document's files dictionary as a
 * data URL (keyed by content hash, so the same file placed twice travels once)
 * and the returned skeleton element references them by fileId. PNG sizes
 * itself from its header — give `width` or `height` to scale, both to force;
 * other formats need both explicitly.
 */
function makeImage(files) {
  return function image(path, { width, height, ...props } = {}) {
    let buf;
    try {
      buf = readFileSync(path);
    } catch (err) {
      throw new AssetError(`${path}: cannot read image — ${err.message}`);
    }
    const mimeType = IMAGE_MIME[extname(path).toLowerCase()];
    if (!mimeType) {
      throw new AssetError(
        `${path}: unsupported image format — known: ${Object.keys(IMAGE_MIME).join(", ")}`,
      );
    }
    const intrinsic = pngSize(buf);
    if (width === undefined || height === undefined) {
      if (!intrinsic) {
        throw new AssetError(`${path}: needs explicit width and height (intrinsic size is only read from PNG)`);
      }
      if (width !== undefined) height = (width * intrinsic.height) / intrinsic.width;
      else if (height !== undefined) width = (height * intrinsic.width) / intrinsic.height;
      else ({ width, height } = intrinsic);
    }
    const fileId = createHash("sha1").update(buf).digest("hex");
    files[fileId] ??= {
      mimeType,
      id: fileId,
      dataURL: `data:${mimeType};base64,${buf.toString("base64")}`,
      created: Date.now(),
    };
    return { type: "image", x: 0, y: 0, width, height, fileId, status: "saved", ...props };
  };
}

/**
 * Splice one item of an .excalidrawlib (v1 or v2) into a scene. Every id —
 * element ids, group ids — is regenerated per splice, so the same item can be
 * placed twice and neither collides with the scene; references that point
 * outside the item (bindings, boundElements, frame membership) are dropped
 * rather than left dangling for the gate to reject. The item lands with its
 * top-left corner at `at` and comes back as a layout group, so it places like
 * any other item; `ids` lists the fresh element ids for a frame's `children`.
 */
export function spliceLibraryItem(path, { item = 0, at = [0, 0] } = {}) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new LibraryError(`${path}: cannot read library — ${err.message}`);
  }
  const items = data?.libraryItems ?? data?.library?.map((elements) => ({ elements }));
  if (!Array.isArray(items) || items.length === 0) {
    throw new LibraryError(`${path}: no library items found (type ${JSON.stringify(data?.type)})`);
  }
  const picked =
    typeof item === "string" ? items.find((it) => it.name === item) : items[item];
  if (!picked || !Array.isArray(picked.elements) || picked.elements.length === 0) {
    const names = items.map((it, i) => it.name ?? `#${i}`).join(", ");
    throw new LibraryError(`${path}: no item ${JSON.stringify(item)} — has ${items.length}: ${names}`);
  }

  const source = picked.elements.filter((e) => !e.isDeleted);
  const freshId = () => randomBytes(12).toString("base64url");
  const idMap = new Map(source.map((e) => [e.id, freshId()]));
  const groupMap = new Map();

  const elements = source.map((e) => {
    const el = structuredClone(e);
    el.id = idMap.get(e.id);
    el.groupIds = (el.groupIds ?? []).map((g) => {
      if (!groupMap.has(g)) groupMap.set(g, freshId());
      return groupMap.get(g);
    });
    el.frameId = idMap.get(el.frameId) ?? null;
    if (el.containerId) el.containerId = idMap.get(el.containerId) ?? null;
    for (const end of ["startBinding", "endBinding"]) {
      if (el[end]) el[end] = idMap.has(el[end].elementId)
        ? { ...el[end], elementId: idMap.get(el[end].elementId) }
        : null;
    }
    if (Array.isArray(el.boundElements)) {
      el.boundElements = el.boundElements
        .filter((b) => idMap.has(b.id))
        .map((b) => ({ ...b, id: idMap.get(b.id) }));
    }
    return el;
  });

  const boxes = elements.map(bounds);
  const x1 = Math.min(...boxes.map((b) => b.x1));
  const y1 = Math.min(...boxes.map((b) => b.y1));
  for (const el of elements) {
    el.x += at[0] - x1;
    el.y += at[1] - y1;
  }
  return {
    kind: "layout-group",
    x: at[0],
    y: at[1],
    width: Math.max(...boxes.map((b) => b.x2)) - x1,
    height: Math.max(...boxes.map((b) => b.y2)) - y1,
    children: elements,
    ids: elements.map((e) => e.id),
  };
}

/**
 * Bind every element that sits inside a frame to that frame.
 *
 * A frame decides membership by frameId, not by geometry: an element merely
 * sitting on top of a frame renders in the wrong per-frame export or disappears
 * from review. Listing every child id by hand is the alternative, and it silently
 * rots as panels gain elements — so infer it from the geometry that is already there.
 */
function bindToFrames(elements) {
  const frames = elements.filter((e) => e.type === "frame" && !e.isDeleted);
  if (frames.length === 0) return elements;

  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements) {
    if (e.type === "frame" || e.frameId) continue;
    // bound text follows its container, whatever the container's own geometry
    if (e.containerId) {
      const host = byId.get(e.containerId);
      if (host?.frameId) e.frameId = host.frameId;
      continue;
    }
    const b = bounds(e);
    const f = frames.find((fr) => contains(bounds(fr), b));
    if (f) e.frameId = f.id;
  }
  // second pass so bound text picks up a container bound in the first
  for (const e of elements) {
    if (e.containerId && !e.frameId) {
      const host = byId.get(e.containerId);
      if (host?.frameId) e.frameId = host.frameId;
    }
  }
  return elements;
}

/** Reject a skeleton the converter or the gate would choke on, before any browser work. */
function validateSkeleton(built) {
  if (built == null) {
    throw new SkeletonError("build returned nothing — refusing to write an empty diagram");
  }
  if (!Array.isArray(built)) {
    throw new SkeletonError(`build must return an array of elements, got ${typeof built}`);
  }
  const skeleton = flatten(built);
  if (skeleton.length === 0) {
    throw new SkeletonError("build returned an empty skeleton — refusing to write an empty diagram");
  }
  skeleton.forEach((el, i) => {
    if (!el || typeof el !== "object" || Array.isArray(el)) {
      throw new SkeletonError(`skeleton[${i}] is not an element object (${JSON.stringify(el)})`);
    }
    if (!KNOWN.has(el.type)) {
      throw new SkeletonError(
        `skeleton[${i}] has unknown element type ${JSON.stringify(el.type)} — known: ${[...KNOWN].join(", ")}`,
      );
    }
  });
  return skeleton;
}

/**
 * Write every [path, body] pair, or leave all of them as they were.
 *
 * Each body goes to a sibling temp file first and only then is renamed into
 * place. A write is where the failures live — no space, a read-only target, a
 * full quota — and every one of them now happens while the real files are still
 * untouched. The renames that follow need no space and no permission on the
 * target itself, just the directory, so the pair does not diverge.
 */
function writeTogether(pairs) {
  const staged = pairs.map(([path, body]) => ({
    path,
    tmp: `${path}.${randomBytes(6).toString("hex")}.tmp`,
    body,
  }));
  try {
    for (const { tmp, body } of staged) writeFileSync(tmp, body);
  } catch (err) {
    for (const { tmp } of staged) rmSync(tmp, { force: true });
    throw err;
  }
  for (const { path, tmp } of staged) renameSync(tmp, path);
}

/**
 * Gate in-process, then write the .excalidraw and its SVG; a gate failure throws
 * before anything is written. The SVG is rendered before either file is written
 * and both are staged then renamed into place, so a failing export — or a
 * failing write — leaves both files as they were instead of dropping a fresh
 * .excalidraw next to a stale or missing .svg.
 */
async function gateAndWrite(ex, { out, elements, appState, files, svg }) {
  const doc = { type: "excalidraw", version: 2, source: "aiworx-excalidraw", elements, appState, files };
  const { problems } = verifyDocument(doc);
  if (problems.length) {
    throw new GateError(
      `refusing to write ${out} — ${problems.length} defect(s):\n  ${problems.join("\n  ")}`,
    );
  }
  const svgOut = svg ? out.replace(/\.excalidraw$/, "") + ".svg" : null;
  const rendered = svgOut ? await ex.exportSvg({ elements, appState, files }) : null;
  mkdirSync(dirname(out), { recursive: true });
  writeTogether([
    [out, JSON.stringify(doc, null, 2) + "\n"],
    ...(svgOut ? [[svgOut, rendered.svg]] : []),
  ]);
  const frames = elements.filter((e) => e.type === "frame");
  console.log(`${out}  ${elements.length} elements, ${frames.length} frames${svgOut ? `\n${svgOut}` : ""}`);
  return { elements, frames, out, svgOut };
}

const buildContext = (ex, files) => ({
  measure: ex.measureText,
  wrap: makeWrap(ex.measureText),
  palette,
  PROSE,
  CODE,
  stack,
  row,
  column,
  box,
  arrowBetween,
  image: makeImage(files),
  spliceLibraryItem,
});

/** Build, verify in-process, and write a diagram from a skeleton. */
export async function authorDiagram({ out, build, svg = true, background }) {
  return withExcalidraw(async (ex) => {
    const files = {};
    const skeleton = validateSkeleton(await build(buildContext(ex, files)));
    const elements = bindToFrames(await ex.convert(skeleton));
    const appState = {
      viewBackgroundColor: background ?? palette.canvas,
      gridSize: 20,
    };
    return gateAndWrite(ex, { out, elements, appState, files, svg });
  });
}

/**
 * Round-trip a human-edited file back through the pipeline: restore refreshes
 * text metrics and repairs bindings, frame membership is re-inferred, and the
 * same gate runs before the file is rewritten in place.
 */
export async function reviseDiagram({ file, svg = true }) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new DocumentError(`${file}: cannot read — ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new DocumentError(`${file}: not valid JSON — ${err.message}`);
  }
  if (data?.type !== "excalidraw" || !Array.isArray(data.elements)) {
    throw new DocumentError(`${file}: not an Excalidraw document (type ${JSON.stringify(data?.type)})`);
  }
  return withExcalidraw(async (ex) => {
    const restored = await ex.restore(data);
    const elements = restored.elements.filter((e) => !e.isDeleted);
    // A hand edit that moves an element out of its frame leaves a stale
    // frameId behind; clear membership the geometry no longer supports so
    // bindToFrames can re-infer it. Generated files never get here — the
    // converter only binds what a frame actually contains.
    const byId = new Map(elements.map((e) => [e.id, e]));
    for (const e of elements) {
      if (!e.frameId || e.type === "frame") continue;
      const f = byId.get(e.frameId);
      if (!f || f.type !== "frame" || !contains(bounds(f), bounds(e))) e.frameId = null;
    }
    bindToFrames(elements);
    // Deleting an image by hand leaves its bytes behind — the whole data URL,
    // committed forever, because the files dictionary is append-only. Keep only
    // what a live image still points at. Two images sharing one entry (same
    // bytes, same content hash) therefore keep it until the last one goes.
    const referenced = new Set(
      elements.filter((e) => e.type === "image" && e.fileId).map((e) => e.fileId),
    );
    const files = Object.fromEntries(
      Object.entries(data.files ?? {}).filter(([id]) => referenced.has(id)),
    );
    // the human's appState survives the round-trip; defaults fill only the gaps
    const appState = {
      viewBackgroundColor: palette.canvas,
      gridSize: 20,
      ...data.appState,
    };
    return gateAndWrite(ex, { out: file, elements, appState, files, svg });
  });
}
