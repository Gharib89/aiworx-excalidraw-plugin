#!/usr/bin/env node
/**
 * The corpus score: `check.js --json --preset <brief's preset>` over every
 * committed baseline scene under bench/runs/, pinned as a snapshot
 * (bench/runs/<version>/advisories.json). The advisories *are* the score for
 * the rubric's advisory-channel rules (ADR-0002 §7), so a changed measurement
 * or a retuned threshold shows here as a diff, and never lands unnoticed.
 *
 * Messages are left out of the snapshot: they carry no contract and may be
 * reworded freely. Codes, elements and every measured field are held.
 *
 *   node tests/advisories-baseline.js            # compare
 *   node tests/advisories-baseline.js --update   # rewrite the snapshots from the current measurement
 *
 * Exits non-zero on any mismatch.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "tools/check.js");
const runs = join(root, "bench/runs");
const update = process.argv.includes("--update");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// the brief's surface, from its frontmatter — the one place the preset is stated
// a retired brief keeps its runs, so a missing prompt.md is a failed check, not a crash
const presetOf = (slug) => {
  const brief = join(root, "bench", slug, "prompt.md");
  return existsSync(brief) ? readFileSync(brief, "utf8").match(/^preset:\s*(\S+)/m)?.[1] : undefined;
};

const strip = ({ message, ...rest }) => rest;

for (const version of readdirSync(runs).sort()) {
  const dir = join(runs, version);
  const scored = {};
  for (const slug of readdirSync(dir).sort()) {
    const scene = join(dir, slug, `${slug}.excalidraw`);
    if (!existsSync(scene)) continue;
    const preset = presetOf(slug);
    check(`${version}/${slug}: the brief names a preset`, preset !== undefined);
    const r = spawnSync(process.execPath, [gate, "--json", ...(preset ? ["--preset", preset] : []), scene], { encoding: "utf8" });
    const file = JSON.parse(r.stdout).files[0];
    check(`${version}/${slug}: the scene reaches the rules`, file.error === undefined, JSON.stringify(file.error));
    scored[slug] = file.advisories.map(strip);
  }
  const snapshot = join(dir, "advisories.json");
  if (update) {
    writeFileSync(snapshot, JSON.stringify(scored, null, 2) + "\n");
    console.log(`wrote ${snapshot}`);
    continue;
  }
  const pinned = existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) : null;
  check(`${version}: a snapshot is committed`, pinned !== null, `run node tests/advisories-baseline.js --update`);
  if (!pinned) continue;
  for (const slug of new Set([...Object.keys(pinned), ...Object.keys(scored)])) {
    const want = JSON.stringify(pinned[slug] ?? null);
    const got = JSON.stringify(scored[slug] ?? null);
    const count = (list) => (list ? list.reduce((c, a) => ({ ...c, [a.code]: (c[a.code] ?? 0) + 1 }), {}) : null);
    check(
      `${version}/${slug}: the advisories match the snapshot`,
      want === got,
      want === got ? JSON.stringify(count(scored[slug])) : `pinned ${JSON.stringify(count(pinned[slug]))}, measured ${JSON.stringify(count(scored[slug]))} — a retune reruns --update`,
    );
  }
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nthe baseline scores as pinned");
process.exit(fail.length ? 1 : 0);
