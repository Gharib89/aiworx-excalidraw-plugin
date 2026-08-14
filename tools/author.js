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
 *     build: async ({ measure, wrap, palette, PROSE, CODE, stack, row, column, box, arrowBetween, fanOut, graph, fromMermaid, flatten }) =>
 *       [ ...skeleton or layout groups ],
 *   });
 *
 * Several diagrams in one run share a browser session through withAuthoring,
 * which pays one Chromium launch for all of them and gates each one the same way.
 *
 * A human-edited file re-enters the pipeline through reviseDiagram, which
 * round-trips it through the library's restore (refreshed text metrics,
 * repaired bindings) and the same gate.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { withExcalidraw } from "./browser.js";
import { readExcalidrawDocument } from "./document.js";
import { bounds, outlineContains, outline } from "./geometry.js";
import { verifyDocument, KNOWN, isForeignFont } from "./verify.js";
import { stack, row, column, box, arrowBetween, fanOut, graph, flatten, resolveArrows } from "./layout.js";
import { makeFromMermaid } from "./mermaid.js";
import { NamedError, DocumentError } from "./errors.js";

/** The input file is not a parseable Excalidraw document. Defined in errors.js. */
export { DocumentError };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const palette = JSON.parse(readFileSync(join(root, "brand/palette.json"), "utf8"));

export const PROSE = palette.fontFamily.prose;
export const CODE = palette.fontFamily.code;

/** The build callback returned something that is not a usable skeleton. */
export class SkeletonError extends NamedError {}
/**
 * The built document failed the geometry gate; nothing was written.
 * `.problems` holds verify.js's structured problem objects; the message stays
 * the joined human prose.
 */
export class GateError extends NamedError {
  constructor(what, { problems = [], ...locus } = {}) {
    super(what, locus);
    this.problems = problems;
  }
}
/** Text cannot be wrapped to the requested width. */
export class WrapError extends NamedError {}
/** An image asset cannot be read, recognised, or sized. */
export class AssetError extends NamedError {}
/** A library file cannot be read, parsed, or the requested item found. */
export class LibraryError extends NamedError {}

const freshId = () => randomBytes(12).toString("base64url");

/**
 * Wrap text to a pixel width using real measurements.
 *
 * Word widths come from one batch measurement and lines are filled greedily;
 * every line is then re-measured and overfull lines are repaired — the last
 * word moves down, and a word that alone exceeds the width is broken at the
 * widest character boundary that fits. The result never exceeds `maxWidth`.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function makeWrap(measure) {
  return async function wrap(text, maxWidth, { fontSize = 18, fontFamily = PROSE } = {}) {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
      throw new WrapError(`needs a positive pixel width, got ${maxWidth}`, {
        where: "wrap", next: "Pass a positive number for maxWidth.",
      });
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
    // lines. Re-measure and repair until every line actually fits. Every pass
    // splits one line in two and lines never merge, so a text of G graphemes
    // can need at most G splits — more passes means the measure is inconsistent.
    // Count G over every occurrence: `words` is de-duplicated.
    const graphemeCount = new Map(words.map((w) => [w, [...GRAPHEMES.segment(w)].length]));
    const maxPasses = paragraphs.reduce(
      (n, p) => p.split(/\s+/).filter(Boolean).reduce((m, w) => m + graphemeCount.get(w), n),
      paragraphs.length + 1,
    );
    for (let pass = 0; ; pass++) {
      if (pass > maxPasses) {
        throw new WrapError(`did not converge for width ${maxWidth}px`, {
          where: "wrap", next: "Use a measure function that returns consistent widths across calls.",
        });
      }
      const measured = await widthOf(lines);
      const i = measured.findIndex((w) => w > maxWidth);
      if (i === -1) break;
      const parts = lines[i].split(" ");
      if (parts.length > 1) {
        lines.splice(i, 1, parts.slice(0, -1).join(" "), parts[parts.length - 1]);
        continue;
      }
      // a single word wider than the requested width: break it at the widest
      // grapheme boundary that fits — never inside a surrogate pair or ZWJ run
      const word = parts[0];
      const prefixes = [];
      for (const g of GRAPHEMES.segment(word)) {
        prefixes.push((prefixes.at(-1) ?? "") + g.segment);
      }
      const prefixWidths = await widthOf(prefixes);
      if (prefixWidths[0] > maxWidth) {
        throw new WrapError(
          `width ${maxWidth}px cannot fit even one character of "${word}" at ${fontSize}px`,
          { where: "wrap", next: "Raise maxWidth or lower fontSize." },
        );
      }
      let cut = 1;
      while (cut < prefixes.length && prefixWidths[cut] <= maxWidth) cut++;
      lines.splice(i, 1, prefixes[cut - 1], word.slice(prefixes[cut - 1].length));
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
 * and the returned skeleton element references them by fileId.
 *
 * Intrinsic size comes from the bytes for every supported format, so `width`
 * alone (or `height` alone, or neither) is enough to place any of them; passing
 * both forces the size and skips the decode entirely. PNG reads its own header;
 * everything else is decoded by the page's browser — the same engine that will
 * render it — which is why this is async.
 */
function makeImage(ex, files) {
  return async function image(path, { width, height, ...props } = {}) {
    let buf;
    try {
      buf = readFileSync(path);
    } catch (err) {
      throw new AssetError(`cannot read image — ${err.message}`, {
        where: path, next: "Check that the file exists and this process can read it.",
      });
    }
    const mimeType = IMAGE_MIME[extname(path).toLowerCase()];
    if (!mimeType) {
      throw new AssetError("unsupported image format", {
        where: path, next: `Convert it to one of: ${Object.keys(IMAGE_MIME).join(", ")}.`,
      });
    }
    const fileId = createHash("sha1").update(buf).digest("hex");
    files[fileId] ??= {
      mimeType,
      id: fileId,
      dataURL: `data:${mimeType};base64,${buf.toString("base64")}`,
      created: Date.now(),
    };
    if (width === undefined || height === undefined) {
      let intrinsic = pngSize(buf);
      if (!intrinsic) {
        try {
          intrinsic = await ex.imageSize(files[fileId]);
        } catch (err) {
          // the name carries the diagnosis (EncodingError, PageError); a bare
          // message can lose it, or be empty for a non-Error throw
          throw new AssetError(`cannot decode image bytes — ${err.name}: ${err.message || err}`, {
            where: path, next: "Verify the file is valid image data, or pass width and height explicitly.",
          });
        }
      }
      if (!intrinsic) {
        throw new AssetError(
          "states no intrinsic size (an SVG needs width and height, or a viewBox)",
          { where: path, next: "Give explicit width and height." },
        );
      }
      if (width !== undefined) height = (width * intrinsic.height) / intrinsic.width;
      else if (height !== undefined) width = (height * intrinsic.width) / intrinsic.height;
      else ({ width, height } = intrinsic);
    }
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
 *
 * `text: "drop"` removes the item's own text in faces outside the house pair —
 * what a real community item labels itself with, and what the gate refuses as
 * foreign-font. House-pair text in the item survives. The default `"keep"`
 * splices the item verbatim.
 */
export function spliceLibraryItem(path, { item = 0, at = [0, 0], text = "keep" } = {}) {
  if (text !== "keep" && text !== "drop") {
    throw new LibraryError(`unknown text mode ${JSON.stringify(text)}`, {
      where: path,
      next: 'Pass text: "keep" to splice the item\'s own labels, or "drop" to remove the ones outside the house pair.',
    });
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new LibraryError(`cannot read library — ${err.message}`, {
      where: path, next: "Check that the file exists and this process can read it.",
    });
  }
  const items = data?.libraryItems ?? data?.library?.map((elements) => ({ elements }));
  if (!Array.isArray(items) || items.length === 0) {
    throw new LibraryError("no library items found", {
      where: path,
      next: `Pass a v1 { library: [...] } or v2 { libraryItems: [...] } document, not type ${JSON.stringify(data?.type)}.`,
    });
  }
  const picked =
    typeof item === "string" ? items.find((it) => it.name === item) : items[item];
  const noSuchItemError = () => {
    const names = items.map((it, i) => it.name ?? `#${i}`).join(", ");
    return new LibraryError(`no item ${JSON.stringify(item)}`, {
      where: path, next: `Pick one of its ${items.length}: ${names}.`,
    });
  };
  if (!picked || !Array.isArray(picked.elements)) throw noSuchItemError();

  // The emptiness check sits after the filter, not before it: an item holding
  // nothing but tombstones — or nothing but dropped foreign text — has as
  // little to splice as one holding nothing at all, and letting it through
  // leaves Math.min/max with no boxes to measure — a group whose width is
  // -Infinity, which poisons every layout downstream.
  //
  // Dropping here, before the id map, is what keeps the drop honest: a dropped
  // element's id never enters the map, so the remap below nulls or filters
  // every reference to it, and the extent is measured over the survivors.
  const live = picked.elements.filter((e) => !e.isDeleted);
  const source = text === "drop" ? live.filter((e) => !isForeignFont(e)) : live;
  if (source.length === 0) {
    // The drop's own dead end reads nothing like a missing item, so it says so:
    // pointing an author back at the item that just failed is no next action.
    if (live.length) {
      throw new LibraryError(`item ${JSON.stringify(item)} is text outside the house pair and nothing else`, {
        where: path,
        next: "Pick an item that carries a pictogram — dropping this one's text leaves nothing to splice.",
      });
    }
    throw noSuchItemError();
  }
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
    const f = frames.find((fr) => outlineContains(fr, e));
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
    throw new SkeletonError("returned nothing — refusing to write an empty diagram", {
      where: "build", next: "Return an array of elements.",
    });
  }
  if (!Array.isArray(built)) {
    throw new SkeletonError(`must return an array of elements, got ${typeof built}`, {
      where: "build", next: "Return an array of elements.",
    });
  }
  const skeleton = flatten(built);
  if (skeleton.length === 0) {
    throw new SkeletonError("returned an empty skeleton — refusing to write an empty diagram", {
      where: "build", next: "Return at least one element.",
    });
  }
  const ids = new Set();
  skeleton.forEach((el, i) => {
    if (!el || typeof el !== "object" || Array.isArray(el)) {
      throw new SkeletonError(`is not an element object (${JSON.stringify(el)})`, {
        where: `skeleton[${i}]`, next: "Return a plain object with a type for every skeleton entry.",
      });
    }
    if (!KNOWN.has(el.type)) {
      throw new SkeletonError(`has unknown element type ${JSON.stringify(el.type)}`, {
        where: `skeleton[${i}]`, next: `Use one of: ${[...KNOWN].join(", ")}.`,
      });
    }
    // the converter iterates a frame's children to size it and stamp frameId,
    // so a missing list surfaces as a bare TypeError from inside the page
    if (el.type === "frame" && !Array.isArray(el.children)) {
      throw new SkeletonError(
        // the type, not the value: serialising a BigInt or a circular object
        // would throw and replace this error with the TypeError it exists to prevent
        `(frame ${JSON.stringify(el.id ?? el.name ?? "unnamed")}) has no children array, got `
        + (el.children === undefined ? "nothing" : typeof el.children),
        {
          where: `skeleton[${i}]`,
          next: 'List the ids the frame contains: children: ["card-a", "card-b"].'
            + " An empty array is legal for a frame you position and size yourself.",
        },
      );
    }
    // ids are preserved through the convert, where a collision makes the
    // converter silently drop the second element (console.error only)
    if (el.id != null) {
      if (ids.has(el.id)) {
        throw new SkeletonError(`(${el.type}) reuses id ${JSON.stringify(el.id)}`, {
          where: `skeleton[${i}]`, next: "Give it a unique id.",
        });
      }
      ids.add(el.id);
    }
  });
  return skeleton;
}

/** Everything the converter draws with a stroke — what a finish register governs. */
const STROKED = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "freedraw"]);
/**
 * Shapes with an interior the register's fill governs. A closed `line` fills
 * from backgroundColor and honours fillStyle exactly as the area shapes do, so
 * it belongs here; `freedraw` does not — this toolchain ships no freedraw helper
 * and a hand-written one does not render from a plain point list.
 */
const FILLED = new Set(["rectangle", "ellipse", "diamond", "line"]);

/** One register property: which elements it reaches, and what it accepts. */
const oneOf = (...values) => ({
  accepts: (v) => values.includes(v),
  expected: values.map((v) => JSON.stringify(v)).join(", "),
});
const ARROW_ONLY = new Set(["arrow"]);

/**
 * The finish register: the properties a diagram sets once and holds across the
 * whole picture, keyed to the elements each one governs. The vocabulary is the
 * skill's — reference/patterns.md "Finish" and the arrowhead table — and the two
 * must not drift.
 */
const REGISTER = {
  roughness: { governs: STROKED, ...oneOf(0, 1, 2) },
  strokeStyle: { governs: STROKED, ...oneOf("solid", "dashed", "dotted") },
  strokeWidth: { governs: STROKED, accepts: (v) => Number.isFinite(v) && v > 0, expected: "a positive number" },
  fillStyle: { governs: FILLED, ...oneOf("solid", "hachure", "cross-hatch") },
  startArrowhead: { governs: ARROW_ONLY, ...oneOf(null, "arrow", "triangle", "diamond", "circle", "bar") },
  endArrowhead: { governs: ARROW_ONLY, ...oneOf(null, "arrow", "triangle", "diamond", "circle", "bar") },
};

/** The options authorDiagram and withAuthoring's author() accept. */
const AUTHOR_OPTIONS = new Set(["out", "build", "svg", "register"]);

/**
 * Reject an unknown option before any browser work starts. A misspelled key
 * (`regster`) would otherwise be dropped by the destructure and change nothing
 * at all, silently, and the diagram would just come out with the default it
 * was never told to keep.
 */
function validateAuthorOptions(options) {
  if (options == null || typeof options !== "object" || Array.isArray(options)) {
    throw new SkeletonError(
      `must be an object of authoring options, got ${options === null ? "null" : Array.isArray(options) ? "an array" : typeof options}`,
      { where: "options", next: 'Pass an object like { out: "d.excalidraw", build }.' },
    );
  }
  for (const key of Object.keys(options)) {
    if (!AUTHOR_OPTIONS.has(key)) {
      throw new SkeletonError(`has unknown option ${JSON.stringify(key)}`, {
        where: "options", next: `Use one of: ${[...AUTHOR_OPTIONS].join(", ")}.`,
      });
    }
  }
}

/**
 * Reject a register the author cannot have meant, before `build` spends a
 * browser on measuring. A misspelled property is the failure worth catching: it
 * would otherwise change nothing at all, silently, and the diagram would just
 * come out in the wrong finish.
 */
function validateRegister(register) {
  if (register == null) return;
  if (typeof register !== "object" || Array.isArray(register)) {
    throw new SkeletonError(
      `must be an object of finish properties, got ${Array.isArray(register) ? "an array" : typeof register}`,
      { where: "register", next: 'Pass an object like { roughness: 1, strokeStyle: "dashed" }.' },
    );
  }
  for (const [key, value] of Object.entries(register)) {
    const spec = REGISTER[key];
    if (!spec) {
      throw new SkeletonError(`has unknown property ${JSON.stringify(key)}`, {
        where: "register", next: `Use one of: ${Object.keys(REGISTER).join(", ")}.`,
      });
    }
    if (!spec.accepts(value)) {
      throw new SkeletonError(`is ${JSON.stringify(value)}`, {
        where: `register.${key}`, next: `Pass ${spec.expected}.`,
      });
    }
  }
}

/**
 * Fill the register's values into every skeleton element it governs, leaving
 * whatever the element set for itself alone.
 *
 * The register is the diagram's finish held in one place; the per-element value
 * still wins, which is how a deliberate break — roughness 0 on the one panel
 * carrying real numbers, a headless connector in a flow of arrows — stays
 * expressible. "Set for itself" is ownership, not truthiness: an explicit
 * `startArrowhead: null` or `roughness: 0` is a choice, not an absence. Spliced
 * library items carry their author's finish as own properties and so keep it.
 *
 * This is the one pass that replaces elements instead of mutating them, so it
 * has to stay upstream of planBindingStitches — which mutates the array it is
 * handed and would otherwise write to objects that never reach the converter.
 */
function applyRegister(skeleton, register) {
  if (register == null) return skeleton;
  const set = Object.entries(register);
  return skeleton.map((el) => {
    const fill = set.filter(([key]) => REGISTER[key].governs.has(el.type) && !Object.hasOwn(el, key));
    return fill.length ? { ...el, ...Object.fromEntries(fill) } : el;
  });
}

/** What the skeleton converter can bind an arrow to (transform.ts, 0.18.1). */
const CONVERTER_BINDABLE = new Set(["rectangle", "ellipse", "diamond"]);

/**
 * Lift out of the skeleton every arrow binding the converter would break, and
 * reject the forms it would silently mangle.
 *
 * A `start`/`end` ref whose target is an image or frame crashes the converter
 * (soft assertNever, then a TypeError) even though the scene model binds these
 * fully — so the ref is stripped here and the returned stitches are applied to
 * the converted elements by applyBindingStitches. The inline id-less form of
 * such a target has no element to stitch to, and `startBinding`/`endBinding`/
 * `fixedPoint` are hard-nulled by newArrowElement: both get a SkeletonError
 * instead of a silent drop.
 */
function planBindingStitches(skeleton) {
  const typeOf = new Map(skeleton.filter((e) => e.id != null).map((e) => [e.id, e.type]));
  const stitches = [];
  for (const el of skeleton) {
    if (el.type !== "arrow") continue;
    for (const key of ["startBinding", "endBinding", "fixedPoint"]) {
      if (el[key] !== undefined) {
        throw new SkeletonError(`carries ${key}, which the converter silently drops`, {
          where: `arrow ${el.id ?? "(no id)"}`,
          next: "Bind with start: { id } / end: { id } instead.",
        });
      }
    }
    for (const end of ["start", "end"]) {
      const ref = el[end];
      if (!ref || typeof ref !== "object") continue;
      const targetType = ref.id != null ? typeOf.get(ref.id) : ref.type;
      if (targetType === undefined || CONVERTER_BINDABLE.has(targetType)) continue;
      if (ref.id == null) {
        throw new SkeletonError(
          `{ type: ${JSON.stringify(ref.type)} } has no id to stitch a binding to`,
          {
            where: `arrow ${end}`,
            next: `Declare the ${ref.type} as its own element with an id and bind with ${end}: { id }.`,
          },
        );
      }
      if (el.id == null) {
        // a generated id colliding with an author id would make the converter
        // silently drop an element — the very hole the duplicate-id guard closes
        let id = freshId();
        while (typeOf.has(id)) id = freshId();
        typeOf.set(id, el.type);
        el.id = id;
      }
      stitches.push({ arrowId: el.id, end, targetId: ref.id });
      delete el[end];
    }
  }
  return stitches;
}

/**
 * Stitch the bindings planBindingStitches lifted out back onto the converted
 * elements: the binding pair the editor itself would write — `focus: 0` (the
 * centre), `gap` measured from the arrow's endpoint to the target's box — plus
 * the target's back-reference, which is what keeps the pair alive through
 * restore's repairBindings.
 */
function applyBindingStitches(elements, stitches) {
  if (stitches.length === 0) return elements;
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const { arrowId, end, targetId } of stitches) {
    const arrow = byId.get(arrowId);
    const target = byId.get(targetId);
    if (!arrow || !target) {
      throw new SkeletonError(`was lost by convert though a ${end} binding was planned for it`, {
        where: !arrow ? `arrow ${arrowId}` : `element ${targetId}`,
        next: "Report this as a converter bug, with the skeleton that triggered it.",
      });
    }
    const pts = outline(arrow);
    const [px, py] = end === "start" ? pts[0] : pts[pts.length - 1];
    const b = bounds(target);
    const gap = Math.hypot(
      Math.max(b.x1 - px, 0, px - b.x2),
      Math.max(b.y1 - py, 0, py - b.y2),
    );
    arrow[`${end}Binding`] = { elementId: targetId, focus: 0, gap: Math.max(1, gap) };
    if (!target.boundElements?.some((be) => be.id === arrowId)) {
      target.boundElements = [...(target.boundElements ?? []), { id: arrowId, type: "arrow" }];
    }
  }
  return elements;
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
async function gateAndWrite(ex, { out, elements, appState, files, svg, recentered = [] }) {
  const doc = { type: "excalidraw", version: 2, source: "aiworx-excalidraw", elements, appState, files };
  const { problems } = verifyDocument(doc);
  if (problems.length) {
    throw new GateError(
      `refusing to write — ${problems.length} defect(s):\n  ${problems.map((p) => p.message).join("\n  ")}`,
      { problems, where: out, next: "Fix the defects, then re-run." },
    );
  }
  // Every path the success report names is resolved: a relative `out:` resolves
  // against the process cwd, so a generator run from another directory writes
  // there instead — and echoing the path as given made the two runs report the
  // same line. The gate refusal above still names the path as given.
  const outPath = resolve(out);
  const svgOut = svg ? outPath.replace(/\.excalidraw$/, "") + ".svg" : null;
  const rendered = svgOut ? await ex.exportSvg({ elements, appState, files }) : null;
  mkdirSync(dirname(outPath), { recursive: true });
  writeTogether([
    [outPath, JSON.stringify(doc, null, 2) + "\n"],
    ...(svgOut ? [[svgOut, rendered.svg]] : []),
  ]);
  const frames = elements.filter((e) => e.type === "frame");
  const lines = [`${outPath}  ${elements.length} elements, ${frames.length} frames`];
  if (svgOut) lines.push(svgOut);
  // Part of the success report, not a warning — the file is written either way.
  // Both ids, because unbinding a label needs both: clear the text's containerId
  // and the arrow's boundElements entry.
  if (recentered.length) {
    lines.push(`re-centered ${recentered.length} bound label${recentered.length === 1 ? "" : "s"} ` +
      `(${recentered.map((r) => `${r.id} on ${r.containerId}`).join(", ")})`);
  }
  console.log(lines.join("\n"));
  return { elements, frames, out: outPath, svgOut, recentered };
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
  fanOut,
  graph,
  flatten,
  fromMermaid: makeFromMermaid(ex),
  image: makeImage(ex, files),
  spliceLibraryItem,
});

/** One diagram, built and written inside an already-open browser session. */
async function authorInto(ex, options) {
  validateAuthorOptions(options);
  const { out, build, svg = true, register } = options;
  validateRegister(register);
  const files = {};
  // the build is the last thing that can move a shape and validateSkeleton has
  // just flattened its groups, so this is the first and only moment at which
  // every deferred arrow can read its endpoints where they finally stand
  const built = resolveArrows(validateSkeleton(await build(buildContext(ex, files))));
  const skeleton = applyRegister(built, register);
  const stitches = planBindingStitches(skeleton);
  // regenerateIds: false — gate errors then name the author's own ids, and the
  // stitches can find their arrows again; validateSkeleton enforced uniqueness
  const converted = await ex.convert(skeleton, { regenerateIds: false });
  const elements = bindToFrames(applyBindingStitches(converted, stitches));
  const appState = {
    viewBackgroundColor: palette.canvas,
    gridSize: 20,
  };
  return gateAndWrite(ex, { out, elements, appState, files, svg });
}

/** Build, verify in-process, and write a diagram from a skeleton. */
export async function authorDiagram(options) {
  // validated here too, before withExcalidraw spends a browser launch on a
  // call that was always going to be rejected
  validateAuthorOptions(options);
  return withExcalidraw((ex) => authorInto(ex, options));
}

/**
 * Author several diagrams over one browser session — one Chromium launch instead
 * of one per diagram, which is the ~1–2 s a generator was paying per call.
 *
 *   await withAuthoring(async (author) => {
 *     for (const panel of panels) await author({ out: panel.out, build: panel.build });
 *   });
 *
 * `author` takes exactly the options authorDiagram takes and gates each diagram
 * before its own write, so a failure names one diagram and leaves the session
 * usable for the next. Font warming accumulates across the session: a glyph
 * first seen in the fifth diagram re-warms the page, and the strings measured
 * before it still measure the same.
 *
 * Diagrams run one at a time even when the caller fires them together. The page
 * warms fonts for the glyphs it has been asked about and re-warms when a new one
 * appears, which is only correct while a single call is in flight (see
 * tools/page.js): overlap two and one of them measures against the fallback face,
 * silently. `Promise.all` over a batch of panels is the natural thing to write, so
 * the calls queue here rather than the invariant resting on the caller.
 */
export async function withAuthoring(fn) {
  return withExcalidraw(async (ex) => {
    let queue = Promise.resolve();
    try {
      return await fn((options) => {
        const done = queue.then(() => authorInto(ex, options));
        // one diagram's failure is its caller's; the queue later calls chain on
        // must stay resolved or the whole batch fails with the first defect
        queue = done.catch(() => {});
        return done;
      });
    } finally {
      // A diagram handed out but never awaited — a forEach over the panels, a
      // forgotten await — is still work this session promised to do, and the
      // browser closes the moment this returns. Drain before that, or which
      // files landed comes down to timing; in a finally, so a callback that
      // throws leaves the same files behind as one that returns. The queue
      // never rejects, so a caller who dropped a failing diagram still gets
      // their own error, and it never displaces theirs.
      await queue;
    }
  });
}

/**
 * Round-trip a human-edited file back through the pipeline: restore refreshes
 * text metrics and repairs bindings, frame membership is re-inferred, and the
 * same gate runs before the file is rewritten in place.
 *
 * Bound labels restore re-centered onto their arrows come back in `.recentered`
 * and are named in the success output; a pass that moved none stays quiet.
 */
export async function reviseDiagram({ file, svg = true }) {
  const data = readExcalidrawDocument(file);
  return withExcalidraw(async (ex) => {
    // Where every bound arrow label sat before the round-trip. restore re-centers
    // one onto its arrow's path on every pass — house behaviour (CONTEXT.md,
    // **Bound label**) — but silently: an author who dragged a label off the line
    // got output identical to a no-op revise, the move undone with no signal.
    // Reading the positions now is the only chance; restore has already moved
    // them by the time it returns.
    const arrows = new Set(
      data.elements.filter((e) => e.type === "arrow" && !e.isDeleted).map((e) => e.id),
    );
    const labelsBefore = new Map(
      data.elements
        .filter((e) => e.type === "text" && !e.isDeleted && arrows.has(e.containerId))
        .map((e) => [e.id, { x: e.x, y: e.y, containerId: e.containerId }]),
    );
    const restored = await ex.restore(data);
    const elements = restored.elements.filter((e) => !e.isDeleted);
    // Half a pixel: re-measuring the same label under the same font can shift it
    // by a rounding error, and that is not a move anyone made.
    const recentered = elements.flatMap((e) => {
      const was = labelsBefore.get(e.id);
      if (!was || Math.hypot(e.x - was.x, e.y - was.y) <= 0.5) return [];
      return [{ id: e.id, containerId: was.containerId }];
    });
    // A hand edit that moves an element out of its frame leaves a stale
    // frameId behind; clear membership the geometry no longer supports so
    // bindToFrames can re-infer it. Generated files never get here — the
    // converter only binds what a frame actually contains.
    const byId = new Map(elements.map((e) => [e.id, e]));
    for (const e of elements) {
      if (!e.frameId || e.type === "frame") continue;
      const f = byId.get(e.frameId);
      if (!f || f.type !== "frame" || !outlineContains(f, e)) e.frameId = null;
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
    return gateAndWrite(ex, { out: file, elements, appState, files, svg, recentered });
  });
}
