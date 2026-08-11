#!/usr/bin/env node
/**
 * Find a community icon library, and download one. CLI face of
 * tools/library-index.js — the discovery step in front of `spliceLibraryItem`,
 * which stays the only way an item enters a diagram.
 *
 * Usage:
 *   node tools/library.js [--json] [--refresh] [--stale] [--] <query>
 *   node tools/library.js --download <author/name.excalidrawlib> [--json] [--refresh]
 *
 * A search matches the query, case-insensitively, against a library's name, its
 * item names and its description — the index carries no tags — and prints the
 * `source` handle of each hit. `--download` takes that handle and prints the
 * resolved absolute path of the cached `.excalidrawlib`, which is what
 * `spliceLibraryItem` reads.
 *
 * The index is cached for a week under `$XDG_CACHE_HOME/aiworx-excalidraw/`
 * (`EXCALIDRAW_LIBRARY_CACHE` overrides the whole location), so every search
 * after the first works offline. `--refresh` re-fetches; `--stale` accepts a
 * cache older than a week when the network cannot refresh it.
 *
 * `--` ends the flags: the next argument is the query even if it starts with a
 * dash. Any other dash-prefixed argument is rejected as a typo.
 *
 * Exit codes match the other CLIs: 2 for an invocation that named nothing to do,
 * 1 for a refusal — no index, an undownloadable library, a bad handle. A search
 * that simply matches nothing is an answer, not a failure, and exits 0.
 */
import { UsageError, NamedError } from "./errors.js";
import { loadIndex, searchIndex, downloadLibrary } from "./library-index.js";

const USAGE = "usage: library.js [--json] [--refresh] [--stale] [--] <query>\n" +
  "       library.js --download <author/name.excalidrawlib> [--json] [--refresh]";

/** One hit's block, handle first, because that is what the next call takes. */
function hitBlock(hit) {
  const count = hit.itemCount === null ? "item count unknown" : `${hit.itemCount} items`;
  const by = hit.authors.length ? ` by ${hit.authors.join(", ")}` : "";
  return `  ${hit.source}\n    ${hit.name} — ${count}${by}, updated ${hit.updated ?? "unknown"}\n` +
    (hit.description ? `    ${hit.description}\n` : "");
}

try {
  const words = [];
  let download = null;
  let json = false;
  let refresh = false;
  let stale = false;
  let literal = false; // everything after -- is query text, even if it looks like a flag
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (literal || !a.startsWith("-")) {
      words.push(a);
    } else if (a === "--") {
      literal = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--refresh") {
      refresh = true;
    } else if (a === "--stale") {
      stale = true;
    } else if (a === "--download") {
      // The value is a separate argument, as in render.js: `--download=x` would
      // be a second spelling of the same flag for no gain.
      if (i + 1 >= argv.length) throw new UsageError("needs a value", { where: a, next: USAGE });
      download = argv[++i];
    } else {
      throw new UsageError("unknown flag", { where: a, next: USAGE });
    }
  }

  // Both modes at once has no meaning, and guessing which one was meant would
  // silently ignore half the invocation.
  if (download !== null && words.length) {
    throw new UsageError("--download takes a library handle, not a search query", {
      where: words.join(" "), next: USAGE,
    });
  }
  if (download === null && words.length === 0) {
    throw new UsageError("no search query given", { where: "query", next: USAGE });
  }
  // A download reads no index, so --stale has nothing to accept. Refused rather
  // than ignored: a flag that silently does nothing is the failure this CLI's
  // argument handling exists to prevent.
  if (download !== null && stale) {
    throw new UsageError("--stale applies to a search, not a download", {
      where: "--stale", next: "Drop --stale; --refresh is what forces a download again",
    });
  }

  if (download !== null) {
    const path = await downloadLibrary(download, { refresh });
    if (json) console.log(JSON.stringify({ ok: true, source: download, path }, null, 2));
    else console.log(path);
  } else {
    const query = words.join(" ");
    const { entries, from, fetchedAt } = await loadIndex({ refresh, stale });
    const matches = searchIndex(entries, query);
    if (json) {
      console.log(JSON.stringify({ ok: true, query, index: { from, fetchedAt }, matches }, null, 2));
    } else if (matches.length === 0) {
      console.log(`no library matches ${JSON.stringify(query)} — ${entries.length} libraries searched (index from ${from})`);
    } else {
      console.log(`${matches.length} of ${entries.length} libraries match ${JSON.stringify(query)} (index from ${from}):`);
      matches.forEach((hit) => process.stdout.write(hitBlock(hit)));
      console.log(`Pass a source above to --download to fetch it.`);
    }
  }
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`UsageError: ${err.message}`);
    process.exit(2);
  }
  // One branch for every named error the index raises — an unreachable index, an
  // aged cache, a bad handle, a broken download. A stack trace is for a bug here.
  if (err instanceof NamedError) {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
