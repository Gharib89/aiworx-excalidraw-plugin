// bench/metrics.js <run dir> <slug> — harvest one bench run's metrics.json from its transcript.
// Prints JSON to stdout. A gate round is any Bash result carrying a gate verdict — the author's
// write line or check.js's "clean" on a pass, a GateError / problem list on a refusal — since the
// gate runs inside every generator run, not only in check.js. The final gate is check.js --json
// on the committed scene, run here so it is independent of what the agent last saw.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [dir, slug] = process.argv.slice(2);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const lines = readFileSync(join(dir, "transcript.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

let model = null, result = null;
const bashCalls = new Set();
let passed = 0, refused = 0, deniedTools = 0;
for (const e of lines) {
  if (e.type === "system" && e.subtype === "init") model = e.model;
  if (e.type === "result") result = e;
  for (const c of e.message?.content ?? []) {
    if (c.type === "tool_use" && c.name === "Bash") bashCalls.add(c.id);
    if (c.type === "tool_result") {
      const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((p) => p.text ?? "").join("\n");
      if (bashCalls.has(c.tool_use_id)) {
        if (/refusing to write|\d+ problem\(s\)|"ok": false/.test(text)) refused++;
        else if (/\.excalidraw  \d+ elements, \d+ frames|clean — no mechanical defects|"ok": true/.test(text)) passed++;
      }
      if (c.is_error && /permission|not allowed|denied|requires approval/i.test(text)) deniedTools++;
    }
  }
}

const scene = join(dir, `${slug}.excalidraw`);
let finalGate = null;
if (existsSync(scene)) {
  try {
    finalGate = JSON.parse(execFileSync("node", [join(repo, "tools/check.js"), "--json", scene], { encoding: "utf8" })).files[0];
  } catch (err) {
    finalGate = JSON.parse(err.stdout).files[0];
  }
  delete finalGate.file;
}

console.log(JSON.stringify({
  slug,
  plugin_version: JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version,
  model,
  cli_version: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim().split(" ")[0],
  date: new Date().toISOString().slice(0, 10),
  cost_usd: result?.total_cost_usd ?? null,
  turns: result?.num_turns ?? null,
  duration_s: result ? Math.round(result.duration_ms / 1000) : null,
  exit: result?.subtype ?? "no result event",
  gate_rounds: passed + refused,
  refused_rounds: refused,
  denied_tool_calls: deniedTools,
  scene_written: existsSync(scene),
  svg_rendered: existsSync(join(dir, `${slug}.svg`)),
  final_gate: finalGate,
}, null, 2));
