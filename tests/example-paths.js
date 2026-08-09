#!/usr/bin/env node
/**
 * Path-handling suite for the worked example. A plugin install path is chosen by
 * the user, not by us: it may contain spaces, and on Windows it starts with a
 * drive letter. Both survive `node:url` and neither survives `URL.pathname`, so:
 *
 *   1. the example generator produces its diagram from a checkout path
 *      containing a space, given the plugin root either way it is documented —
 *      as the first argument, or in CLAUDE_PLUGIN_ROOT
 *   2. no `URL.pathname` is used as a filesystem path in the examples or in the
 *      skill's docs templates — the form that leaves `%20` in a path with a
 *      space and yields `/C:/…` on Windows
 *   3. no ESM `import` specifier anywhere under tests/ or tools/ is built from a
 *      raw filesystem path — the other side of the same boundary, which fails
 *      on Windows with ERR_UNSUPPORTED_ESM_URL_SCHEME
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
  // "junction" is the one directory link Windows creates without elevation —
  // the platform this suite exists for. The type is ignored on POSIX.
  for (const dir of ["tools", "brand"]) symlinkSync(join(root, dir), join(checkout, dir), "junction");
  for (const f of ["gen-example.js", "stick-figure.excalidrawlib"]) {
    copyFileSync(join(root, "examples", f), join(checkout, "examples", f));
  }
  // package.json carries `"type": "module"`. Without it the copy is only ESM by
  // Node's syntax detection, which is a different resolution path than the one a
  // real checkout takes — the test would be passing for the wrong reason.
  copyFileSync(join(root, "package.json"), join(checkout, "package.json"));
  console.log(`checkout: ${checkout}`);

  // Both documented invocations, because both have to keep working: the docs lead
  // with the argument form (it survives a `node`-scoped Bash allowlist, which an
  // env-prefixed command line does not), and keep the env form as the alternative
  // every already-committed generator uses.
  // Compared case-folded: Windows environment names are case-insensitive, so an
  // inherited `Claude_Plugin_Root` would survive dropping the upper-cased key and
  // hand the argv form a root through the variable — the opposite of the test.
  const envWithoutRoot = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "CLAUDE_PLUGIN_ROOT"));
  const forms = [
    ["argv", [checkout], envWithoutRoot],
    ["env", [], { ...envWithoutRoot, CLAUDE_PLUGIN_ROOT: checkout }],
  ];

  const out = join(checkout, "examples", "example.excalidraw");
  for (const [form, args, env] of forms) {
    rmSync(out, { force: true });
    const run = spawnSync(process.execPath, ["examples/gen-example.js", ...args], {
      cwd: checkout,
      env,
      encoding: "utf8",
    });
    // A spawn that never ran has no status and no stderr; say so rather than
    // reporting `exit null: undefined` and sending the reader to the wrong place.
    const why = () => String(run.stderr ?? "").split("\n").filter(Boolean).slice(-1)[0]
      ?? run.error?.message ?? "no output on stderr";
    check(`the generator exits clean from a path with a space (${form} form)`, run.status === 0,
      run.status === 0 ? "" : `exit ${run.status}: ${why()}`);
    check(`the diagram lands next to the generator (${form} form)`, existsSync(out), out);
  }

  // The documented precedence, pinned: the variable is read first and the argument
  // only when it is unset, so a stale variable beats a good argument — and the
  // failure names the root it tried. No browser reached: the import fails first.
  // The assertion matches the one path segment only the variable can contribute,
  // not the whole absolute path: how a failed import renders the path it tried —
  // raw, or a file URL with `%20` for the space — is Node's business, not ours.
  {
    const marker = "no-such-root";
    const clash = spawnSync(process.execPath, ["examples/gen-example.js", checkout], {
      cwd: checkout,
      env: { ...envWithoutRoot, CLAUDE_PLUGIN_ROOT: join(checkout, marker) },
      encoding: "utf8",
    });
    check("the environment is read before the argument",
      clash.status !== 0 && String(clash.stderr ?? "").includes(marker),
      `exit ${clash.status}`);
  }
  if (existsSync(out)) {
    const doc = JSON.parse(readFileSync(out, "utf8"));
    check("the image travels in the files dictionary",
      Object.keys(doc.files ?? {}).length === 1,
      `${Object.keys(doc.files ?? {}).length} file(s)`);
  }
}

// ---- 2. no URL.pathname as a filesystem path ----
{
  // In JS, any `.pathname` read is the bug — nothing here has a legitimate use
  // for it — so the guard is the property, not one spelling of one expression.
  // Comments are stripped first: naming the trap is how the fix stays understood.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // Markdown is prose around snippets, so only the shape counts there; the
  // sentence explaining why `URL.pathname` is wrong has to stay sayable.
  const shape = (src) => (/\)\s*\.pathname/.test(src) ? src : "");

  const sources = [
    ["examples/gen-example.js", (s) => code(s)],
    ["skills/excalidraw-diagram/SKILL.md", shape],
    ["skills/excalidraw-diagram/reference/authoring.md", shape],
    ["skills/excalidraw-diagram/reference/palette.md", shape],
    ["skills/excalidraw-diagram/reference/patterns.md", shape],
    ["skills/excalidraw-diagram/reference/anti-patterns.md", shape],
  ];
  const offenders = sources
    .filter(([f, scan]) => /\.pathname\b/.test(scan(readFileSync(join(root, f), "utf8"))))
    .map(([f]) => f);
  check("no URL.pathname in the example or the docs templates",
    offenders.length === 0, offenders.join(", ") || `${sources.length} files clean`);
}

// ---- 3. no ESM import specifier built from a raw filesystem path ----
{
  // The mirror image of section 2: there, a URL was used as a path; here, a path
  // is used as a URL. `import "C:\x\y.js"` is not a legal specifier — the default
  // loader reads `C:` as a scheme and refuses with ERR_UNSUPPORTED_ESM_URL_SCHEME.
  // A specifier assembled at runtime must therefore cross back through node:url,
  // so the guard is: every interpolation inside a specifier names pathToFileURL.
  // A line builds a specifier when `from` is followed by an interpolation, or
  // `import(` by anything other than a literal module name. Such a line that
  // reaches for `join` without `pathToFileURL` is handing a path to the loader.
  const buildsSpecifier = (line) => /\bfrom\s*["'`]?\$\{/.test(line) || /\bimport\(\s*(?!["'`])/.test(line);
  const raw = (line) => /\bjoin\(/.test(line) && !/pathToFileURL/.test(line) && buildsSpecifier(line);
  // Comments are stripped, as in section 2: otherwise naming `pathToFileURL` in a
  // trailing comment would switch the guard off for that line. Block comments
  // collapse to their newlines so the reported line numbers stay true.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")).replace(/\/\/.*$/gm, "");

  /** Every .js under `dir`, at any depth — "anywhere under tests/" means anywhere. */
  const jsFiles = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? jsFiles(`${dir}/${e.name}`)
        : e.name.endsWith(".js") ? [`${dir}/${e.name}`]
        : [],
    );

  const offenders = [];
  for (const f of [...jsFiles("tests"), ...jsFiles("tools"), ...jsFiles("examples")]) {
    stripComments(readFileSync(join(root, f), "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (raw(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
      });
  }
  check("every runtime import specifier goes through pathToFileURL",
    offenders.length === 0, offenders.join(" | ") || "no raw-path specifiers");
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
