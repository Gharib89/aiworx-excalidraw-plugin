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

/**
 * Two slips a grader's JSON actually arrives with, both cheap to repair and
 * both worth repairing: a lost sample is a vote missing from a majority of
 * three. Raw newlines inside a string are escaped in place, and a tail that
 * closed one container too few is closed — two of the first smoke run's three
 * samples ended one `}` short of balanced, with everything before it intact.
 * Nothing else is repaired: a sample this cannot parse is a failed sample.
 */
const repairs = (text) => {
  let escaped = "";
  const stack = [];
  let inString = false;
  let backslash = false;
  for (const ch of text) {
    if (backslash) {
      escaped += ch;
      backslash = false;
      continue;
    }
    if (ch === "\\") {
      escaped += ch;
      backslash = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      escaped += ch;
      continue;
    }
    if (inString) {
      if (ch < " ") escaped += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : "";
      else escaped += ch;
      continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    escaped += ch;
  }
  const closed = escaped + (inString ? '"' : "") + stack.reverse().join("");
  return closed === text ? [] : [escaped, closed];
};

/**
 * A grader answers in prose around its JSON as often as not; find the object.
 * `isValid` is the shape the caller is actually after, and it is load-bearing:
 * an unparseable outer object leaves a *nested* one that parses perfectly and
 * carries none of the verdicts, so without a shape test a broken sample counts
 * as a sample that voted on nothing — a majority of three silently decided by
 * one, reported as zero failures. Rejected candidates fall through to the next,
 * and a sample nothing matches is a failed sample.
 */
export const extractJson = (text, isValid = () => true) => {
  const body = String(text ?? "").replace(/```[a-z]*\n?/gi, "");
  const accept = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return isValid(parsed) ? { parsed } : null;
    } catch {
      return null;
    }
  };
  for (let i = body.indexOf("{"); i !== -1; i = body.indexOf("{", i + 1)) {
    // widest first, so a truncated tail is repaired rather than a complete fragment
    // inside it being preferred; last of all, the tail with no closing brace at all
    const slices = [];
    for (let j = body.lastIndexOf("}"); j > i; j = body.lastIndexOf("}", j - 1)) slices.push(body.slice(i, j + 1));
    slices.push(body.slice(i));
    for (const slice of slices) {
      for (const candidate of [slice, ...repairs(slice)]) {
        const hit = accept(candidate);
        if (hit) return hit.parsed;
      }
    }
  }
  return null;
};

/** The shape an informed sample must have to be counted at all. */
const isVerdict = (o) => o !== null && typeof o === "object" && typeof o.rows === "object" && o.rows !== null;

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
    const parsed = extractJson(record.result, isVerdict);
    if (parsed === null) failed++;
    else scored.push(parsed);
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
    // a grader that closed `rows` one brace too late wrote `tier_b` inside it — the
    // balance repair puts the object back together, but a step lower than intended
    tier_b: scored.map((s) => String(s.tier_b ?? s.rows?.tier_b ?? "").trim()),
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
  console.log(
    JSON.stringify(
      {
        slug,
        run_version: runVersion,
        rubric_version: rubricVersion,
        cli_version: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim().split(" ")[0],
        date: new Date().toISOString().slice(0, 10),
        frames,
        ...mergeSamples(records),
      },
      null,
      2,
    ),
  );
}
