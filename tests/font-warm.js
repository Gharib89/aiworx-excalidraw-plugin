#!/usr/bin/env node
/**
 * Font warm integrity suite (issue #48). A warm that fails must be loud and
 * leave no trace, and concurrent measurements must never see a half-warm page:
 *
 *   1. a warm whose font loads reject throws FontIntegrityError naming the
 *      family, leaves warm state untouched, and the next call re-warms from
 *      scratch instead of early-returning against the fallback face
 *   2. a load that resolves zero faces is the same integrity failure
 *   3. a *re-warm* whose fresh faces fail to load is caught even though the
 *      previous warm's faces still satisfy every family-level check — the
 *      poisoned-session class from issue #38
 *   4. two concurrent measure calls racing a re-warm both get real-face
 *      widths — the in-page mutex, not the driver, serializes the warm
 *
 * Realness is judged the way the probe judges it: with the real faces applied,
 * different families measure the same string differently and a settled page
 * reproduces the width; the fallback face collapses families to one width.
 * No golden widths.
 */
import { withExcalidraw } from "../tools/browser.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};
const namesAFamily = (msg) => /Excalifont|Nunito|Comic Shanns|Cascadia/i.test(msg ?? "");

const ITEMS = [
  { text: "integrity probe", fontSize: 20, fontFamily: 5 },
  { text: "integrity probe", fontSize: 20, fontFamily: 8 },
];
/** Outside printable ASCII, so measuring it forces a re-warm on a warm page. */
const ACCENTED = [
  { text: "résumé naïve façade", fontSize: 20, fontFamily: 5 },
  { text: "résumé naïve façade", fontSize: 20, fontFamily: 8 },
];

// ---- 1. rejected load: loud, named, state untouched, next call recovers ----
// ---- 3. rejected *re-warm*: fresh faces judged on their own, old state kept ----
await withExcalidraw(async (ex) => {
  const r = await ex.page.evaluate(async (items) => {
    const real = document.fonts.load.bind(document.fonts);
    document.fonts.load = () => Promise.reject(new Error("stubbed network loss"));
    let caught = null;
    try {
      await window.__ex.measureText(items);
    } catch (e) {
      caught = { name: e.name, message: e.message };
    }
    const after = window.__ex.fontStatus();
    document.fonts.load = real;
    return { caught, glyphsAfterFailure: after.glyphs };
  }, ITEMS);

  check("rejected load: throws", r.caught !== null);
  check("rejected load: names FontIntegrityError", r.caught?.name === "FontIntegrityError",
    r.caught?.name);
  check("rejected load: names a family", namesAFamily(r.caught?.message),
    r.caught?.message?.slice(0, 120));
  check("rejected load: leaves warm state untouched", r.glyphsAfterFailure === 0,
    `glyphs=${r.glyphsAfterFailure}`);

  // recovery: the same call re-warms from scratch and measures real faces
  const [w5, w8] = await ex.measureText(ITEMS);
  check("after failure: next call re-warms and measures", w5.width > 0 && w8.width > 0,
    `widths ${w5.width}, ${w8.width}`);
  check("after failure: families measure as themselves, not the fallback",
    Math.abs(w5.width - w8.width) > 0.5, `family5=${w5.width} family8=${w8.width}`);

  // the page is now legitimately warm — break only the *fresh* faces of the
  // next warm. Family-level loads still succeed via the committed faces, so
  // only a check that judges this warm's own faces can catch it.
  const rewarm = await ex.page.evaluate(async (items) => {
    const glyphsBefore = window.__ex.fontStatus().glyphs;
    const realLoad = FontFace.prototype.load;
    FontFace.prototype.load = function () {
      return Promise.reject(new Error("stubbed subset corruption"));
    };
    let caught = null;
    try {
      await window.__ex.measureText(items);
    } catch (e) {
      caught = { name: e.name, message: e.message };
    }
    const glyphsAfter = window.__ex.fontStatus().glyphs;
    FontFace.prototype.load = realLoad;
    return { caught, glyphsBefore, glyphsAfter };
  }, ACCENTED);

  check("poisoned re-warm: throws despite healthy committed faces",
    rewarm.caught?.name === "FontIntegrityError", rewarm.caught?.name ?? "did not throw");
  check("poisoned re-warm: names a family", namesAFamily(rewarm.caught?.message),
    rewarm.caught?.message?.slice(0, 120));
  check("poisoned re-warm: committed state survives",
    rewarm.glyphsAfter === rewarm.glyphsBefore && rewarm.glyphsBefore > 0,
    `before=${rewarm.glyphsBefore} after=${rewarm.glyphsAfter}`);

  const [a5, a8] = await ex.measureText(ACCENTED);
  check("after poisoned re-warm: next call re-warms the new glyphs",
    Math.abs(a5.width - a8.width) > 0.5, `family5=${a5.width} family8=${a8.width}`);
});

// ---- 2. a load that resolves zero faces is an integrity failure too ----
await withExcalidraw(async (ex) => {
  const r = await ex.page.evaluate(async (items) => {
    document.fonts.load = () => Promise.resolve([]);
    try {
      await window.__ex.measureText(items);
      return { caught: null };
    } catch (e) {
      return { caught: { name: e.name, message: e.message } };
    }
  }, ITEMS);
  check("zero faces: names FontIntegrityError", r.caught?.name === "FontIntegrityError",
    r.caught?.name ?? "did not throw");
  check("zero faces: names a family", namesAFamily(r.caught?.message),
    r.caught?.message?.slice(0, 120));
});

// ---- 4. concurrent measures racing a re-warm: both see real faces ----
// The page is warmed first: the historical bug needed a committed styleEl plus
// a re-warm in flight — the second caller then early-returned mid-warm and
// measured the new glyphs with the fallback face. A cold page never hits that
// path, so seeding the warm is what makes this test able to fail.
await withExcalidraw(async (ex) => {
  await ex.measureText(ITEMS);
  const r = await ex.page.evaluate(async (items) => {
    const [a, b] = await Promise.all([
      window.__ex.measureText(items),
      window.__ex.measureText(items),
    ]);
    const settled = await window.__ex.measureText(items);
    return { a, b, settled };
  }, ACCENTED);

  const distinct = (m) => Math.abs(m[0].width - m[1].width) > 0.5;
  check("concurrent re-warm: first caller gets real-face widths", distinct(r.a),
    `family5=${r.a[0].width} family8=${r.a[1].width}`);
  check("concurrent re-warm: second caller gets real-face widths", distinct(r.b),
    `family5=${r.b[0].width} family8=${r.b[1].width}`);
  const agrees = (m) =>
    m.every((x, i) => Math.abs(x.width - r.settled[i].width) < 0.01);
  check("concurrent re-warm: both agree with the settled page", agrees(r.a) && agrees(r.b),
    JSON.stringify({ a: r.a, b: r.b, settled: r.settled }));
});

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nfont warm is honest");
process.exit(fail.length ? 1 : 0);
