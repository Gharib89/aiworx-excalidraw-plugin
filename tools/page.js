/**
 * Browser-side entry. Bundled by tools/bundle.js into dist/excalidraw-page.js and
 * loaded into a headless Chromium page by tools/browser.js.
 *
 * Everything here must run in a DOM: the Excalidraw library needs one even for
 * convertToExcalidrawElements, and text metrics are only correct when a real
 * browser measures them (jsdom mismeasures by ~20% and drops font embeds).
 */
import {
  convertToExcalidrawElements,
  exportToSvg,
  restore,
} from "@excalidraw/excalidraw";

/**
 * Excalidraw registers its bundled fonts with document.fonts lazily, on export.
 * Until that happens every family measures identically to the fallback, which
 * silently produces layouts that overflow once the real font is applied. So warm
 * the fonts with a throwaway export before the first measurement.
 */
const WARM_FAMILIES = [3, 5, 6, 8];
/** Printable ASCII — the floor of what any diagram measures. */
const BASE_CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");

let warmChars = new Set();
let styleEl = null;
let warmQueue = Promise.resolve();

/**
 * A warm completed but the faces did not verifiably apply. The name is a
 * string literal, not new.target.name: this file is minified into the page
 * bundle, and the minifier renames the class.
 */
class FontIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "FontIntegrityError";
  }
}

/**
 * Fixed string measured per family after every warm. Same-run comparison only:
 * a family whose width equals an explicit serif fallback stack's did not apply.
 * No golden widths — the real faces just have to differ from serif on this
 * string, which every Excalidraw family comfortably does.
 */
const SENTINEL = "Hamburgefonstiv 0123";

function sentinelWidth(ctx, stack) {
  ctx.font = `20px ${stack}`;
  return ctx.measureText(SENTINEL).width;
}

/**
 * One warm pass: export, attach the @font-face rules, load and probe the
 * faces. Nothing is committed until every step succeeds — a failure removes
 * the candidate style element and leaves `warmChars`/`styleEl` untouched, so
 * the next call re-warms from scratch instead of early-returning against a
 * poisoned session. That commit-after-success is the retry mechanism; there
 * is deliberately no in-place retry loop masking the root cause.
 */
async function warm(need) {
  const sample = [...need].join("");
  const svg = await exportToSvg({
    elements: convertToExcalidrawElements(
      WARM_FAMILIES.map((fontFamily, i) => ({
        type: "text",
        x: 0,
        y: i * 40,
        text: sample,
        fontSize: 20,
        fontFamily,
      })),
    ),
    appState: {},
    files: {},
  });
  const css = svg.outerHTML.match(/@font-face\s*{[^}]*}/g) ?? [];
  const before = new Set(document.fonts);
  const el = document.createElement("style");
  el.textContent = css.join("\n");
  document.head.appendChild(el);
  try {
    const families = [
      ...new Set(
        css
          .map((rule) => rule.match(/font-family:\s*([^;]+);/)?.[1]?.trim())
          .filter(Boolean)
          .map((f) => f.replace(/^["']|["']$/g, "")),
      ),
    ];
    if (families.length < WARM_FAMILIES.length) {
      throw new FontIntegrityError(
        `warm export yielded @font-face rules for [${families.join(", ")}] — ` +
          `${WARM_FAMILIES.length} families requested`,
      );
    }
    await Promise.all(
      families.map(async (f) => {
        let faces;
        try {
          faces = await document.fonts.load(`20px "${f}"`);
        } catch (err) {
          throw new FontIntegrityError(`font load rejected for "${f}": ${err?.message ?? err}`);
        }
        if (!faces.length) {
          throw new FontIntegrityError(`font load matched no faces for "${f}"`);
        }
      }),
    );
    // On a re-warm the family-level load above is satisfied by the previous
    // warm's faces, which say nothing about this warm's subsets — and the
    // set-level load only triggers faces whose unicode-range matches its
    // sample. So load this warm's own faces directly: exactly the entries
    // document.fonts gained when `el` was attached.
    const fresh = [...document.fonts].filter((f) => !before.has(f));
    await Promise.all(
      fresh.map((f) =>
        f.load().catch((err) => {
          throw new FontIntegrityError(`face for "${f.family}" failed to load: ${err?.message ?? err}`);
        }),
      ),
    );
    await document.fonts.ready;

    // Probe against this warm's faces alone: the committed style element is
    // detached for the duration, so a stale face cannot vouch for a broken
    // fresh one. The window is synchronous — no await between detach and
    // commit/rollback — so a conversion in another call never observes it.
    styleEl?.remove();
    const ctx = document.createElement("canvas").getContext("2d");
    const fallback = sentinelWidth(ctx, "serif");
    const widths = families.map((f) => ({ family: f, width: sentinelWidth(ctx, `"${f}", serif`) }));
    const unapplied = widths.filter((w) => w.width === fallback);
    if (unapplied.length) {
      throw new FontIntegrityError(
        `fonts did not apply: ${unapplied.map((w) => `"${w.family}"`).join(", ")} ` +
          `(sentinel widths ${widths.map((w) => `${w.family}=${w.width}`).join(", ")}; ` +
          `serif fallback=${fallback})`,
      );
    }

    styleEl = el;
    warmChars = need;
    return { families, faces: css.length, glyphs: need.size };
  } catch (err) {
    // undo whatever this warm attached: drop the candidate, and reattach the
    // committed element if the failure happened inside the probe's detach
    // window — otherwise `styleEl` would sit set-but-disconnected and the
    // early return would vouch for faces that are no longer in the document
    el.remove();
    if (styleEl && !styleEl.isConnected) document.head.appendChild(styleEl);
    throw err;
  }
}

/**
 * exportToSvg inlines @font-face rules (base64 src) for the families it renders,
 * but never adds them to document.fonts — so canvas measurement silently falls
 * back to serif and every family measures identically. Worse, the rules it emits
 * are *subset to the glyphs actually rendered*, so warming with a short sample
 * leaves most characters falling back.
 *
 * Fix: warm with the union of every character we've been asked to measure, and
 * re-warm whenever a new one shows up. Measurement then matches what the exported
 * SVG will render, which is the whole point of measuring at all.
 *
 * Warms are serialized on a module-level promise chain: the page defends its
 * own invariant instead of trusting every driver to make one call at a time.
 * The glyph check runs inside the chain, after any in-flight warm has settled
 * and committed, so an early return always means the faces are truly applied.
 */
function ensureFonts(texts = []) {
  const run = warmQueue.then(() => {
    const need = new Set(warmChars);
    for (const c of BASE_CHARS) need.add(c);
    for (const t of texts) {
      for (const c of String(t)) {
        if (c !== "\n" && c !== "\r" && c !== "\t") need.add(c);
      }
    }
    if (styleEl && need.size === warmChars.size) return;
    return warm(need);
  });
  // a failed warm must not wedge the queue — the caller sees the rejection
  warmQueue = run.catch(() => {});
  return run;
}

/** Pull every string a skeleton will render, so fonts can be warmed for them. */
function skeletonTexts(skeleton) {
  const out = [];
  for (const el of skeleton ?? []) {
    if (typeof el?.text === "string") out.push(el.text);
    if (typeof el?.label?.text === "string") out.push(el.label.text);
  }
  return out;
}

/** Batch-measure text by converting text skeletons and reading back the sized elements. */
async function measureText(items) {
  await ensureFonts(items.map((i) => i.text));
  const els = convertToExcalidrawElements(
    items.map((it) => ({
      type: "text",
      x: 0,
      y: 0,
      text: it.text,
      fontSize: it.fontSize,
      fontFamily: it.fontFamily,
      ...(it.width ? { width: it.width } : {}),
    })),
  );
  return els.map((e) => ({ width: e.width, height: e.height }));
}

/**
 * Intrinsic size of an SVG, read from its own markup.
 *
 * An `<img>` is the wrong instrument here: a viewBox-only SVG has an intrinsic
 * *ratio* but no intrinsic size, so the element reports CSS's default 300x150 and
 * every such placement would be sized from a number the file never stated.
 * Width and height in absolute units win; otherwise the viewBox supplies both the
 * ratio and a sane pixel size. Neither present means the caller must say.
 */
async function svgSize(dataURL) {
  // fetch decodes the base64 and honours the charset, which atob does not
  const text = await (await fetch(dataURL)).text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (doc.querySelector("parsererror") || svg?.tagName !== "svg") {
    throw new Error("not parseable SVG markup");
  }
  // SVGLength.value resolves every absolute unit to px for us — in, cm, mm, pt,
  // pc as well as px and unitless. Viewport- and font-relative units state no
  // intrinsic size at all, so they are refused rather than resolved against a
  // viewport this detached document does not have.
  const RELATIVE = new Set([
    SVGLength.SVG_LENGTHTYPE_PERCENTAGE,
    SVGLength.SVG_LENGTHTYPE_EMS,
    SVGLength.SVG_LENGTHTYPE_EXS,
  ]);
  const px = (len) => (len && !RELATIVE.has(len.unitType) && len.value > 0 ? len.value : null);
  const width = px(svg.width?.baseVal);
  const height = px(svg.height?.baseVal);
  if (width && height) return { width, height };
  const box = svg.viewBox?.baseVal;
  if (box?.width > 0 && box?.height > 0) return { width: box.width, height: box.height };
  return null;
}

/**
 * Intrinsic size of image bytes, decoded by the same engine that will render
 * them — so any format Chrome can draw can be placed from one dimension.
 * Throws on bytes that cannot be decoded; returns null when the bytes decode but
 * state no size of their own.
 */
async function imageSize({ dataURL, mimeType }) {
  if (mimeType === "image/svg+xml") return svgSize(dataURL);
  const img = new Image();
  img.src = dataURL;
  await img.decode(); // EncodingError for bytes Chrome cannot read
  return img.naturalWidth > 0 && img.naturalHeight > 0
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : null;
}

async function exportSvg({ elements, appState, files, exportingFrame, exportPadding }) {
  const svg = await exportToSvg({
    elements,
    appState: {
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportWithDarkMode: false,
      ...appState,
    },
    files: files || {},
    // exportPadding is a top-level option of exportToSvg; inside appState it is ignored
    ...(exportPadding !== undefined ? { exportPadding } : {}),
    ...(exportingFrame ? { exportingFrame } : {}),
  });
  return {
    svg: svg.outerHTML,
    width: Number(svg.getAttribute("width")),
    height: Number(svg.getAttribute("height")),
  };
}

window.__ex = {
  convert: async (skeleton, opts) => {
    await ensureFonts(skeletonTexts(skeleton));
    return convertToExcalidrawElements(skeleton, opts ?? undefined);
  },
  fontStatus: () => ({
    registered: document.fonts.size,
    families: [...new Set([...document.fonts].map((f) => f.family))],
    glyphs: warmChars.size,
  }),
  measureText,
  imageSize,
  // refreshDimensions re-measures every text element, so the fonts must be
  // warmed for the document's glyphs first or the refreshed sizes come from
  // the fallback face — exactly the drift restore exists to remove
  restore: async (data, opts) => {
    await ensureFonts((data?.elements ?? []).map((e) => e?.text).filter((t) => typeof t === "string"));
    return restore(data, null, null, {
      refreshDimensions: true,
      repairBindings: true,
      ...opts,
    });
  },
  exportSvg,
};
window.__exReady = true;
