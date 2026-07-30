#!/usr/bin/env node
/**
 * Path-handling suite for the worked example. A plugin install path is chosen by
 * the user, not by us: it may contain spaces, and on Windows it starts with a
 * drive letter. Both survive `node:url` and neither survives `URL.pathname`, so:
 *
 *   1. the example generator produces its diagram from a checkout path
 *      containing a space
 *   2. no `URL.pathname` is used as a filesystem path in the examples or in the
 *      skill's docs templates — the form that leaves `%20` in a path with a
 *      space and yields `/C:/…` on Windows
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

// ---- 1. the generator runs from a checkout path containing a space ----
{
  // A copy, not the checkout: the generator writes next to its own script, and
  // the committed example is regenerated deliberately, not by the test suite.
  const checkout = join(mkdtempSync(join(tmpdir(), "example-paths-")), "space test");
  mkdirSync(join(checkout, "examples"), { recursive: true });
  for (const dir of ["tools", "brand"]) symlinkSync(join(root, dir), join(checkout, dir));
  for (const f of ["gen-example.js", "stick-figure.excalidrawlib"]) {
    copyFileSync(join(root, "examples", f), join(checkout, "examples", f));
  }
  console.log(`checkout: ${checkout}`);

  const run = spawnSync(process.execPath, ["examples/gen-example.js"], {
    cwd: checkout,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: checkout },
    encoding: "utf8",
  });
  const out = join(checkout, "examples", "example.excalidraw");
  check("the generator exits clean from a path with a space", run.status === 0,
    run.status === 0 ? "" : `exit ${run.status}: ${String(run.stderr).split("\n").filter(Boolean).slice(-1)[0]}`);
  check("the diagram lands next to the generator", existsSync(out), out);
  if (existsSync(out)) {
    const doc = JSON.parse(readFileSync(out, "utf8"));
    check("the image travels in the files dictionary",
      Object.keys(doc.files ?? {}).length === 1,
      `${Object.keys(doc.files ?? {}).length} file(s)`);
  }
}

// ---- 2. no URL.pathname as a filesystem path ----
{
  const sources = [
    "examples/gen-example.js",
    "skills/excalidraw-diagram/SKILL.md",
    "skills/excalidraw-diagram/reference/authoring.md",
    "skills/excalidraw-diagram/reference/palette.md",
    "skills/excalidraw-diagram/reference/patterns.md",
    "skills/excalidraw-diagram/reference/anti-patterns.md",
  ];
  // the shape, `new URL(…).pathname`, not the name — the prose above names it too
  const offenders = sources.filter((f) => /\)\s*\.pathname/.test(readFileSync(join(root, f), "utf8")));
  check("no URL.pathname in the example or the docs templates",
    offenders.length === 0, offenders.join(", ") || `${sources.length} files clean`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
