/**
 * Headless-Chromium driver. Uses playwright-core against the system Chrome, so
 * there is no browser download; set CHROME_PATH to override the executable.
 *
 * All Excalidraw work happens inside the page (see tools/page.js). Node only
 * shuttles JSON in and files out. Anything that goes wrong browser-side is
 * rethrown as a named Node error carrying the page's console output — a
 * generic 30-second timeout tells the caller nothing.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expectedFingerprint, stampedFingerprint } from "./fingerprint.js";
import { NamedError } from "./errors.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(root, "dist/excalidraw-page.js");

/** The committed bundle does not match the current sources. */
export class StaleBundleError extends NamedError {}
/** The bundle loaded but never signalled ready. */
export class BundleLoadError extends NamedError {}
/** A call into the page threw. */
export class PageError extends NamedError {}
/** Nothing in the search order produced a running browser. */
export class ChromeLaunchError extends NamedError {}

export const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Launch the system Chrome. CHROME_PATH, if set, is the only place looked;
 * otherwise Playwright's "chrome" channel goes first and the paths above
 * follow.
 *
 * The channel carries the per-OS knowledge this file used to hard-code for
 * Linux alone — it knows where Chrome installs itself on macOS and Windows
 * too. The paths stay behind it because the channel finds Google Chrome and
 * nothing else, so a machine with only Chromium still works.
 *
 * A launch fails for reasons other than absence, so each failure falls through
 * to the next candidate and they are reported together if none survives: "no
 * Chrome" and "Chrome is installed but won't start" need the same trail. Only
 * the first line of each is kept — the rest is Playwright offering to download
 * a browser, which is exactly what this plugin exists not to do.
 */
async function launchChrome(options) {
  const override = process.env.CHROME_PATH;
  const asPath = (executablePath) => ({ executablePath });
  const present = CHROME_CANDIDATES.filter((p) => existsSync(p));
  const plan = override ? [asPath(override)] : [{ channel: "chrome" }, ...present.map(asPath)];

  const failures = [];
  for (const where of plan) {
    try {
      return await chromium.launch({ ...options, ...where });
    } catch (err) {
      failures.push(`  ${where.channel ?? where.executablePath}: ${err.message.split("\n")[0]}`);
    }
  }
  const absent = override ? [] : CHROME_CANDIDATES.filter((p) => !present.includes(p));
  throw new ChromeLaunchError(
    `No Chrome/Chromium could be launched. Tried:\n${failures.join("\n")}\n` +
      (absent.length ? `Nothing installed at: ${absent.join(", ")}.\n` : "") +
      `Set CHROME_PATH to a Chrome or Chromium executable.`,
  );
}

function assertFreshBundle() {
  if (!existsSync(BUNDLE)) {
    throw new StaleBundleError(`Bundle missing at ${BUNDLE}. Run: npm run bundle`);
  }
  const expected = expectedFingerprint();
  const stamped = stampedFingerprint(BUNDLE);
  if (stamped !== expected) {
    throw new StaleBundleError(
      `dist/excalidraw-page.js is stale: it was built from different sources ` +
        `(stamped ${stamped ?? "no fingerprint"}, current sources ${expected}). Run: npm run bundle`,
    );
  }
}

/**
 * Open a page with the Excalidraw bundle loaded and hand it to `fn`.
 * The returned api mirrors window.__ex, marshalled over page.evaluate.
 */
export async function withExcalidraw(fn, { scale = 2 } = {}) {
  assertFreshBundle();
  const browser = await launchChrome({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
  });
  try {
    const context = await browser.newContext({ deviceScaleFactor: scale });
    const page = await context.newPage();

    const pageIssues = [];
    page.on("pageerror", (e) => pageIssues.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") pageIssues.push(`console.error: ${m.text()}`);
    });
    const withIssues = (msg) =>
      pageIssues.length ? `${msg}\nthe page reported:\n  ${pageIssues.join("\n  ")}` : msg;
    const guard = async (label, thunk) => {
      try {
        return await thunk();
      } catch (err) {
        throw new PageError(withIssues(`${label} failed in the page: ${err.message}`));
      }
    };

    // A bundle that throws on load would otherwise sit out the full timeout;
    // racing the ready flag against the first pageerror fails immediately and
    // names the actual exception. Registered before the script is injected —
    // the throw happens synchronously during evaluation.
    let rejectLoad;
    const loadFailed = new Promise((_, rej) => (rejectLoad = rej));
    loadFailed.catch(() => {});
    const onLoadError = (e) =>
      rejectLoad(new BundleLoadError(withIssues(`the bundle threw while loading: ${e.message}`)));
    page.on("pageerror", onLoadError);
    await page.goto("about:blank");
    await page.addScriptTag({ path: BUNDLE });
    try {
      await Promise.race([
        page.waitForFunction("window.__exReady === true", { timeout: 30_000 }),
        loadFailed,
      ]);
    } catch (err) {
      if (err instanceof BundleLoadError) throw err;
      throw new BundleLoadError(
        withIssues(`bundle loaded but never signalled ready: ${err.message}`),
      );
    } finally {
      page.off("pageerror", onLoadError);
    }

    const api = {
      page,
      convert: (skeleton, opts) =>
        guard("convert", () =>
          page.evaluate(([s, o]) => window.__ex.convert(s, o), [skeleton, opts ?? null]),
        ),
      measureText: (items) =>
        guard("measureText", () => page.evaluate((i) => window.__ex.measureText(i), items)),
      imageSize: (file) =>
        guard("imageSize", () => page.evaluate((f) => window.__ex.imageSize(f), file)),
      restore: (data, opts) =>
        guard("restore", () =>
          page.evaluate(([d, o]) => window.__ex.restore(d, o), [data, opts ?? null]),
        ),
      exportSvg: (args) =>
        guard("exportSvg", () => page.evaluate((a) => window.__ex.exportSvg(a), args)),
      fontStatus: () => guard("fontStatus", () => page.evaluate(() => window.__ex.fontStatus())),
      /**
       * Rasterise an SVG string by rendering it in a throwaway iframe and
       * screenshotting the iframe.
       *
       * Isolation is the point, twice over. page.setContent would rewrite the
       * document and drop the warmed @font-face rules; mounting the SVG in the
       * live document is no better, because the SVG carries its own @font-face
       * rules subset to *its* glyphs, and once Chrome has seen those the canvas
       * measures against them even after the node is removed. Either way,
       * measurement after rasterisation silently drifts — the font-loss bug this
       * pipeline exists to prevent. An iframe has its own document and font set,
       * so the page that measures never sees the raster's fonts at all.
       */
      svgToPng: (svg, outPath) =>
        guard("svgToPng", async () => {
          const iframeHandle = await page.evaluateHandle((svgText) => {
            // template content is inert: sizes are readable, styles don't apply
            const tpl = document.createElement("template");
            tpl.innerHTML = svgText;
            const svgEl = tpl.content.querySelector("svg");
            if (!svgEl) return null;
            const iframe = document.createElement("iframe");
            iframe.style.cssText =
              `position:fixed;left:0;top:0;border:0;` +
              `width:${svgEl.getAttribute("width")}px;height:${svgEl.getAttribute("height")}px`;
            document.body.appendChild(iframe);
            const doc = iframe.contentDocument;
            doc.open();
            doc.write(`<!doctype html><body style="margin:0;background:#fff">${svgText}</body>`);
            doc.close();
            return iframe;
          }, svg);
          try {
            const iframe = iframeHandle.asElement();
            if (!iframe) throw new Error("input contained no <svg> element");
            const frame = await iframe.contentFrame();
            await frame.evaluate(() => document.fonts.ready);
            await iframe.screenshot({ path: outPath });
            return outPath;
          } finally {
            if (iframeHandle.asElement()) await iframeHandle.evaluate((el) => el.remove());
            await iframeHandle.dispose();
          }
        }),
    };
    return await fn(api);
  } finally {
    await browser.close();
  }
}
