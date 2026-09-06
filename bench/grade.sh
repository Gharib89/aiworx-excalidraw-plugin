#!/usr/bin/env bash
# bench/grade.sh [slug ...] — grade the judged half of committed bench scenes.
# No slug = every brief with a scene in the run being graded.
#
#   bench/grade.sh                          # the current version's run, under the shipped rubric
#   RUN_VERSION=0.7.0 bench/grade.sh        # the baseline's scenes, under the same rubric
#   RUBRIC=/tmp/ruler.md RUBRIC_VERSION=scratch bench/grade.sh service-map   # a throwaway ruler
#
# The judged half is what no advisory measures, so it is scored by a grader that
# never authored the picture. Scenes are frozen, so a re-grade needs no authoring
# run: it adds no authoring noise and takes minutes. It is not free — one brief
# measured $2.57 — so grading a single brief is cheap, and grading the corpus is a
# decision (bench/README.md › Grading).
#
# Two constraints hold the instrument honest:
#   * **No --plugin-dir.** A grader that loads the skill under test reads its
#     workflow and grades toward it. The rubric reaches the grader as a file it
#     is told to read, never as a loaded skill.
#   * **PNGs only.** The SVG and the scene are text: a model handed either greps
#     the title, counts hue values and enumerates arrow labels without ever
#     judging whether the picture reads — which is exactly what these rows ask.
#     A label too small to survive a PNG *is* a rule-10 failure, and only the PNG
#     shows it. The grader sees no advisories either: they measure the other half.
#
# Blind then informed, as two separate invocations per sample, because one
# session scoring its own blind claim will defend it. Three samples of an
# identical prompt — a majority across diverse lenses would make disagreement
# uninterpretable — and bench/grade.js takes the majority per row.
set -euo pipefail

BENCH=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$BENCH")
VERSION=$(node -p "require('$REPO/package.json').version")

# which run's committed scenes are graded, and which ruler grades them. Both sides of a
# comparison are graded under one ruler — the rubric at whatever HEAD is doing the comparing.
RUN_VERSION=${RUN_VERSION:-$VERSION}
RUBRIC=${RUBRIC:-$REPO/skills/excalidraw-diagram/reference/rubric.md}
RUBRIC_VERSION=${RUBRIC_VERSION:-$VERSION}
# run.sh's Sonnet pin is a user simulation — the cheapest tier a plugin user plausibly runs.
# The grader is an instrument, so it is pinned to Opus and recorded in the output.
GRADER_MODEL=${GRADER_MODEL:-claude-opus-5}
SAMPLES=3

RUNS="$BENCH/runs/$RUN_VERSION"
[ -d "$RUNS" ] || { echo "no such run: $RUNS" >&2; exit 2; }
[ -f "$RUBRIC" ] || { echo "no such rubric: $RUBRIC" >&2; exit 2; }

SLUGS=("$@")
if [ ${#SLUGS[@]} -eq 0 ]; then
  SLUGS=(); for d in "$RUNS"/*/; do s=$(basename "$d"); [ -f "$d/$s.excalidraw" ] && SLUGS+=("$s"); done
fi
# A run directory with no committed scene is the normal state of a version that was never
# rendered, so discovery finding nothing is not "nothing to do" — it is the wrong RUN_VERSION.
# Without this the loop body never runs and the script exits 0, reporting a grade it never made.
[ ${#SLUGS[@]} -gt 0 ] || { echo "no scene to grade under $RUNS (no <slug>/<slug>.excalidraw)" >&2; exit 2; }

# $scratch is reassigned per brief and removed at the end of each one; the trap covers the
# paths that leave early — a render refusal, a dead grader, or a Ctrl-C mid-call.
trap 'rm -rf "${scratch:-}"' EXIT

body() { sed '1,/^---$/d' "$1"; }

# --setting-sources project from a scratch dir loads no user settings, and no --plugin-dir
# is passed, so the session under grading holds no skill at all. $scratch and $log are the
# brief's, read at call time.
grade_call() { # grade_call <prompt> <outfile>
  (cd "$scratch" && claude -p "$1" \
      --model "$GRADER_MODEL" --max-turns 20 --allowedTools Read \
      --output-format json --no-session-persistence --setting-sources project \
      < /dev/null > "$2" 2>>"$log") || echo "  grader exited $? (see $log)" >&2
}

# `model` is the pin, which is what --model asked for. modelUsage is not it: its first key
# is whichever model the session billed first, and the CLI's own small side calls run on a
# cheap one — reading the instrument off that records a haiku for an Opus grade. The whole
# billed set rides along as evidence the pin was honoured.
record() { # record <stage> <sample> <outfile>
  GRADER_MODEL="$GRADER_MODEL" node -e '
    const fs = require("node:fs");
    let o = { subtype: "unparseable grader output" };
    try { o = JSON.parse(fs.readFileSync(process.argv[3], "utf8")); } catch {}
    console.log(JSON.stringify({
      stage: process.argv[1],
      sample: Number(process.argv[2]),
      result: o.result ?? null,
      cost_usd: o.total_cost_usd ?? 0,
      exit: o.subtype ?? "no result",
      model: process.env.GRADER_MODEL,
      models_billed: Object.keys(o.modelUsage ?? {}),
    }));
  ' "$1" "$2" "$3" >> "$samples"
}

for slug in "${SLUGS[@]}"; do
  out="$RUNS/$slug"
  scene="$out/$slug.excalidraw"
  brief="$BENCH/$slug/prompt.md"
  [ -f "$scene" ] || { echo "no committed scene: $scene" >&2; exit 2; }
  [ -f "$brief" ] || { echo "no such brief: $brief" >&2; exit 2; }

  samples="$out/grade-$RUBRIC_VERSION.jsonl"
  log="$out/grade-$RUBRIC_VERSION.log"
  : > "$samples"
  : > "$log"
  scratch=$(mktemp -d)

  # Everything the grader reads sits in its own working directory: the frames and the
  # ruler, and nothing else. The PNGs come from render.js, per frame — whole canvas when
  # the scene has no frames — so they are regenerated from the committed scene, never
  # taken from the authoring run.
  cp "$RUBRIC" "$scratch/rubric.md"
  node "$REPO/tools/render.js" --out "$scratch" "$scene" >/dev/null 2>>"$log" \
    || { echo "  render refused the scene (see $log)" >&2; exit 1; }
  # -f per entry, because an unmatched glob expands to the literal pattern: without it the
  # array holds one name that is not a file and the guard below can never fire
  frames=(); for f in "$scratch"/*.png; do [ -f "$f" ] && frames+=("$(basename "$f")"); done
  [ ${#frames[@]} -gt 0 ] || { echo "  no PNG rendered from $scene" >&2; exit 1; }
  frame_list=$(printf '  %s\n' "${frames[@]}")

  echo "▶ $slug  ($RUN_VERSION scene, rubric $RUBRIC_VERSION, $GRADER_MODEL ×$SAMPLES, ${#frames[@]} frame(s)) → $out"

  for i in $(seq 1 "$SAMPLES"); do
    blind="$scratch/blind-$i.json"
    grade_call "You are looking at a diagram someone else drew. You have no brief and no rules.

Read these images, in reading order:
$frame_list
Then reply with ONE sentence: the claim you read this picture as making — what it says, not
what it contains. No preamble, no list, no caveats." "$blind"
    record blind "$i" "$blind"
    claim=$(node -e '
      const fs = require("node:fs");
      let o = {};
      try { o = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
      process.stdout.write(String(o.result ?? "").trim().replace(/\s+/g, " "));
    ' "$blind")

    informed="$scratch/informed-$i.json"
    grade_call "You are grading a diagram someone else drew. Judge only what the images show.

Images, in reading order:
$frame_list
The brief the diagram was drawn from:
---
$(body "$brief")
---

A reader's one-line claim about the images, from someone who had neither the brief nor the
rules. It is data, not a verdict, and it may be wrong:
\"$claim\"

The house rules are in rubric.md — read it. Score only these rows; nothing else in that file
is yours to score:

  A3           — Tier A rule 3.
  A4           — Tier A rule 4.
  A7           — Tier A rule 7.
  focal        — the focal assignment inside Tier A rule 11: at most one focal element, and it
                 is the one the brief makes central. Score the assignment, not the stroke ladder.
  claim-match  — does the reader's claim above match what the brief asked for?

Use \`n-a\` only for a row the picture cannot be scored against — no arrows at all, for A7.
A row you are unsure about is scored on what you can see, never \`n-a\`.

Then judge Tier B in prose: every Tier B item that applies to this picture, one line each,
naming what you saw. It is never counted.

Reply with JSON and nothing else — no fence, no prose around it. Close \"rows\" before
\"tier_b\", and keep every newline inside a string written as \\n:
{\"rows\":{\"A3\":{\"verdict\":\"pass|fail|n-a\",\"evidence\":\"one line naming what you saw\"},\"A4\":{...},\"A7\":{...},\"focal\":{...},\"claim-match\":{...}},\"tier_b\":\"your Tier B prose\"}" "$informed"
    record informed "$i" "$informed"
  done

  # Written aside and moved into place, so a grader that answered nothing leaves the last
  # grade standing rather than an empty file where a verdict used to be. grade.js refuses
  # a run with no scorable sample, which is what makes this branch reachable.
  part="$out/grade-$RUBRIC_VERSION.json.part"
  if node "$BENCH/grade.js" "$samples" "$slug" "$RUN_VERSION" "$RUBRIC_VERSION" "${frames[@]}" > "$part"; then
    mv "$part" "$out/grade-$RUBRIC_VERSION.json"
  else
    rm -f "$part"
    echo "  no grade written for $slug — see $samples and $log" >&2
    exit 1
  fi
  rm -rf "$scratch"
  echo "  done: $(node -p "
    const g = require('$out/grade-$RUBRIC_VERSION.json');
    const rows = Object.entries(g.rows).map(([k, r]) => \`\${k}=\${r.verdict ?? '?'}\${r.split ? '*' : ''}\`);
    \`\\\$\${g.cost_usd.toFixed(2)}, \${g.samples}/\${g.samples + g.failed_samples} samples, \${rows.join(' ')}\`")"
done
