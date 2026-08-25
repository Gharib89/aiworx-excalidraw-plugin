/**
 * The fidelity ledger: what a revise pass changed beyond what was asked.
 *
 * A round-trip through the pipeline is never byte-for-byte — it re-measures
 * text with the real fonts, repairs bindings and frame membership, re-centers
 * bound labels onto their arrows, and prunes image payloads no element points
 * at any more. All of that used to happen in silence, so the only way to learn
 * what a revise did was to diff JSON.
 *
 * This module is that diff: pure, browser-free, one entry per kind of repair.
 * `buildLedger` compares the document that went in against the one written out;
 * `formatLedger` turns the entries into the lines the CLI prints. The library
 * never prints — the CLI owns the output, which is what lets `--json` emit one
 * parseable document.
 *
 * The entry shape follows the gate's problem objects — `code`, `message`,
 * `elements`, plus the per-code fields — so a consumer parses the two the same
 * way. The codes are a public, append-only contract published in the shipped
 * skill's problem-codes reference and held to this file by
 * `tests/problem-codes.js`.
 */

/**
 * Half a pixel. Re-measuring the same string under the same font can move a box
 * by a rounding error, and that is not a repair anyone made — the same floor
 * reviseDiagram uses to decide a bound label really moved.
 */
export const METRIC_EPSILON = 0.5;

const list = (ids) => ids.join(", ");
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
/** `n elements (a, b)` — the count with the ids behind it, the shape every line shares. */
const named = (ids, noun = "element") => `${ids.length} ${plural(ids.length, noun)} (${list(ids)})`;

/** Human-readable byte size: the file loses this much, so KB is the useful unit. */
const bytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/**
 * The ledger for one revise pass.
 *
 * `before` is the parsed document as it was read, `after` the elements and
 * files actually written, and `recentered` the bound labels reviseDiagram saw
 * move — that one cannot be re-derived here, because restore has already moved
 * them by the time it returns.
 *
 * Entries come out in a fixed order so the printed ledger reads the same way
 * every run.
 */
export function buildLedger({ before, after, recentered = [] }) {
  const entries = [];
  const note = (code, message, elements = [], extra = {}) =>
    entries.push({ code, message, elements, ...extra });

  const wasById = new Map(
    (before.elements ?? [])
      .filter((e) => e && typeof e === "object" && e.id != null)
      .map((e) => [e.id, e]),
  );
  const now = after.elements ?? [];

  // A text whose measured box moved: the fonts, not the author, decided this.
  const remeasured = now
    .filter((e) => e.type === "text")
    .filter((e) => {
      const was = wasById.get(e.id);
      if (!was) return false;
      return (
        Math.abs(e.width - was.width) > METRIC_EPSILON ||
        Math.abs(e.height - was.height) > METRIC_EPSILON
      );
    })
    .map((e) => e.id);
  if (remeasured.length) {
    note("text-metrics-recomputed", `recomputed text metrics on ${named(remeasured)}`, remeasured);
  }

  // What a binding points at, not how it is aimed: focus and gap drift with
  // every re-measurement, and that drift is not a repair anyone needs told.
  const bindingShape = (e) => [
    e.startBinding?.elementId ?? null,
    e.endBinding?.elementId ?? null,
    (e.boundElements ?? []).map((b) => b?.id).sort().join("+"),
  ].join("|");
  const rebound = now
    .filter((e) => {
      const was = wasById.get(e.id);
      return was !== undefined && bindingShape(e) !== bindingShape(was);
    })
    .map((e) => e.id);
  if (rebound.length) {
    note("binding-repaired", `repaired bindings on ${named(rebound)}`, rebound);
  }

  // A hand edit that drags an element out of its frame leaves the old frameId
  // behind; the pass clears membership the geometry no longer supports and
  // re-infers it. Absent and null are one state — neither is a move.
  const frameOf = (e) => e.frameId ?? null;
  const moves = now.flatMap((e) => {
    const was = wasById.get(e.id);
    if (!was || frameOf(was) === frameOf(e)) return [];
    return [{ id: e.id, from: frameOf(was), to: frameOf(e) }];
  });
  if (moves.length) {
    note(
      "frame-membership-repaired",
      `repaired frame membership on ${moves.length} ${plural(moves.length, "element")} ` +
        `(${moves.map((m) => `${m.id}: ${m.from ?? "none"} → ${m.to ?? "none"}`).join(", ")})`,
      moves.map((m) => m.id),
      { moves },
    );
  }

  // Handed in rather than diffed: restore re-centers a bound label onto its
  // arrow's path on every pass — house behaviour (CONTEXT.md, **Bound label**) —
  // and has already moved it by the time reviseDiagram sees the result.
  if (recentered.length) {
    note(
      "label-recentered",
      `re-centered ${recentered.length} bound ${plural(recentered.length, "label")} ` +
        `(${recentered.map((r) => `${r.id} on ${r.containerId}`).join(", ")})`,
      recentered.map((r) => r.id),
      { labels: recentered },
    );
  }

  // An element the pass did not carry over — a tombstone it purged, or one the
  // converter could not keep. Excalidraw deletes by marking, so a purge is the
  // point of no return for an undo.
  const kept = new Set(now.map((e) => e.id));
  const dropped = [...wasById.values()]
    .filter((e) => !kept.has(e.id))
    .map((e) => ({ id: e.id, type: e.type ?? "unknown" }));
  if (dropped.length) {
    note(
      "element-dropped",
      `dropped ${dropped.length} ${plural(dropped.length, "element")} ` +
        `(${dropped.map((d) => `${d.id} ${d.type}`).join(", ")})`,
      dropped.map((d) => d.id),
      { dropped },
    );
  }

  // The files dictionary is append-only in the editor, so a payload no element
  // points at rides along in every future commit. `bytes` is what the file
  // actually loses — the serialized entry, data URL and all.
  const wasFiles = before.files ?? {};
  const nowFiles = after.files ?? {};
  const payloads = Object.keys(wasFiles)
    .filter((id) => !(id in nowFiles))
    .map((fileId) => ({ fileId, bytes: JSON.stringify(wasFiles[fileId]).length }));
  if (payloads.length) {
    const total = payloads.reduce((sum, p) => sum + p.bytes, 0);
    note(
      "image-payload-dropped",
      `dropped ${payloads.length} orphaned image ${plural(payloads.length, "payload")}, ${bytes(total)} ` +
        `(${payloads.map((p) => p.fileId).join(", ")})`,
      [],
      { payloads, bytes: total },
    );
  }

  return { entries };
}

/**
 * The lines the CLI prints for a ledger — one per entry, or a single line saying
 * so when a pass changed nothing the ledger tracks. Never silence: a quiet run
 * used to read exactly like a no-op.
 */
export function formatLedger(entries) {
  if (entries.length === 0) return ["no repairs — the file was already current"];
  return entries.map((e) => e.message);
}
