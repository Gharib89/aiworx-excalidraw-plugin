# Benchmark corpus

**Frozen.** Once a baseline run exists for a brief, its `prompt.md` body is never edited — a needed change is a new slug, and the old one is retired with a note here. Editing a brief in place silently invalidates every earlier run. The frontmatter is harness configuration (model, turns, tools, the brief's `preset`) and may move.

This directory holds the **benchmark corpus** (see `CONTEXT.md` › Benchmark): the fixed set of **briefs** every change to the skill or tools is judged on, before against after. It is not a plugin surface and not part of CI — a **bench run** is manual, local, needs an API key, Chrome, and roughly $10–20.

## Layout

```
bench/
  <slug>/prompt.md              # the brief, as a claude plugin eval case (frontmatter pins model, runs, max_turns, preset)
  run.sh                        # renders one brief or the whole corpus into runs/<version>/
  grade.sh                      # grades the judged half of a run's committed scenes
  grade.js, score.js            # the sample merge, and the score sheet a PR links
  runs/<plugin-version>/<slug>/
      <slug>.excalidraw         # committed
      <slug>.svg                # committed
      metrics.json              # committed — model, CLI version, date, cost, turns, gate rounds, refusals by code, read-backs dispatched
      grade-<rubric-version>.json    # committed — the judged half, scored under one ruler
      transcript.jsonl          # git-ignored
      grade-<rubric-version>.jsonl   # git-ignored — the grader's raw samples (.log is its stderr)
  runs/<plugin-version>/advisories.json   # committed — the corpus score: check.js --json --preset over every scene, messages dropped
  runs/<plugin-version>/score.md          # generated — judged and measured rows, before against after
```

`advisories.json` is the **advisory score** (ADR-0002 §7): the same measurement the author sees, pinned by `tests/advisories-baseline.js` in `test:fast`. A changed measurement or a retuned threshold fails that test and is re-pinned with `node tests/advisories-baseline.js --update` — the diff is the review.

No PNGs are committed — `node tools/render.js --out <dir> bench/runs/<version>/<slug>/<slug>.excalidraw` reproduces every frame from the scene; scorers re-render locally.

## The briefs

| slug | kind | preset | what it stresses |
|---|---|---|---|
| `service-map` | graph, small (9 nodes) | `doc-inline` | node sizing, labels, one cross-layer edge |
| `ingest-pipeline` | graph, layered with skips | `doc-wide` | layer-skipping edges |
| `deployment-boundaries` | architecture sketch with grouping | `doc-wide` | containers, trust boundaries, legend/title, one abstraction level |
| `auth-flow` | band | `slide-16x9` | panel count, rhythm, pattern variety; the slide type ramp |
| `latency-chart` | chart | `doc-inline` | data-to-scale, author owns every coordinate |
| `mermaid-runbook` | mermaid ingestion (13 nodes) | `doc-inline` | whether an ingested graph is held to the same rules |

A brief is a realistic paragraph a doc author would write — components, relationships, audience, target surface — and nothing about layout, pattern, colour or shape. Every brief gets the same one harness line appended at run time, naming where to write the scene; the brief proper stays byte-identical.

## Running

```bash
bench/run.sh                 # whole corpus at the current package.json version
bench/run.sh service-map     # one brief
```

Inputs pinned: brief text, model (Sonnet 5 — the cheapest tier a plugin user plausibly runs), plugin version, allowed tools. **One run per brief per version**; re-running the same version overwrites. Run-to-run noise is a known caveat: a score that changes between versions is re-run once before it counts.

The **baseline** is the run under the version the corpus was frozen at.

## Grading

`advisories.json` scores the rubric's measured half. The other half — Tier A's advisory-free rows, rule 11's focal assignment, and all of Tier B — is judgment, and a **grade** (`CONTEXT.md` › Benchmark) is one brief's verdict on it, from a grader that never authored the picture. Grading the authoring session's own read-back would be marking your own homework, and it reports nothing at all on a run that skipped the read-back.

```bash
bench/grade.sh                      # every brief in the current version's run
bench/grade.sh service-map          # one brief
RUN_VERSION=0.7.0 bench/grade.sh    # the baseline's committed scenes, same rubric
node bench/score.js 0.7.0 0.12.1    # write runs/0.12.1/score.md
```

The grader is handed **PNGs only** — re-rendered from the committed scene, per frame, whole canvas when frameless — and no advisories. The SVG and the scene are text: a model handed either greps the title, counts hue values and enumerates arrow labels without ever judging whether the picture reads, and a label too small to survive a PNG is a rule-10 failure only the PNG shows. Each sample runs twice: **blind** (the frames alone, name the claim you read) then **informed** (a fresh session given the frames, the brief, the rubric by path, and the blind claim *as data* — score the judged rows with a line of evidence each, judge Tier B in prose, and say whether that claim is what the brief asked for). Separate invocations, because a session scoring its own blind claim will defend it; and that claim-match row is the corpus's only measure of whether the picture communicates rather than merely complies.

Three samples of an identical prompt, majority per row. A 2-1 records `split: true` and is surfaced rather than smoothed: a row that splits repeatedly is a rubric stated too vaguely to check, which is a finding about the rubric. A 1-1-1 reaches no verdict at all.

The grader never loads the plugin — one that reads the skill under test grades toward its workflow — and its model is pinned to Opus 5 and recorded in the output. `run.sh`'s Sonnet pin is a *user simulation*, the cheapest tier a plugin user plausibly runs; the grader is an *instrument*. `RUN_VERSION`, `RUBRIC`, `RUBRIC_VERSION` and `GRADER_MODEL` override from the environment.

**What a grade costs.** Measured on `service-map`, one brief is **$2.57** — three samples over two stages, six calls. The corpus is six briefs, so a full re-grade lands in the same range as the $15 re-render it is meant to substitute for. The asymmetry that makes re-grading cheap is therefore not the dollar cost: it is that a re-grade needs **no authoring run**, so it adds no authoring noise, takes minutes rather than an hour a brief, and can be pointed at any version's frozen scenes at will. Grading one brief to check a claim is genuinely cheap; grading the whole corpus is a bench-run-sized decision.

### One ruler

A grade is a **pair** — scene version and rubric version — never a property of a bench run: `runs/0.7.0/service-map/grade-0.12.1.json` reads as *the 0.7.0 scene under 0.12.1's rubric*. There was no rubric at 0.7.0, so grading each run against "its own" rubric has nothing to grade the before with, and a frozen rubric copy under `bench/` would drift from the shipped file. Both sides are re-graded under **one ruler** instead — the rubric at whatever HEAD is doing the comparing — and a comparison is valid only when both sides share `rubric_version`. Scenes are frozen, so re-grading them needs no authoring run at all (see the cost note above), and naming the file for the pair means a later ruler never overwrites the number a shipped PR cited.

### Reading score.md

`node bench/score.js <before> <after>` writes `runs/<after>/score.md`: the judged rows from each side's grade, the measured rows from each side's `advisories.json`, and the blind claims and Tier B prose per brief. `*` marks a split — the verdict is a majority, not agreement — and `→` a row that moved. The measured half stays on one ruler too: those columns come from the snapshot the current `check.js` re-pins over every committed scene, not from what each run's `metrics.json` recorded on the day it ran.

### What counts as a regression: nothing, automatically

There is no corpus verdict. Grader noise dies to majority-of-three plus a free re-grade; **authoring noise does not** — the scene itself differs run to run and re-rendering is $15. Across six briefs, a corpus-wide threshold ("a rule regresses if it drops on two briefs") is false precision dressed as rigour.

So acceptance is stated **per implementation issue**: each names upfront which rows it claims and on which briefs they fail today, and the after-run's `score.md` either shows those rows moving or the issue did not do its job. Around that, the PR names **every** judged row that moved in either direction, re-grades before citing any move, and pays for a re-render only when a move is decision-changing and authoring noise is the suspect. A rule nobody claimed drifting on one brief is recorded, not litigated.

Grading is not part of CI — it needs an API key, and `bench/` is not a plugin surface. Everything downstream of the grader's answer is arithmetic (the majority, the split flags, the score sheet) and is pinned by `tests/bench-grade.js` in `test:fast`, which needs neither a key nor Chrome.
