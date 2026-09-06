/**
 * bench/score.js <before> <after> [--rubric-version V]
 *   — generate bench/runs/<after>/score.md: the judged rows from each brief's
 *     grade and the measured rows from the advisory snapshot, both versions side
 *     by side. Without it a reviewer opens twelve JSON files.
 *
 * A comparison is valid only when both sides were graded under **one ruler**, so
 * the grades are selected by rubric version — `grade-<rubric-version>.json` on
 * each side — and a file whose recorded `rubric_version` disagrees with its own
 * name is refused rather than averaged in.
 *
 * The measured half comes from `runs/<version>/advisories.json`, which
 * tests/advisories-baseline.js re-pins from the current check.js over every
 * committed scene. That keeps the measured half on one ruler too: a run's own
 * metrics.json recorded whatever check.js existed the day it ran, so comparing
 * two of those compares two different measurements. A version with no snapshot
 * falls back to its metrics.json `final_gate.advisories`.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUBRIC_LINK = "skills/excalidraw-diagram/reference/rubric.md";

/**
 * `*` is disagreement among the samples that scored the row. `!` is a row fewer
 * samples scored than answered at all — a repaired truncation can carry a valid
 * `rows` object with later rows missing, and a "majority" of one is not one.
 */
const cell = (row, samples) => {
  if (row === undefined) return "—";
  const undervoted = samples !== undefined && row.votes.length < samples;
  return `${row.verdict ?? "—"}${row.split ? "*" : ""}${undervoted ? "!" : ""}`;
};
/**
 * The evidence is a grader's free prose in a table cell, and score.md is committed: a `|` in
 * it would end the cell early and a newline would end the row. Both are folded in rather
 * than dropped, because what the grader saw is the column's whole point.
 */
const clip = (text, n = 90) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const cut = flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
  return cut.replace(/\|/g, "\\|");
};
/** A row that reached no verdict has no majority evidence, and one dissent printed beside the
 *  blank would read as support for a verdict nobody reached. */
const evidenceOf = (row) =>
  row?.verdict ? (row.votes.find((v) => v.verdict === row.verdict)?.evidence ?? "") : "";
const counts = (advisories) =>
  (advisories ?? []).reduce((t, a) => ({ ...t, [a.code]: (t[a.code] ?? 0) + 1 }), {});

export const renderScore = ({ before, after, rubricVersion, graderModel, briefs }) => {
  const out = [
    `# Corpus score — ${before} → ${after}`,
    "",
    `Judged rows graded under **rubric ${rubricVersion}** by **${graderModel ?? "an unrecorded grader"}**, ` +
      "three samples per brief, majority per row. Measured rows are `check.js` advisory counts over the " +
      "same committed scenes. Both halves are one ruler across both versions; the scenes are frozen, so " +
      "either side re-grades without a new authoring run.",
    "",
    `Row ids are the rubric's Tier A numbers (\`${RUBRIC_LINK}\`) — \`focal\` is rule 11's focal ` +
      "assignment and `claim-match` asks whether the blind reader's claim is what the brief asked for. " +
      "`*` marks a **split**: the verdict is a majority, not agreement. `!` marks a row fewer samples " +
      "scored than answered, so its majority is thinner than it looks. `→` marks a row that moved.",
    "",
    "## Judged",
    "",
    `| brief | row | ${before} | ${after} | evidence (${after}) | |`,
    "|---|---|---|---|---|---|",
  ];

  for (const { slug, gradeBefore, gradeAfter } of briefs) {
    if (!gradeBefore && !gradeAfter) {
      out.push(`| ${slug} | — | *ungraded* | *ungraded* | | |`);
      continue;
    }
    const ids = [...new Set([...Object.keys(gradeBefore?.rows ?? {}), ...Object.keys(gradeAfter?.rows ?? {})])];
    for (const id of ids) {
      const b = gradeBefore?.rows?.[id];
      const a = gradeAfter?.rows?.[id];
      const moved = b && a && b.verdict !== a.verdict ? "→" : "";
      out.push(
        `| ${slug} | ${id} | ${cell(b, gradeBefore?.samples)} | ${cell(a, gradeAfter?.samples)} | ` +
          `${clip(evidenceOf(a))} | ${moved} |`,
      );
    }
  }

  out.push("", "## Measured", "", `| brief | advisory | ${before} | ${after} |`, "|---|---|---|---|");
  for (const { slug, advisoriesBefore, advisoriesAfter } of briefs) {
    const b = counts(advisoriesBefore);
    const a = counts(advisoriesAfter);
    const codes = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    if (codes.length === 0) out.push(`| ${slug} | *none* | 0 | 0 |`);
    for (const code of codes) out.push(`| ${slug} | \`${code}\` | ${b[code] ?? 0} | ${a[code] ?? 0} |`);
  }

  out.push("", "## Claims and Tier B", "");
  for (const { slug, gradeBefore, gradeAfter } of briefs) {
    out.push(`### ${slug}`, "");
    if (!gradeBefore && !gradeAfter) {
      out.push("*ungraded*", "");
      continue;
    }
    for (const [version, grade] of [
      [before, gradeBefore],
      [after, gradeAfter],
    ]) {
      if (!grade) {
        out.push(`**${version}** — *ungraded*`, "");
        continue;
      }
      out.push(`**${version}** — blind claims:`, "");
      for (const claim of grade.blind_claims) out.push(`- ${claim}`);
      out.push("", `**${version}** — Tier B:`, "");
      for (const prose of grade.tier_b) out.push(`- ${prose}`);
      out.push("");
    }
  }

  return `${out.join("\n").trimEnd()}\n`;
};

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const args = process.argv.slice(2);
  const positional = [];
  let rubricFlag;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rubric-version") rubricFlag = args[++i];
    else positional.push(args[i]);
  }
  const [before, after] = positional;
  const rubricVersion = rubricFlag ?? JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  if (!before || !after) {
    console.error("usage: score.js <before> <after> [--rubric-version V]");
    process.exit(2);
  }

  const runs = join(repo, "bench/runs");
  const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  const slugsOf = (version) =>
    existsSync(join(runs, version))
      ? readdirSync(join(runs, version)).filter((s) => existsSync(join(runs, version, s, `${s}.excalidraw`)))
      : [];
  const gradeOf = (version, slug) => {
    const grade = readJson(join(runs, version, slug, `grade-${rubricVersion}.json`));
    if (grade && grade.rubric_version !== rubricVersion) {
      console.error(`${version}/${slug}: grade-${rubricVersion}.json records rubric ${grade.rubric_version} — refusing to mix rulers`);
      process.exit(1);
    }
    return grade;
  };
  const advisoriesOf = (version, slug) => {
    const snapshot = readJson(join(runs, version, "advisories.json"));
    if (snapshot?.[slug]) return snapshot[slug];
    return readJson(join(runs, version, slug, "metrics.json"))?.final_gate?.advisories ?? [];
  };

  const briefs = [...new Set([...slugsOf(before), ...slugsOf(after)])].sort().map((slug) => ({
    slug,
    gradeBefore: gradeOf(before, slug),
    gradeAfter: gradeOf(after, slug),
    advisoriesBefore: advisoriesOf(before, slug),
    advisoriesAfter: advisoriesOf(after, slug),
  }));

  const sheet = renderScore({
    before,
    after,
    rubricVersion,
    graderModel: briefs.map((b) => b.gradeAfter ?? b.gradeBefore).find(Boolean)?.grader_model,
    briefs,
  });
  const path = join(runs, after, "score.md");
  writeFileSync(path, sheet);
  console.log(`wrote ${path}  (${briefs.filter((b) => b.gradeAfter).length}/${briefs.length} briefs graded at ${after})`);
}
