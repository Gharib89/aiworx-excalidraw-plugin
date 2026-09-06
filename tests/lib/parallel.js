#!/usr/bin/env node
/**
 * Run gate steps concurrently. `test:browser` is Chrome-launch-bound — each
 * suite spends its time on independent browser launches, not CPU — so running
 * the suites side by side cuts the target to its longest suite. Each step's
 * output is held back and printed as one block when it finishes, so the log
 * reads like the sequential chain did.
 *
 *   node tests/lib/parallel.js "node tests/a.js" "node tests/b.js" "npm run smoke"
 *
 * Steps are dispatched in the order given — put the longest first so it never
 * starts last. Exits non-zero if any step did. Lives under tests/lib/ so the
 * tests/ suite scan (tests/test-targets.js) does not read it as a suite.
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";

const steps = process.argv.slice(2);
if (steps.length === 0) {
  console.error("usage: parallel.js <step> [<step> ...]");
  process.exit(2);
}
// A Chrome launch is a few hundred MB and a couple of cores for a moment; four
// at once fits every CI runner in the matrix. Measured on an 8-core box: 4
// workers 147s, 3 workers 165s, 2 workers 162s, sequential 360s.
const workers = Math.max(1, Math.min(4, availableParallelism()));

const runStep = (step) =>
  new Promise((resolve) => {
    const started = Date.now();
    // `node …` steps run on this very binary so a step sees the Node that ran
    // the target; anything else (`npm run …`) goes through the shell, which is
    // what resolves npm's shim on Windows.
    const [cmd, ...args] = step.split(/\s+/);
    const child =
      cmd === "node"
        ? spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] })
        : spawn(step, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ step, code: 1, out: `${out}\n${err.message}`, started }));
    child.on("close", (code, signal) => resolve({ step, code: code ?? 1, signal, out, started }));
  });

const failed = [];
let next = 0;
const worker = async () => {
  while (next < steps.length) {
    const r = await runStep(steps[next++]);
    const secs = ((Date.now() - r.started) / 1000).toFixed(1);
    const verdict = r.code === 0 ? "ok" : `exit ${r.signal ?? r.code}`;
    console.log(`\n==== ${r.step}  (${secs}s, ${verdict})\n${r.out.trimEnd()}`);
    if (r.code !== 0) failed.push(r.step);
  }
};
await Promise.all(Array.from({ length: workers }, worker));

console.log(
  failed.length
    ? `\n${failed.length} STEP(S) FAILED: ${failed.join(", ")}`
    : `\nall ${steps.length} steps passed (${workers} workers)`,
);
process.exit(failed.length ? 1 : 0);
