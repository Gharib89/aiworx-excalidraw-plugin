/**
 * bench/grade.js <samples.jsonl> <slug> <run-version> <rubric-version> [frame.png ...]
 *   — merge one brief's grader samples into a grade. Prints JSON to stdout.
 *
 * The samples file is what bench/grade.sh appends as it calls the grader: one
 * JSON line per call, `stage` "blind" or "informed", `sample` 1-based. This file
 * is everything that happens *after* the grader answers — majority per row and
 * the split flags — so it is pure arithmetic and pinned by tests/bench-grade.js.
 *
 * Three samples of an identical prompt, majority per row. A 2-1 records
 * `split: true` rather than being smoothed away: a row that splits repeatedly is
 * a rubric stated too vaguely to check, which is a finding about the rubric. A
 * 1-1-1 reaches no verdict at all (`null`, still split) — there is no majority
 * to report and inventing one would hide exactly that finding.
 *
 * Only row ids live here, never the rubric's text: a frozen copy of the rules
 * under bench/ drifts from the shipped reference/rubric.md, so the grader is
 * handed that file by path and told which rows to score by number.
 */
import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * The rows a grader scores — the judged half, which by definition is what the
 * advisories do not measure. `A3`, `A4` and `A7` are the Tier A rows whose
 * channel is skill prose alone (tests/bench-grade.js holds that against
 * rubric.md); `focal` is rule 11's focal assignment, which the stroke-ladder
 * advisory cannot check because it measures the widths, not which element
 * deserves the top one; `claim-match` asks whether the blind reader's claim is
 * what the brief asked for — the corpus's only measure of whether the picture
 * communicates rather than merely complies.
 */
export const JUDGED_ROWS = ["A3", "A4", "A7", "focal", "claim-match"];

const VERDICTS = new Set(["pass", "fail", "n-a"]);

/** The shape an informed sample must have to be counted at all. */
export const isVerdict = (o) => o !== null && typeof o === "object" && typeof o.rows === "object" && o.rows !== null;

const verdictOf = (cell) => {
  const raw = String(cell?.verdict ?? "").trim().toLowerCase();
  const normalized = raw === "na" || raw === "n/a" ? "n-a" : raw;
  return VERDICTS.has(normalized) ? normalized : null;
};

export const mergeSamples = (records) => {
  const bySample = (stage) =>
    records.filter((r) => r.stage === stage).sort((a, b) => (a.sample ?? 0) - (b.sample ?? 0));

  const scored = [];
  let failed = 0;
  for (const record of bySample("informed")) {
    // `result` is the CLI's schema-validated object, or whatever a failed call left behind
    if (isVerdict(record.result)) scored.push(record.result);
    else failed++;
  }

  const rows = {};
  for (const id of JUDGED_ROWS) {
    const votes = [];
    for (const sample of scored) {
      const cell = sample.rows?.[id];
      const verdict = verdictOf(cell);
      if (verdict !== null) votes.push({ verdict, evidence: String(cell.evidence ?? "").trim() });
    }
    const tally = votes.reduce((t, v) => ({ ...t, [v.verdict]: (t[v.verdict] ?? 0) + 1 }), {});
    const top = Math.max(0, ...Object.values(tally));
    const leaders = Object.keys(tally).filter((v) => tally[v] === top);
    rows[id] = {
      verdict: leaders.length === 1 ? leaders[0] : null,
      split: leaders.length > 1 || Object.keys(tally).length > 1,
      votes,
    };
  }

  return {
    grader_model: records.find((r) => r.model)?.model ?? null,
    samples: scored.length,
    failed_samples: failed,
    cost_usd: records.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0),
    blind_claims: bySample("blind").map((r) => String(r.result ?? "").trim()),
    rows,
    tier_b: scored.map((s) => String(s.tier_b ?? "").trim()),
  };
};

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const [file, slug, runVersion, rubricVersion, ...frames] = process.argv.slice(2);
  if (!file || !slug || !runVersion || !rubricVersion) {
    console.error("usage: grade.js <samples.jsonl> <slug> <run-version> <rubric-version> [frame.png ...]");
    process.exit(2);
  }
  const records = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const merged = mergeSamples(records);
  // A grader that answered nothing at all would otherwise be written out as a grade of every
  // row `null` — a dead instrument recorded as a verdict, and committed as one.
  if (merged.samples === 0) {
    console.error(`${slug}: no sample was scorable (${merged.failed_samples} failed) — no grade`);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        slug,
        run_version: runVersion,
        rubric_version: rubricVersion,
        cli_version: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim().split(" ")[0],
        date: new Date().toISOString().slice(0, 10),
        frames,
        ...merged,
      },
      null,
      2,
    ),
  );
}
