#!/usr/bin/env node
/**
 * Browser suite for the converter contract (#49): what tools/author.js promises
 * about ids and bindings on top of convertToExcalidrawElements 0.18.1.
 *
 *   1. author ids survive the convert; elements without one still get an id
 *   2. a duplicate author id is a SkeletonError before any browser work —
 *      with regenerateIds off the converter would silently drop the second
 *   3. arrows bind to image and frame targets: the converter crashes on the
 *      start/end form, so author.js strips the refs and stitches the bindings
 *      onto the converted elements — round-tripped through the gate and revise
 *   4. the inline id-less form for those targets cannot be stitched: named error
 *   5. startBinding/endBinding/fixedPoint in a skeleton arrow are silently
 *      nulled by the converter, so they are a named error pointing at start/end
 *   6. rectangle/ellipse/diamond targets still bind through the converter itself
 *   7. bound text inherits its container's angle — the alternative `box` names
 *      when it refuses to rotate its own content (#77)
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authorDiagram, withAuthoring, reviseDiagram } from "../tools/author.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "converter-contract-"));
console.log(`artifacts: ${outDir}`);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};
const rejectsWith = async (errorName, promise) => {
  try {
    await promise;
    return { ok: false, detail: "resolved instead of throwing" };
  } catch (err) {
    return {
      ok: err.name === errorName,
      message: String(err.message),
      detail: `${err.name}: ${String(err.message).split("\n")[0]}`,
    };
  }
};

const rect = (id, x, props = {}) => ({
  type: "rectangle", id, x, y: 0, width: 120, height: 60,
  strokeColor: "#1e1e1e", ...props,
});
const arrowFromTo = (x1, x2, props = {}) => ({
  type: "arrow", x: x1, y: 30, width: x2 - x1, height: 0,
  points: [[0, 0], [x2 - x1, 0]], strokeColor: "#1e1e1e", ...props,
});
const swatch = join(root, "tests/fixtures/swatch.jpg");
const imageOut = join(outDir, "arrow-image.excalidraw");

await withAuthoring(async (author) => {
  // ---- 1. author ids survive; id-less elements still get one ----
  {
    const out = join(outDir, "ids.excalidraw");
    const { elements } = await author({
      out, svg: false,
      build: async () => [
        rect("kept-rect", 0),
        { ...rect(undefined, 300), id: undefined },
        { type: "frame", id: "kept-frame", children: ["kept-rect"], name: "ids" },
      ],
    });
    const ids = new Set(elements.map((e) => e.id));
    check("author ids survive the convert", ids.has("kept-rect") && ids.has("kept-frame"),
      [...ids].join(", "));
    const anon = elements.find((e) => e.type === "rectangle" && e.id !== "kept-rect");
    check("an id-less element still gets an id", typeof anon?.id === "string" && anon.id.length > 0,
      anon?.id);
  }

  // ---- 2. duplicate author ids are a SkeletonError, nothing written ----
  {
    const out = join(outDir, "dup.excalidraw");
    const r = await rejectsWith("SkeletonError", author({
      out, svg: false,
      build: async () => [rect("twin", 0), rect("twin", 300)],
    }));
    check("a duplicate id is a SkeletonError naming the id", r.ok && /twin/.test(r.message), r.detail);
    check("a duplicate id writes nothing", !existsSync(out));
  }

  // ---- 3a. arrow → image: stripped before convert, stitched after ----
  {
    const { elements } = await author({
      out: imageOut, svg: false,
      build: async ({ image, arrowBetween }) => {
        const src = rect("src", 0);
        const img = { ...(await image(swatch, { width: 120 })), id: "img", x: 300, y: 0 };
        return [src, img, arrowBetween(src, img, { standoff: 10 })];
      },
    });
    const arrow = elements.find((e) => e.type === "arrow");
    const img = elements.find((e) => e.type === "image");
    check("arrow→image: endBinding is stitched",
      arrow?.endBinding?.elementId === "img" && arrow.endBinding.focus === 0 && arrow.endBinding.gap >= 1,
      JSON.stringify(arrow?.endBinding));
    check("arrow→image: rectangle start still binds",
      arrow?.startBinding?.elementId === "src", JSON.stringify(arrow?.startBinding));
    check("arrow→image: the image lists the arrow in boundElements",
      img?.boundElements?.some((b) => b.id === arrow.id && b.type === "arrow"),
      JSON.stringify(img?.boundElements));
    check("arrow→image: the arrow keeps its authored points",
      Math.abs(arrow.points.at(-1)[0] - arrow.points[0][0] - 160) <= 1,
      JSON.stringify(arrow?.points));
  }

  // ---- 3b. arrow → frame: same stitch ----
  {
    const out = join(outDir, "arrow-frame.excalidraw");
    const { elements } = await author({
      out, svg: false,
      build: async () => {
        const inner = rect("inner", 320, { y: 20 });
        const legend = rect("legend", 0);
        const frame = { type: "frame", id: "fr", x: 300, y: 0, width: 200, height: 120,
          children: ["inner"], name: "target" };
        return [legend, inner, frame,
          arrowFromTo(130, 290, { id: "to-frame", start: { id: "legend" }, end: { id: "fr" } })];
      },
    });
    const arrow = elements.find((e) => e.id === "to-frame");
    const frame = elements.find((e) => e.type === "frame");
    check("arrow→frame: endBinding is stitched",
      arrow?.endBinding?.elementId === "fr", JSON.stringify(arrow?.endBinding));
    check("arrow→frame: the frame lists the arrow in boundElements",
      frame?.boundElements?.some((b) => b.id === "to-frame"), JSON.stringify(frame?.boundElements));
  }

  // ---- 4. the inline id-less form cannot be stitched ----
  {
    const out = join(outDir, "inline.excalidraw");
    const r = await rejectsWith("SkeletonError", author({
      out, svg: false,
      build: async () => [rect("a", 0),
        arrowFromTo(130, 290, { start: { id: "a" }, end: { type: "image" } })],
    }));
    check("an id-less image end is a SkeletonError", r.ok && /image/.test(r.message), r.detail);
    check("an id-less image end writes nothing", !existsSync(out));
  }

  // ---- 5. skeleton startBinding/endBinding/fixedPoint are rejected, named ----
  for (const key of ["startBinding", "endBinding", "fixedPoint"]) {
    const out = join(outDir, `${key}.excalidraw`);
    const r = await rejectsWith("SkeletonError", author({
      out, svg: false,
      build: async () => [rect("a", 0),
        arrowFromTo(130, 290, { [key]: { elementId: "a", focus: 0, gap: 1 } })],
    }));
    check(`skeleton ${key} is a SkeletonError pointing at start/end`,
      r.ok && r.message.includes(key) && /start.*end|end.*start/s.test(r.message), r.detail);
    check(`skeleton ${key} writes nothing`, !existsSync(out));
  }

  // ---- 6. the converter still owns rectangle/ellipse/diamond bindings ----
  {
    const out = join(outDir, "native.excalidraw");
    const { elements } = await author({
      out, svg: false,
      build: async () => [
        rect("left", 0),
        { type: "ellipse", id: "right", x: 300, y: 0, width: 120, height: 60, strokeColor: "#1e1e1e" },
        arrowFromTo(130, 290, { id: "native", start: { id: "left" }, end: { id: "right" } }),
      ],
    });
    const arrow = elements.find((e) => e.id === "native");
    check("trio targets still bind through the converter",
      arrow?.startBinding?.elementId === "left" && arrow?.endBinding?.elementId === "right",
      `${JSON.stringify(arrow?.startBinding)} / ${JSON.stringify(arrow?.endBinding)}`);
  }

  // ---- 7. bound text inherits its container's angle ----
  // this is the route `box` sends a rotated caller to (#77): `box` refuses an
  // angle because it never rotates its content, and the error names bound text
  // as the alternative. Pin the converter promise that makes that advice true.
  {
    const out = join(outDir, "rotated-label.excalidraw");
    const angle = Math.PI / 4;
    const { elements } = await author({
      out, svg: false,
      build: async () => [
        rect("turned", 0, { angle, label: { text: "rotated target", fontFamily: 6, strokeColor: "#1e1e1e" } }),
      ],
    });
    const container = elements.find((e) => e.id === "turned");
    const text = elements.find((e) => e.type === "text");
    check("a skeleton label binds to its rotated container",
      text?.containerId === container?.id, `containerId ${text?.containerId}`);
    check("bound text shares the container's angle",
      text?.angle === container?.angle && container?.angle === angle,
      `text ${text?.angle} / container ${container?.angle}`);
  }
});

// ---- the stitched file survives the revise round-trip ----
{
  const revised = await reviseDiagram({ file: imageOut, svg: false });
  const arrow = revised.elements.find((e) => e.type === "arrow");
  const img = revised.elements.find((e) => e.type === "image");
  check("revise keeps the stitched image binding",
    arrow?.endBinding?.elementId === img?.id, JSON.stringify(arrow?.endBinding));
  const onDisk = JSON.parse(readFileSync(imageOut, "utf8"));
  check("the revised file still carries the binding",
    onDisk.elements.find((e) => e.type === "arrow")?.endBinding?.elementId === img?.id);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nconverter contract holds");
process.exit(fail.length ? 1 : 0);
