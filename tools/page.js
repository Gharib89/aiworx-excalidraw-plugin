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
let warming = null;

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
 */
async function ensureFonts(texts = []) {
  const need = new Set(warmChars);
  for (const c of BASE_CHARS) need.add(c);
  for (const t of texts) {
    for (const c of String(t)) {
      if (c !== "\n" && c !== "\r" && c !== "\t") need.add(c);
    }
  }
  if (styleEl && need.size === warmChars.size) return;

  warmChars = need;
  const sample = [...need].join("");
  warming = (async () => {
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
    styleEl?.remove();
    styleEl = document.createElement("style");
    styleEl.textContent = css.join("\n");
    document.head.appendChild(styleEl);

    const families = [
      ...new Set(
        css
          .map((rule) => rule.match(/font-family:\s*([^;]+);/)?.[1]?.trim())
          .filter(Boolean)
          .map((f) => f.replace(/^["']|["']$/g, "")),
      ),
    ];
    await Promise.all(
      families.map((f) => document.fonts.load(`20px "${f}"`).catch(() => {})),
    );
    await document.fonts.ready;
    return { families, faces: css.length, glyphs: warmChars.size };
  })();
  return warming;
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
  convert: async (skeleton) => {
    await ensureFonts(skeletonTexts(skeleton));
    return convertToExcalidrawElements(skeleton);
  },
  fontStatus: () => ({
    registered: document.fonts.size,
    families: [...new Set([...document.fonts].map((f) => f.family))],
    glyphs: warmChars.size,
  }),
  measureText,
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
