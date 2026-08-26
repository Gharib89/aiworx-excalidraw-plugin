#!/usr/bin/env bash
# bench/run.sh [slug ...] — render benchmark briefs headlessly into bench/runs/<version>/<slug>/.
# No slug = the whole corpus. Re-running a version overwrites its run (never a second directory).
#
# `claude plugin eval` is the intended runner; while it is early-access the same prompt.md
# drives `claude -p --plugin-dir` directly, so the briefs stay the single source of truth.
set -euo pipefail

BENCH=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$BENCH")
VERSION=$(node -p "require('$REPO/package.json').version")
SLUGS=("$@")
if [ ${#SLUGS[@]} -eq 0 ]; then
  SLUGS=(); for d in "$BENCH"/*/; do [ -f "$d/prompt.md" ] && SLUGS+=("$(basename "$d")"); done
fi

frontmatter() { sed -n '2,/^---$/{/^---$/!p}' "$1" | sed -n "s/^$2: *//p"; }
body() { sed '1,/^---$/d' "$1"; }

for slug in "${SLUGS[@]}"; do
  prompt="$BENCH/$slug/prompt.md"
  [ -f "$prompt" ] || { echo "no such brief: $slug" >&2; exit 2; }
  model=$(frontmatter "$prompt" model)
  max_turns=$(frontmatter "$prompt" max_turns)
  tools=$(frontmatter "$prompt" allowed_tools | tr -d '[]",')
  out="$BENCH/runs/$VERSION/$slug"
  scratch=$(mktemp -d)

  # The harness a real user's project would already have: the brand question answered
  # (house palette), and one fixed line saying where the scene goes. The brief proper
  # stays byte-identical.
  echo '{ "defaults": "accepted" }' > "$scratch/.excalidraw-brand.json"
  full_prompt="$(body "$prompt")

Write the diagram to $scratch/$slug.excalidraw."

  echo "▶ $slug  ($model, ≤$max_turns turns) → $out"
  rm -rf "$out" && mkdir -p "$out"
  # --setting-sources project from a scratch dir loads no user settings, so the only plugin
  # in the session is the one under test.
  (cd "$scratch" && claude -p "$full_prompt" \
      --plugin-dir "$REPO" --model "$model" --max-turns "$max_turns" \
      --allowedTools $tools \
      --output-format stream-json --verbose --no-session-persistence --setting-sources project \
      < /dev/null > "$out/transcript.jsonl" 2> "$out/stderr.log") || echo "  claude exited $? (see $out/stderr.log)" >&2

  if [ -f "$scratch/$slug.excalidraw" ]; then
    cp "$scratch/$slug.excalidraw" "$out/$slug.excalidraw"
    # The committed SVG is rendered here, not taken from the run, so every run's SVG comes
    # from the same command.
    node "$REPO/tools/render.js" --out "$out" --no-frames "$out/$slug.excalidraw" >/dev/null 2>>"$out/stderr.log" \
      || echo "  render refused the scene (see $out/stderr.log)" >&2
  else
    echo "  no scene written at $scratch/$slug.excalidraw" >&2
  fi
  node "$BENCH/metrics.js" "$out" "$slug" > "$out/metrics.json"
  rm -rf "$scratch"
  echo "  done: $(node -p "const m=require('$out/metrics.json');\`\$\${m.cost_usd?.toFixed(2)}, \${m.turns} turns, \${m.gate_rounds} gate rounds (\${m.refused_rounds} refused), final gate: \${m.final_gate?.ok ?? 'no scene'}\`")"
done
