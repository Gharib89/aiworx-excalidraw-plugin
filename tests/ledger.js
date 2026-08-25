#!/usr/bin/env node
/**
 * Contract suite for the fidelity ledger (tools/ledger.js).
 *
 * The ledger is what revise says out loud about the repairs it made: recomputed
 * text metrics, repaired bindings and frame membership, re-centered bound
 * labels, dropped elements, pruned image payloads. It is a pure diff of the
 * document that went in against the one written out, which is what lets this
 * suite run with no browser: the round-trip that produces the "after" is
 * covered by tests/revise-cli.js.
 *
 * Exits non-zero on any mismatch.
 */
import { buildLedger, formatLedger } from "../tools/ledger.js";

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

const text = (id, over = {}) => ({
  id, type: "text", x: 0, y: 0, width: 100, height: 25, text: "hi", ...over,
});
const codes = (entries) => entries.map((e) => e.code);
const byCode = (entries, code) => entries.find((e) => e.code === code);

// ---- a pass that changed nothing has nothing to report ----
{
  const before = { elements: [text("t1")], files: {} };
  const after = { elements: [text("t1")], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("an unchanged round-trip reports no entries", entries.length === 0, codes(entries).join(", "));
  const lines = formatLedger(entries);
  check("the empty ledger still says so in one line", lines.length === 1, JSON.stringify(lines));
  check("the empty line names no repairs", /no repairs/.test(lines[0]), lines[0]);
}

// ---- text metrics: the measured box the real fonts produced ----
{
  const before = { elements: [text("t1"), text("t2")], files: {} };
  const after = { elements: [text("t1", { width: 140 }), text("t2", { height: 50 })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("a remeasured text box is reported", codes(entries).includes("text-metrics-recomputed"), codes(entries).join(", "));
  const e = byCode(entries, "text-metrics-recomputed");
  check("every remeasured element is named", JSON.stringify(e?.elements) === '["t1","t2"]', JSON.stringify(e?.elements));
  check("the metrics line counts them", /2 elements? \(t1, t2\)/.test(e?.message ?? ""), e?.message);
}

// Re-measuring the same label under the same font can shift it by a rounding
// error, and that is not a repair anyone made — the same half-pixel floor the
// bound-label re-centre check uses.
{
  const before = { elements: [text("t1")], files: {} };
  const after = { elements: [text("t1", { width: 100.4, height: 25.3 })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("a sub-pixel remeasure is not a repair", entries.length === 0, codes(entries).join(", "));
}

// A hand-written text often carries no box at all, or a broken one. The pass
// measures it for the first time, which is the loudest metrics event there is —
// a subtraction against a missing number must not swallow it.
{
  const unmeasured = { id: "t1", type: "text", x: 0, y: 0, text: "hi" };
  for (const [name, was] of [
    ["absent", unmeasured],
    ["NaN", { ...unmeasured, width: NaN, height: NaN }],
  ]) {
    const { entries } = buildLedger({
      before: { elements: [was], files: {} },
      after: { elements: [text("t1")], files: {} },
      recentered: [],
    });
    check(`a first measurement over ${name} metrics is reported`,
      codes(entries).includes("text-metrics-recomputed"), codes(entries).join(", "));
  }
}

// ---- bindings: restore drops what points at nothing and syncs the back-references ----
{
  const arrow = (over = {}) => ({ id: "a1", type: "arrow", x: 0, y: 0, width: 10, height: 0, ...over });
  const before = { elements: [arrow({ startBinding: { elementId: "gone", focus: 0, gap: 1 } })], files: {} };
  const after = { elements: [arrow({ startBinding: null })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  const e = byCode(entries, "binding-repaired");
  check("a dropped dangling binding is reported", e !== undefined, codes(entries).join(", "));
  check("the repaired arrow is named", JSON.stringify(e?.elements) === '["a1"]', JSON.stringify(e?.elements));
}
{
  // The other half: a container that gained the back-reference restore repairs.
  const box = (over = {}) => ({ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10, ...over });
  const before = { elements: [box()], files: {} };
  const after = { elements: [box({ boundElements: [{ id: "a1", type: "arrow" }] })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("a repaired back-reference is reported",
    byCode(entries, "binding-repaired")?.elements[0] === "r1", codes(entries).join(", "));
}
{
  // A bound label's containerId is a binding like any other, and restore clears
  // one that points at nothing. Reported, or the pass silently unbinds a label.
  const before = { elements: [text("t1", { containerId: "gone" })], files: {} };
  const after = { elements: [text("t1", { containerId: null })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("a cleared containerId is a binding repair",
    byCode(entries, "binding-repaired")?.elements[0] === "t1", codes(entries).join(", "));

  const moved = buildLedger({
    before: { elements: [text("t1", { containerId: "r1" })], files: {} },
    after: { elements: [text("t1", { containerId: "r2" })], files: {} },
    recentered: [],
  });
  check("a re-pointed containerId is a binding repair",
    byCode(moved.entries, "binding-repaired")?.elements[0] === "t1", codes(moved.entries).join(", "));
}
{
  // A null in boundElements names no binding, so clearing one changes nothing a
  // binding points at — whether it sat alone or beside a real entry.
  const box = (over = {}) => ({ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10, ...over });
  for (const [name, was] of [
    ["alone", [null]],
    ["beside a real entry", [{ id: "a1", type: "arrow" }, null]],
  ]) {
    const { entries } = buildLedger({
      before: { elements: [box({ boundElements: was })], files: {} },
      after: { elements: [box({ boundElements: was.filter(Boolean) })], files: {} },
      recentered: [],
    });
    check(`a null boundElements entry cleared ${name} is not a binding repair`,
      entries.length === 0, codes(entries).join(", "));
  }
}
{
  // Focus and gap drift under re-measurement; only what a binding points at is
  // a repair worth a line.
  const arrow = (over = {}) => ({ id: "a1", type: "arrow", x: 0, y: 0, width: 10, height: 0, ...over });
  const before = { elements: [arrow({ endBinding: { elementId: "r1", focus: 0, gap: 1 } })], files: {} };
  const after = { elements: [arrow({ endBinding: { elementId: "r1", focus: 0.02, gap: 3.5 } })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("re-measured focus and gap are not a repair", entries.length === 0, codes(entries).join(", "));
}

// ---- frame membership: a hand edit leaves a stale frameId behind ----
{
  const before = { elements: [text("t1", { frameId: "f-old" })], files: {} };
  const after = { elements: [text("t1", { frameId: "f-new" })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  const e = byCode(entries, "frame-membership-repaired");
  check("a re-inferred frameId is reported", e !== undefined, codes(entries).join(", "));
  check("the move names both frames",
    JSON.stringify(e?.moves) === '[{"id":"t1","from":"f-old","to":"f-new"}]', JSON.stringify(e?.moves));
  check("the membership line reads as a move", /t1: f-old → f-new/.test(e?.message ?? ""), e?.message);
}
{
  // Cleared membership: absent and null are the same state, so neither is a move.
  const before = { elements: [text("t1", { frameId: "f-old" })], files: {} };
  const after = { elements: [text("t1", { frameId: null })], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  check("cleared membership names no destination",
    /t1: f-old → none/.test(byCode(entries, "frame-membership-repaired")?.message ?? ""),
    byCode(entries, "frame-membership-repaired")?.message);

  const quiet = buildLedger({
    before: { elements: [text("t1")], files: {} },
    after: { elements: [text("t1", { frameId: null })], files: {} },
    recentered: [],
  });
  check("an absent frameId and a null one are the same state", quiet.entries.length === 0,
    codes(quiet.entries).join(", "));
}

// ---- bound labels: reviseDiagram hands these over, restore has already moved them ----
{
  const before = { elements: [], files: {} };
  const after = { elements: [], files: {} };
  const recentered = [
    { id: "t-writes", containerId: "a-writes" },
    { id: "t-reads", containerId: "a-reads" },
  ];
  const { entries } = buildLedger({ before, after, recentered });
  const e = byCode(entries, "label-recentered");
  check("re-centered labels are reported", e !== undefined, codes(entries).join(", "));
  // The wording the CLI printed before the ledger existed — both ids, because
  // unbinding a label needs the label and its arrow.
  check("the label line names both ids",
    e?.message === "re-centered 2 bound labels (t-writes on a-writes, t-reads on a-reads)", e?.message);
  check("the labels carry their containers", JSON.stringify(e?.labels) === JSON.stringify(recentered),
    JSON.stringify(e?.labels));
}

// ---- dropped elements: a tombstone a revise purges is gone for good ----
{
  const before = {
    elements: [text("t1"), { id: "r1", type: "rectangle", x: 0, y: 0, width: 5, height: 5, isDeleted: true }],
    files: {},
  };
  const after = { elements: [text("t1")], files: {} };
  const { entries } = buildLedger({ before, after, recentered: [] });
  const e = byCode(entries, "element-dropped");
  check("a purged tombstone is reported", e !== undefined, codes(entries).join(", "));
  check("the dropped element carries its type",
    JSON.stringify(e?.dropped) === '[{"id":"r1","type":"rectangle"}]', JSON.stringify(e?.dropped));
  check("the drop line names id and type", /1 element \(r1 rectangle\)/.test(e?.message ?? ""), e?.message);
}

// ---- image payloads: the files dictionary is append-only, so an orphan is bytes forever ----
{
  const entry = (n) => ({ mimeType: "image/png", id: "f1", dataURL: `data:image/png;base64,${"A".repeat(n)}` });
  // Counted by hand rather than recomputed the way the code does, or the check
  // could never disagree with it. The entry is ASCII, so its serialized JSON is
  // the fixed 69-character envelope plus the base64 body:
  //   {"mimeType":"image/png","id":"f1","dataURL":"data:image/png;base64,…"}
  const ENVELOPE = 69;
  const before = { elements: [], files: { f1: entry(2000), f2: entry(10) } };
  const after = { elements: [], files: { f2: entry(10) } };
  const { entries } = buildLedger({ before, after, recentered: [] });
  const e = byCode(entries, "image-payload-dropped");
  check("an orphaned payload is reported", e !== undefined, codes(entries).join(", "));
  check("the payload names no element", JSON.stringify(e?.elements) === "[]", JSON.stringify(e?.elements));
  check("the payload carries its fileId and byte count",
    JSON.stringify(e?.payloads) === JSON.stringify([{ fileId: "f1", bytes: ENVELOPE + 2000 }]),
    JSON.stringify(e?.payloads));
  check("the payload line sizes the loss", /dropped 1 orphaned image payload, 2\.0 KB \(f1\)/.test(e?.message ?? ""),
    e?.message);

  // Two orphans: the total has to add them up, which one payload could never show.
  const both = buildLedger({
    before: { elements: [], files: { f1: entry(2000), f2: entry(10) } },
    after: { elements: [], files: {} },
    recentered: [],
  });
  const two = byCode(both.entries, "image-payload-dropped");
  check("the total is the sum of every payload dropped",
    two?.payloads.length === 2 && two.bytes === ENVELOPE * 2 + 2010,
    `${two?.bytes} from ${JSON.stringify(two?.payloads.map((p) => p.bytes))}`);
  check("the payload line pluralizes and names them all",
    /dropped 2 orphaned image payloads, 2\.1 KB \(f1, f2\)/.test(two?.message ?? ""), two?.message);
}

// A pass with nothing to prune must not claim it pruned nothing — an absent
// files dictionary on either side is not an event.
{
  const { entries } = buildLedger({
    before: { elements: [] },
    after: { elements: [] },
    recentered: [],
  });
  check("a document with no files dictionary reports nothing", entries.length === 0, codes(entries).join(", "));
}

// ---- the order is fixed, so the printed ledger reads the same way every run ----
{
  const before = {
    elements: [
      text("t1"),
      { id: "a1", type: "arrow", x: 0, y: 0, width: 10, height: 0, startBinding: { elementId: "gone" } },
      text("t2", { frameId: "f-old" }),
      { id: "r1", type: "rectangle", x: 0, y: 0, width: 5, height: 5, isDeleted: true },
    ],
    files: { f1: { id: "f1", dataURL: "data:image/png;base64,AAAA" } },
  };
  const after = {
    elements: [text("t1", { width: 140 }), { id: "a1", type: "arrow", x: 0, y: 0, width: 10, height: 0 }, text("t2")],
    files: {},
  };
  const { entries } = buildLedger({ before, after, recentered: [{ id: "t9", containerId: "a9" }] });
  check("every kind of repair is reported once", entries.length === 6, `${entries.length} entries`);
  check("the entries come out in a fixed order",
    codes(entries).join(",") === "text-metrics-recomputed,binding-repaired,frame-membership-repaired," +
      "label-recentered,element-dropped,image-payload-dropped",
    codes(entries).join(","));
  check("the formatted ledger is one line per entry", formatLedger(entries).length === 6,
    `${formatLedger(entries).length} lines`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nthe ledger reports what revise changed");
process.exit(fail.length ? 1 : 0);
