#!/usr/bin/env node
/**
 * Guards the grading harness's two pure seams — the sample merge
 * (bench/grade.js) and the score sheet (bench/score.js) — plus the one place
 * the judged rows are named.
 *
 * bench/grade.sh itself needs an API key and Chrome and is out of the gate, but
 * everything it does *after* the grader answers is arithmetic: majority per row,
 * split flags, and a markdown table. That half is where a silent wrong number
 * would come from, so it is pinned here, key-free and Chrome-free.
 *
 * The judged rows are the rubric's Tier A rows no advisory measures and no
 * layout primitive guarantees — Channel exactly `P`. The rubric's *text* is
 * never copied into bench/ (a frozen copy drifts from the shipped file); the
 * grader reads reference/rubric.md by path and only the row ids live in code.
 * So the invariant that keeps the ids honest is here: Tier A's advisory-free
 * rows must be exactly the Tier A ids bench/grade.js claims.
 *
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JUDGED_ROWS, extractJson, mergeSamples } from "../bench/grade.js";
import { renderScore } from "../bench/score.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// ── the judged rows against the rubric ───────────────────────────────────────

const rubric = readFileSync(join(root, "skills/excalidraw-diagram/reference/rubric.md"), "utf8");
const tierA = rubric.split(/^## /m).find((s) => s.startsWith("Tier A"));
const bodyRows = [...(tierA ?? "").matchAll(/^\|\s*(\d+)\s*\|(?:[^|]*\|){2}\s*([^|]*?)\s*\|/gm)];
const advisoryFree = bodyRows.filter(([, , channel]) => channel === "P").map(([, n]) => `A${n}`);

check("the rubric's Tier A table parses", bodyRows.length > 0, `${bodyRows.length} rows`);
check(
  "JUDGED_ROWS names exactly Tier A's advisory-free rows",
  JSON.stringify(JUDGED_ROWS.filter((r) => r.startsWith("A"))) === JSON.stringify(advisoryFree),
  `rubric ${advisoryFree.join(", ")} vs code ${JUDGED_ROWS.filter((r) => r.startsWith("A")).join(", ")}`,
);
check(
  "the judged set adds the focal assignment and the claim match",
  JUDGED_ROWS.includes("focal") && JUDGED_ROWS.includes("claim-match"),
  JUDGED_ROWS.join(", "),
);

// ── extractJson ──────────────────────────────────────────────────────────────

check("extractJson reads a bare object", extractJson('{"a":1}')?.a === 1);
check("extractJson reads a fenced object", extractJson('```json\n{"a":2}\n```')?.a === 2);
check(
  "extractJson reads an object buried in prose",
  extractJson('Here is my verdict.\n{"a":3, "b":{"c":"}"}}\ndone')?.b?.c === "}",
);
check("extractJson returns null on no object", extractJson("no json here") === null);
check("extractJson returns null on a broken object", extractJson("{ nope") === null);

// The failure the first live smoke run produced: a grader wrote multi-line evidence, so its
// outer object carried raw newlines inside a string and would not parse — while the nested
// object after `"rows":` parsed perfectly and carried no verdicts at all. Without the shape
// test that sample counts as a sample that voted on nothing, and a majority of three is
// silently decided by one.
const rawNewlines = '{"rows":{"A3":{"verdict":"pass","evidence":"first line\nsecond line"}},"tier_b":"one\ntwo"}';
const hasRows = (o) => o !== null && typeof o === "object" && typeof o.rows === "object" && o.rows !== null;

check("extractJson escapes raw newlines inside a string", extractJson(rawNewlines)?.rows?.A3?.verdict === "pass");
check(
  "extractJson keeps the newline as content, not as a break",
  extractJson(rawNewlines)?.tier_b === "one\ntwo",
  JSON.stringify(extractJson(rawNewlines)?.tier_b),
);
check(
  "a shape test rejects the nested object a broken outer one leaves behind",
  extractJson('{"rows":{"A3":{"verdict":"pass"}}}, and my notes: {"verdict":"pass"}', hasRows)?.rows?.A3?.verdict ===
    "pass",
);
check("a shape test rejects an object of the wrong shape outright", extractJson('{"verdict":"pass"}', hasRows) === null);
check(
  "an unterminated tail is closed rather than dropped",
  extractJson('{"rows":{"A3":{"verdict":"pass","evidence":"cut off', hasRows)?.rows?.A3?.evidence === "cut off",
);
check(
  "a shape test still finds the object it wants",
  extractJson('prose {"rows":{"A3":{"verdict":"fail"}},"tier_b":"x"} more', hasRows)?.rows?.A3?.verdict === "fail",
);

// ── mergeSamples ─────────────────────────────────────────────────────────────

const row = (verdict, evidence = "because") => ({ verdict, evidence });
const informed = (verdicts, tierB = "prose") =>
  JSON.stringify({
    rows: Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, row(v, `${k}:${v}`)])),
    tier_b: tierB,
  });

const records = (perSample) =>
  perSample.flatMap((s, i) => [
    { stage: "blind", sample: i + 1, result: s.claim, cost_usd: 0.01, exit: "success", model: "claude-opus-5" },
    { stage: "informed", sample: i + 1, result: s.informed, cost_usd: 0.02, exit: "success", model: "claude-opus-5" },
  ]);

const unanimous = mergeSamples(
  records([
    { claim: "one", informed: informed({ A3: "pass", A4: "fail", A7: "n-a", focal: "pass", "claim-match": "pass" }) },
    { claim: "two", informed: informed({ A3: "pass", A4: "fail", A7: "n-a", focal: "pass", "claim-match": "pass" }) },
    { claim: "three", informed: informed({ A3: "pass", A4: "fail", A7: "n-a", focal: "pass", "claim-match": "pass" }) },
  ]),
);

check("an unanimous row carries the shared verdict", unanimous.rows.A3.verdict === "pass");
check("an unanimous row is not split", unanimous.rows.A3.split === false);
check("every vote is kept with its evidence", unanimous.rows.A4.votes.length === 3 && unanimous.rows.A4.votes[0].evidence === "A4:fail");
check("all judged rows are merged", JSON.stringify(Object.keys(unanimous.rows)) === JSON.stringify(JUDGED_ROWS));
check("the blind claims are recorded verbatim, in order", JSON.stringify(unanimous.blind_claims) === '["one","two","three"]');
check("tier B prose is kept per sample", unanimous.tier_b.length === 3);
check("the cost is summed over both stages", Math.abs(unanimous.cost_usd - 0.09) < 1e-9, String(unanimous.cost_usd));
check("the grader model is recorded from the calls", unanimous.grader_model === "claude-opus-5");
check("the sample count is what answered", unanimous.samples === 3 && unanimous.failed_samples === 0);

const majority = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: informed({ A3: "fail", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "c", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
  ]),
);
check("a 2-1 row takes the majority verdict", majority.rows.A3.verdict === "pass");
check("a 2-1 row is flagged split", majority.rows.A3.split === true);
check("the rows that agreed stay unsplit", majority.rows.A4.split === false);

const threeWay = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: informed({ A3: "fail", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "c", informed: informed({ A3: "n-a", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
  ]),
);
check("a 1-1-1 row reaches no verdict", threeWay.rows.A3.verdict === null);
check("a 1-1-1 row is flagged split", threeWay.rows.A3.split === true);

const broken = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: "I could not answer." },
    { claim: "c", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
  ]),
);
check("an unparseable sample is counted, not fatal", broken.failed_samples === 1 && broken.samples === 2);
check("the surviving samples still merge", broken.rows.A3.verdict === "pass" && broken.rows.A3.votes.length === 2);
check("a sample that answered nothing does not split the row", broken.rows.A3.split === false);

const partial = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: JSON.stringify({ rows: { A3: row("pass") }, tier_b: "short" }) },
    { claim: "c", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
  ]),
);
check("a row only some samples scored merges those", partial.rows.A4.votes.length === 2 && partial.rows.A4.verdict === "pass");
check("a sample missing rows is not a failed sample", partial.failed_samples === 0);

const multiline = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: rawNewlines },
    { claim: "c", informed: informed({ A3: "fail", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
  ]),
);
check("a sample with raw newlines is recovered, not lost", multiline.samples === 3 && multiline.failed_samples === 0);
check("its vote counts toward the majority", multiline.rows.A3.votes.length === 3 && multiline.rows.A3.verdict === "pass");

// the live shape of the missing brace: `rows` never closed, so `tier_b` landed inside it
const lateClose =
  '{"rows":{"A3":{"verdict":"pass","evidence":"e"},"A4":{"verdict":"fail","evidence":"e"},' +
  '"tier_b":"the band item does not apply"}';
const nested = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: lateClose },
  ]),
);
check("a tail one brace short is closed and counted", nested.samples === 2 && nested.failed_samples === 0);
check("its verdicts vote", nested.rows.A3.votes.length === 2 && nested.rows.A4.split === true);
check("its tier B prose is lifted out of rows", nested.tier_b[1] === "the band item does not apply", nested.tier_b[1]);
check("tier_b is not scored as a row", nested.rows.tier_b === undefined);

const shapeless = mergeSamples(
  records([
    { claim: "a", informed: informed({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }) },
    { claim: "b", informed: '{"verdict":"pass","evidence":"I answered the wrong shape"}' },
  ]),
);
check("a sample carrying no rows at all is a failed sample", shapeless.samples === 1 && shapeless.failed_samples === 1);

const unknown = mergeSamples(
  records([{ claim: "a", informed: JSON.stringify({ rows: { A3: row("pass"), A99: row("fail") }, tier_b: "p" }) }]),
);
check("a row outside the judged set is dropped", unknown.rows.A99 === undefined);

// ── renderScore ──────────────────────────────────────────────────────────────

const grade = (verdicts, claim, tierB) => ({
  slug: "service-map",
  rubric_version: "0.12.1",
  grader_model: "claude-opus-5",
  blind_claims: [claim],
  tier_b: [tierB],
  rows: Object.fromEntries(
    Object.entries(verdicts).map(([k, v]) => [
      k,
      { verdict: Array.isArray(v) ? v[0] : v, split: Array.isArray(v), votes: [row(Array.isArray(v) ? v[0] : v, `${k} evidence`)] },
    ]),
  ),
});

const sheet = renderScore({
  before: "0.7.0",
  after: "0.12.1",
  rubricVersion: "0.12.1",
  graderModel: "claude-opus-5",
  briefs: [
    {
      slug: "service-map",
      gradeBefore: grade({ A3: "fail", A4: "pass", A7: ["pass"], focal: "pass", "claim-match": "fail" }, "a map of nothing", "cramped"),
      gradeAfter: grade({ A3: "pass", A4: "pass", A7: "pass", focal: "pass", "claim-match": "pass" }, "the checkout runtime", "reads well"),
      advisoriesBefore: [{ code: "arrows-cross" }, { code: "arrows-cross" }, { code: "font-below-floor" }],
      advisoriesAfter: [{ code: "font-below-floor" }],
    },
    { slug: "latency-chart", gradeBefore: null, gradeAfter: null, advisoriesBefore: [], advisoriesAfter: [] },
  ],
});

check("the sheet names both versions", sheet.includes("0.7.0") && sheet.includes("0.12.1"));
check("the sheet records the ruler and the instrument", sheet.includes("rubric 0.12.1") && sheet.includes("claude-opus-5"));
check("a moved judged row is marked", /\| A3 \| fail \| pass \|[^|]*\| → \|/.test(sheet));
check("a split verdict is marked", sheet.includes("split"));
check("measured advisory counts appear per code", /`arrows-cross`\s*\|\s*2\s*\|\s*0\s*\|/.test(sheet));
check("the blind claims are in the sheet", sheet.includes("the checkout runtime") && sheet.includes("a map of nothing"));
check("tier B prose is in the sheet", sheet.includes("reads well"));
check("a brief with no grade is named as ungraded", /latency-chart/.test(sheet) && /ungraded/i.test(sheet));
check("the sheet points at the rubric for what a row id means", sheet.includes("reference/rubric.md"));

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nthe grading seams hold");
process.exit(fail.length ? 1 : 0);
