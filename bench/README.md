# Benchmark corpus

**Frozen.** Once a baseline run exists for a brief, its `prompt.md` body is never edited — a needed change is a new slug, and the old one is retired with a note here. Editing a brief in place silently invalidates every earlier run. The frontmatter is harness configuration (model, turns, tools, the brief's `preset`) and may move.

This directory holds the **benchmark corpus** (see `CONTEXT.md` › Benchmark): the fixed set of **briefs** every change to the skill or tools is judged on, before against after. It is not a plugin surface and not part of CI — a **bench run** is manual, local, needs an API key, Chrome, and roughly $10–20.

## Layout

```
bench/
  <slug>/prompt.md              # the brief, as a claude plugin eval case (frontmatter pins model, runs, max_turns, preset)
  run.sh                        # renders one brief or the whole corpus into runs/<version>/
  runs/<plugin-version>/<slug>/
      <slug>.excalidraw         # committed
      <slug>.svg                # committed
      metrics.json              # committed — model, CLI version, date, cost, turns, gate rounds, refusals by code, read-backs dispatched
      transcript.jsonl          # git-ignored
  runs/<plugin-version>/advisories.json   # committed — the corpus score: check.js --json --preset over every scene, messages dropped
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
