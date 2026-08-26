# ADR-0002 — Advisories: the gate reports measurements in a fourth append-only namespace and never refuses over them

- **Status**: accepted
- **Date**: 2026-08-26
- **Context**: wayfinder map #183, ticket #192; rubric in #191

## Context

The rubric (#191) adopted twelve house rules, nine of which carry an **advisory**
channel: things a scene can be measured for — arrow–arrow crossings, aspect against
the preset, arrow clearance, hue count, node-size variance, centring, font floors,
stroke ladder — that today nobody measures. `CONTEXT.md` fixes the gate's stance:
"refusal is per problem, never taste." These measurements are not taste, but their
thresholds are house convention (#191 says "tune after the first scored run"), and a
rule whose number may move cannot refuse without turning every retune into a
breaking change to the exit code.

ADR-0001 froze the `--json` report shape and the problem-code namespace, and left
one door open: "problems carry no `severity` field because the gate has no warning
level … adding it later is append-only." This ADR is where that door is either
walked through or closed.

## Decision

The gate gains **advisories**: a fourth append-only code namespace beside the
element-level problems, the file-level errors and the fidelity ledger.

1. **Never refuses.** Exit codes (0/1/2, worst wins) and `GateError` are untouched;
   `ok` still means "no problems". A diagram with advisories passes.
2. **Own array, same entry shape.** `check.js --json` gains `advisories: [...]` per
   file beside `problems`, each entry `{ code, message, elements, ...fields }` as
   problems and ledger entries are. Every advisory carries the measured value
   **and** the bound it was judged against (the `low-contrast` `ratio`/`needs`
   pattern), so an agent revises against numbers without reading the registry. A
   per-panel finding names the frame first in `elements`; a whole-picture finding
   has an empty `elements`. No new `frame` or `severity` field.
3. **Human output on stdout**, after the stats line — `N advisories:` and one
   indented line each — because it is not a failure; problems keep stderr. The
   clean line becomes `clean — no mechanical defects, N advisories` so a
   scrolled-past list leaves a trace.
4. **Computed on every file that reaches the rules**, over the same well-formed
   live elements the refusing rules read, so one `check.js` shows everything to
   fix in one round; a refused file still gets its advisories.
5. **One reporting surface**: `check.js`. The computation lives in its own pure
   module (`adviseDocument(data) → advisories`), not in `verifyDocument`'s return,
   so `revise.js` or `authorDiagram` can adopt it later as an append-only addition.
   The skill makes running `check.js` after every write mandatory.
6. **No suppression, thresholds are constants.** No flag, no per-diagram opt-out,
   no per-code disable: an advisory never blocks, so the cost of a deliberate one
   is a line the author has already dispositioned, while a flag costs three
   CLIs' worth of docs and drawn bands. Thresholds are exported constants quoted
   in the registry and held equal by the sync test; a retune is a PR diff.
7. **Registry and tests.** `skills/excalidraw-diagram/reference/problem-codes.md`
   gains a fourth table under the same `live`/`deprecated` rules;
   `tests/problem-codes.js` extends to it (every emitted advisory code listed,
   every live row emitted, quoted thresholds equal to the constants); each code
   gets planted-scene fixtures in `test:fast`; and `check.js --json` over the
   committed baseline scenes (`bench/runs/<version>/`, landing in #196) is pinned
   as a snapshot — the advisories **are** the corpus score for the rubric's
   advisory-channel rules, so a changed measurement or retuned threshold shows
   as a diff.
8. **The skill consumes them twice**: as step-4 output each advisory is
   dispositioned "fixed or named as deliberate" — the clause step 5 already
   applies to defects — and the list is handed to the step-5 read-back subagent
   beside the PNGs, so the read-back confirms or dismisses each from the picture.
   Wording is the skill-workflow ticket's (#195); which codes ship first with what
   thresholds is #193's.

## Considered options

- **A `severity` field on problems** (ADR-0001's reserved option): rejected. It
  redefines `ok` and `problems.length`, which every consumer keys on today, and
  makes the refusal set ambiguous — a reader of `problems` can no longer tell
  what the exit code is about without filtering. The reservation is closed.
- **More `stats` keys**, the `outsideAll` route: rejected. A count carries no
  element ids, no bound and no `code`, so an agent cannot act on it or key
  machine handling off it.
- **Refusing above a threshold** (a real gate rule per house rule): rejected.
  Thresholds are house convention that will move; a moving refusal is a moving
  exit code, and `CONTEXT.md`'s "never taste" line would need to be redrawn each
  time.
- **Advisories only on a clean file**: rejected — it forces a second run per fix
  cycle for nothing.
- **A suppression flag**: rejected for the first change; see decision 6. It stays
  free to add later.

## Consequences

- The `--json` contract grows by one key per file; the exit-code contract and the
  26 problem codes are unchanged, so no consumer breaks.
- The registry becomes four tables and the sync test four namespaces; a new
  advisory rule cannot land without publishing its code and its threshold.
- The benchmark corpus is scored by the same measurement the author sees, so
  "better" for the advisory-channel rules is one number computed once — and the
  measured half of the review step is regression-tested by snapshot, leaving only
  the read-back prose as a taste question.
- `CONTEXT.md` gains **Advisory**, **Rubric** and **House rule**; *tier* stays the
  rubric's word, and "advisory tier" retires.
