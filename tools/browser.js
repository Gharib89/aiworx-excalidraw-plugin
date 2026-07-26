/**
 * Headless-Chromium driver. Uses playwright-core against the system Chrome, so
 * there is no browser download; set CHROME_PATH to override the executable.
 *
 * All Excalidraw work happens inside the page (see tools/page.js). Node only
 * shuttles JSON in and files out.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(root, "dist/excalidraw-page.js");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function chromePath() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome/Chromium found. Tried: ${CHROME_CANDIDATES.join(", ")}. ` +
        `Set CHROME_PATH to the executable.`,
    );
  }
  return found;
}

/**
 * Open a page with the Excalidraw bundle loaded and hand it to `fn`.
 * The returned api mirrors window.__ex, marshalled over page.evaluate.
 */
export async function withExcalidraw(fn, { scale = 2 } = {}) {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Bundle missing at ${BUNDLE}. Run: npm run bundle`);
  }
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
  });
  try {
    const context = await browser.newContext({ deviceScaleFactor: scale });
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ path: BUNDLE });
    await page.waitForFunction("window.__exReady === true", { timeout: 30_000 });

    const api = {
      page,
      convert: (skeleton) =>
        page.evaluate((s) => window.__ex.convert(s), skeleton),
      measureText: (items) =>
        page.evaluate((i) => window.__ex.measureText(i), items),
      restore: (data, opts) =>
        page.evaluate(([d, o]) => window.__ex.restore(d, o), [data, opts ?? null]),
      exportSvg: (args) => page.evaluate((a) => window.__ex.exportSvg(a), args),
      fontStatus: () => page.evaluate(() => window.__ex.fontStatus()),
      /** Rasterise an SVG string by rendering it in the page and screenshotting it. */
      svgToPng: async (svg, outPath) => {
        await page.setContent(
          `<body style="margin:0;background:#fff">${svg}</body>`,
        );
        const el = await page.waitForSelector("svg", { timeout: 15_000 });
        await el.screenshot({ path: outPath });
        return outPath;
      },
    };
    return await fn(api);
  } finally {
    await browser.close();
  }
}
