#!/usr/bin/env node
/**
 * Unit suite for the library index (#136, tools/library-index.js) and its CLI
 * face (tools/library.js). Discovery in front of the existing splice: find a
 * community library by name, download it, hand the path to spliceLibraryItem.
 *
 * Chrome-free and **network-free**: every run injects a transport that serves
 * `tests/fixtures/library-index.json` from memory and a cache directory under
 * the OS temp dir, so the suite proves the caching contract without reaching
 * libraries.excalidraw.com. The fixture mirrors the real index's key presence —
 * one entry carries no `id` and one carries no `itemNames`, because 55 and 71 of
 * the real 231 entries respectively do not.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  searchIndex, loadIndex, downloadLibrary, cacheRoot, INDEX_TTL_MS, INDEX_URL, LIBRARY_URL_BASE,
} from "../tools/library-index.js";
import { spliceLibraryItem } from "../tools/author.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = JSON.parse(readFileSync(join(root, "tests/fixtures/library-index.json"), "utf8"));
const INDEX_TEXT = JSON.stringify(INDEX);

const fail = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) fail.push(name);
};

/** What the module thrown from `fn` was, or the name of what came out instead. */
const throwsWith = async (errorName, fn) => {
  try {
    await fn();
    return { ok: false, message: "", detail: "nothing thrown" };
  } catch (err) {
    return { ok: err?.name === errorName, message: err?.message ?? "", detail: err?.name ?? "?" };
  }
};

/**
 * A transport standing in for the network. `serve` maps a URL to its body; a URL
 * it does not hold fails the way an unreachable host does, which is how "with
 * the network down" is expressed here — `calls` then proves no request was made.
 */
const transportOf = (serve) => {
  const calls = [];
  return {
    calls,
    fetchText: async (url) => {
      calls.push(url);
      if (!(url in serve)) throw new Error(`getaddrinfo ENOTFOUND (stub) ${url}`);
      return serve[url];
    },
  };
};

const cacheDir = () => mkdtempSync(join(tmpdir(), "library-index-"));

// ---- 1. search by name, description and item name ----
{
  const hits = searchIndex(INDEX, "aws");
  check("a name match is found", hits.some((h) => h.source === "alice/aws.excalidrawlib"),
    hits.map((h) => h.source).join(", "));
  check("a description-only match is found too",
    hits.some((h) => h.source === "carol/k8s.excalidrawlib"), hits.map((h) => h.source).join(", "));
  check("the name match outranks the description-only one",
    hits[0]?.source === "alice/aws.excalidrawlib", hits[0]?.source);

  const byItem = searchIndex(INDEX, "lambda");
  check("an item name is searchable", byItem.length === 1 && byItem[0].source === "alice/aws.excalidrawlib",
    byItem.map((h) => h.source).join(", ") || "nothing");

  check("a query nothing matches returns nothing", searchIndex(INDEX, "zzzznope").length === 0);
}

// ---- 2. a result carries enough metadata to choose ----
{
  const [hit] = searchIndex(INDEX, "aws architecture");
  check("a hit carries name, description and source",
    hit?.name === "AWS Architecture Icons" && /Official AWS/.test(hit?.description ?? "") &&
      hit?.source === "alice/aws.excalidrawlib", JSON.stringify(hit));
  check("item count comes from itemNames", hit?.itemCount === 4, String(hit?.itemCount));

  // The index carries no item-count field; itemNames is the only proxy and 71 of
  // the real 231 entries lack it. Reporting null says "unknown" — a fabricated 0
  // would read as an empty library.
  const noItems = searchIndex(INDEX, "arrows")[0];
  check("an entry without itemNames reports an unknown count", noItems?.itemCount === null,
    String(noItems?.itemCount));
  // `id` is absent on 55 of the real 231 entries, so it can never be the handle.
  const noId = searchIndex(INDEX, "kubernetes")[0];
  check("an entry without an id still has a source handle",
    noId?.id === null && noId?.source === "carol/k8s.excalidrawlib", JSON.stringify(noId));

  // The CLI prints hits straight into `--json`, so a hit's fields *are* the
  // published contract — the rank that orders them must not ride along.
  const FIELDS = ["source", "name", "description", "itemCount", "authors", "updated", "version", "id"];
  check("a hit publishes exactly the documented fields",
    JSON.stringify(Object.keys(hit).sort()) === JSON.stringify([...FIELDS].sort()),
    Object.keys(hit).join(", "));
}

// ---- 3. the cache location is the documented one ----
{
  // Never inside the checkout: CI refuses a verification run that dirties a
  // tracked file, and a user's downloads are not the repo's business.
  check("EXCALIDRAW_LIBRARY_CACHE wins outright",
    cacheRoot({ EXCALIDRAW_LIBRARY_CACHE: join(tmpdir(), "chosen"), XDG_CACHE_HOME: join(tmpdir(), "xdg") })
      === resolve(join(tmpdir(), "chosen")));
  check("XDG_CACHE_HOME is honoured next",
    cacheRoot({ XDG_CACHE_HOME: join(tmpdir(), "xdg") })
      === join(resolve(join(tmpdir(), "xdg")), "aiworx-excalidraw", "libraries"));
  const fallback = cacheRoot({});
  check("with neither set it falls back under the home cache directory",
    isAbsolute(fallback) && fallback.includes("aiworx-excalidraw") && !fallback.startsWith(root),
    fallback);
}

// ---- 4. the index is fetched once, then served from the cache ----
{
  const dir = cacheDir();
  const net = transportOf({ [INDEX_URL]: INDEX_TEXT });

  const first = await loadIndex({ cacheDir: dir, transport: net });
  check("a cold load reaches the index and reports it", first.from === "network", first.from);
  check("a cold load returns every entry", first.entries.length === INDEX.length, String(first.entries.length));

  // The acceptance criterion: a second search runs with the network unreachable.
  const down = transportOf({});
  const second = await loadIndex({ cacheDir: dir, transport: down });
  check("a warm load is served from the cache", second.from === "cache", second.from);
  check("a warm load makes no request", down.calls.length === 0, down.calls.join(", "));
  check("the cached entries match the fetched ones",
    JSON.stringify(second.entries) === JSON.stringify(first.entries));

  // --refresh re-fetches even though the cache is fresh.
  const again = transportOf({ [INDEX_URL]: INDEX_TEXT });
  check("--refresh goes back to the network",
    (await loadIndex({ cacheDir: dir, transport: again, refresh: true })).from === "network",
    again.calls.join(", "));
}

// ---- 4b. the index is remote data, so an unusable entry never reaches a search ----
{
  // One null or one source-less entry reaching searchIndex would surface as a raw
  // TypeError, stating neither what failed nor what to do — so they are dropped
  // on the way in, and the other entries still work.
  const dirty = [null, "a string", { name: "no source here" }, ...INDEX];
  const dir = cacheDir();
  const loaded = await loadIndex({ cacheDir: dir, transport: transportOf({ [INDEX_URL]: JSON.stringify(dirty) }) });
  check("unusable entries are dropped from a fetched index",
    loaded.entries.length === INDEX.length, String(loaded.entries.length));
  check("the surviving entries still search", searchIndex(loaded.entries, "aws").length === 2);

  // Cached the same way, so a hand-edited cache file cannot crash a later search.
  writeFileSync(join(dir, "index.json"), JSON.stringify({ fetchedAt: Date.now(), entries: dirty }));
  const reread = await loadIndex({ cacheDir: dir, transport: transportOf({}) });
  check("unusable entries are dropped from a cached index too",
    reread.from === "cache" && reread.entries.length === INDEX.length,
    `${reread.from}/${reread.entries.length}`);

  // Every entry unusable is not a dirty index, it is a moved shape — worth refusing.
  const allBad = await throwsWith("LibraryIndexError", () => loadIndex({
    cacheDir: cacheDir(), transport: transportOf({ [INDEX_URL]: JSON.stringify([null, 1, {}]) }),
  }));
  check("an index where no entry has a source refuses", allBad.ok, allBad.detail);
  check("and says so rather than reporting an empty index",
    /no entry in the index has a source/.test(allBad.message), allBad.message);

  // An index that is genuinely empty is not malformed — nothing matches, no refusal.
  const empty = await loadIndex({ cacheDir: cacheDir(), transport: transportOf({ [INDEX_URL]: "[]" }) });
  check("a genuinely empty index is not an error", empty.entries.length === 0);
}

// ---- 5. staleness: past the TTL the cache is re-checked, and refuses honestly ----
{
  const dir = cacheDir();
  const now = 1_700_000_000_000;
  await loadIndex({ cacheDir: dir, transport: transportOf({ [INDEX_URL]: INDEX_TEXT }), now });

  const later = now + INDEX_TTL_MS + 1;
  const fresher = [...INDEX, { name: "New Library", description: "Added later.", source: "zoe/new.excalidrawlib", authors: [], updated: "2025-01-01", version: 1 }];
  const net = transportOf({ [INDEX_URL]: JSON.stringify(fresher) });
  const refreshed = await loadIndex({ cacheDir: dir, transport: net, now: later });
  check("a stale cache is refreshed from the network",
    refreshed.from === "network" && refreshed.entries.length === fresher.length,
    `${refreshed.from}/${refreshed.entries.length}`);

  // A stale cache the network cannot refresh refuses, and names the flag that
  // accepts it anyway — a refusal with no way forward would just block authoring.
  const dir2 = cacheDir();
  await loadIndex({ cacheDir: dir2, transport: transportOf({ [INDEX_URL]: INDEX_TEXT }), now });
  const stuck = await throwsWith("LibraryIndexError",
    () => loadIndex({ cacheDir: dir2, transport: transportOf({}), now: later }));
  check("a stale cache with no network refuses", stuck.ok, stuck.detail);
  check("the refusal names --stale as the next action", /--stale/.test(stuck.message), stuck.message);
  const accepted = await loadIndex({ cacheDir: dir2, transport: transportOf({}), now: later, stale: true });
  check("--stale accepts the aged cache", accepted.from === "cache", accepted.from);

  // No cache at all and no network has nothing to fall back on, and --stale
  // cannot conjure one, so it must say so rather than report an empty index.
  const empty = await throwsWith("LibraryIndexError",
    () => loadIndex({ cacheDir: cacheDir(), transport: transportOf({}), stale: true }));
  check("no cache and no network refuses instead of reporting nothing", empty.ok, empty.detail);
  check("that refusal says the index was never cached", /never|no cached/i.test(empty.message), empty.message);
}

// ---- 6. a download lands at an absolute path the splice takes unchanged ----
{
  const source = "erin/stick.excalidrawlib";
  // The real committed library, so what the splice is handed here is what a real
  // download hands it — not a fixture shaped to suit this suite.
  const body = readFileSync(join(root, "examples/stick-figure.excalidrawlib"), "utf8");
  const dir = cacheDir();
  const net = transportOf({ [LIBRARY_URL_BASE + source]: body });

  const path = await downloadLibrary(source, { cacheDir: dir, transport: net });
  check("a download reports an absolute path", isAbsolute(path), path);
  check("the file is really there", existsSync(path) && readFileSync(path, "utf8") === body, path);

  // The whole point of discovery: the existing splice is the only insertion path.
  const spliced = spliceLibraryItem(path, { item: "stick figure", at: [10, 20] });
  check("the existing splice accepts the download unchanged",
    spliced.kind === "layout-group" && spliced.children.length > 0,
    `${spliced.kind}/${spliced.children?.length}`);

  // Second call with the network down: the library is cached too, not just the index.
  const down = transportOf({});
  const again = await downloadLibrary(source, { cacheDir: dir, transport: down });
  check("a cached library needs no network", again === path && down.calls.length === 0,
    down.calls.join(", ") || again);

  const missing = await throwsWith("LibraryIndexError", () =>
    downloadLibrary("nobody/absent.excalidrawlib", { cacheDir: cacheDir(), transport: transportOf({}) }));
  check("a library that cannot be downloaded refuses", missing.ok, missing.detail);

  // What arrives is held to spliceLibraryItem's own bar, so an error page or an
  // item-less file is refused here, where the cause is still visible, instead of
  // becoming a LibraryError from inside a later splice.
  for (const [label, body] of [
    ["an HTML error page", "<!doctype html><h1>404</h1>"],
    ["a document of the wrong type", JSON.stringify({ type: "excalidraw", elements: [] })],
    ["a library holding no items", JSON.stringify({ type: "excalidrawlib", version: 2, libraryItems: [] })],
  ]) {
    const url = LIBRARY_URL_BASE + "zoe/bad.excalidrawlib";
    const dir3 = cacheDir();
    const r = await throwsWith("LibraryIndexError", () =>
      downloadLibrary("zoe/bad.excalidrawlib", { cacheDir: dir3, transport: transportOf({ [url]: body }) }));
    check(`${label} is refused rather than cached`, r.ok, r.detail);
    check(`${label} leaves nothing behind in the cache`,
      !existsSync(join(dir3, "zoe/bad.excalidrawlib")));
  }

  // A cached file that cannot be spliced — a write cut short — is treated as
  // absent and re-fetched, rather than failing every splice from then on.
  {
    const dir4 = cacheDir();
    mkdirSync(join(dir4, "erin"), { recursive: true });
    writeFileSync(join(dir4, "erin/stick.excalidrawlib"), body.slice(0, 40));
    const healed = await downloadLibrary(source, {
      cacheDir: dir4, transport: transportOf({ [LIBRARY_URL_BASE + source]: body }),
    });
    check("a truncated cached library is re-fetched rather than trusted",
      readFileSync(healed, "utf8") === body);
  }

  // `source` comes from a remote document and is pasted into a path, so it is
  // validated rather than trusted: a crafted entry must not write outside the cache.
  for (const hostile of ["../../etc/passwd", "a/../../b.excalidrawlib", "/abs/x.excalidrawlib", "one/two/three.excalidrawlib", "erin/stick.txt"]) {
    const r = await throwsWith("LibraryIndexError", () =>
      downloadLibrary(hostile, { cacheDir: cacheDir(), transport: transportOf({}) }));
    check(`a source of ${JSON.stringify(hostile)} is refused before any write`, r.ok, r.detail);
  }
}

// ---- 7. the CLI face ----
{
  // A cache seeded by hand is the seam that keeps these runs offline: the CLI
  // uses the real transport, and never reaches it because the cache answers
  // first. EXCALIDRAW_LIBRARY_CACHE is what points it at this directory.
  const dir = cacheDir();
  mkdirSync(join(dir, "erin"), { recursive: true });
  writeFileSync(join(dir, "index.json"), JSON.stringify({ fetchedAt: Date.now(), entries: INDEX }));
  writeFileSync(join(dir, "erin/stick.excalidrawlib"),
    readFileSync(join(root, "examples/stick-figure.excalidrawlib"), "utf8"));

  const cli = (...args) => {
    const r = spawnSync(process.execPath, [join("tools", "library.js"), ...args], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, EXCALIDRAW_LIBRARY_CACHE: dir },
    });
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
  };

  const search = cli("aws");
  check("a search exits 0 and names the handle",
    search.code === 0 && search.out.includes("alice/aws.excalidrawlib"), `${search.code} ${search.err}`);
  check("a search reports it read the cache", /index from cache/.test(search.out), search.out.split("\n")[0]);

  const asJson = cli("--json", "aws");
  const parsed = asJson.code === 0 ? JSON.parse(asJson.out) : null;
  check("--json prints one parseable document",
    parsed?.ok === true && parsed.query === "aws" && parsed.matches.length === 2,
    `${asJson.code} ${asJson.err}`);
  check("--json carries the handle and the item count",
    parsed?.matches?.[0]?.source === "alice/aws.excalidrawlib" && parsed.matches[0].itemCount === 4,
    JSON.stringify(parsed?.matches?.[0]));

  const none = cli("zzzznope");
  check("a query nothing matches is an answer, not a failure", none.code === 0, String(none.code));
  check("and it says so", /no library matches/.test(none.out), none.out.trim());

  const got = cli("--download", "erin/stick.excalidrawlib");
  check("--download prints the resolved absolute path",
    got.code === 0 && isAbsolute(got.out.trim()) && existsSync(got.out.trim()),
    `${got.code} ${got.out.trim()} ${got.err}`);
  check("the printed path is what the splice reads",
    spliceLibraryItem(got.out.trim(), { item: "stick figure" }).kind === "layout-group");

  const bad = cli("--download", "../../etc/passwd");
  check("a hostile handle exits 1 with a named error",
    bad.code === 1 && /^LibraryIndexError:/.test(bad.err), `${bad.code} ${bad.err.trim()}`);

  // Usage errors, all before any cache or network access.
  const noQuery = cli();
  check("no query exits 2", noQuery.code === 2 && /UsageError/.test(noQuery.err), `${noQuery.code} ${noQuery.err.trim()}`);
  // A blank query is the same usage mistake as no query — a wrong invocation (2),
  // not an index refusal (1). The in-process guard in library-index.js stays for
  // API callers; the CLI refuses first.
  const blank = cli("");
  check("a blank query exits 2 as a usage error",
    blank.code === 2 && /UsageError/.test(blank.err) && /empty search query/.test(blank.err),
    `${blank.code} ${blank.err.trim()}`);
  const unknown = cli("--no-such-flag", "aws");
  check("an unknown flag exits 2 and says so",
    unknown.code === 2 && /unknown flag/.test(unknown.err), `${unknown.code} ${unknown.err.trim()}`);
  const noValue = cli("--download");
  check("--download with no value asks for one rather than reading it as unknown",
    noValue.code === 2 && /needs a value/.test(noValue.err) && !/unknown flag/.test(noValue.err),
    `${noValue.code} ${noValue.err.trim()}`);
  // It will not swallow the next flag as its handle, exactly as render.js's value
  // flags do not — that would turn a usage mistake (2) into a refusal (1).
  const swallowed = cli("--download", "--refresh");
  check("--download will not take the next flag as its handle",
    swallowed.code === 2 && /needs a value, got --refresh/.test(swallowed.err),
    `${swallowed.code} ${swallowed.err.trim()}`);
  const both = cli("--download", "erin/stick.excalidrawlib", "aws");
  check("a query alongside --download exits 2 rather than ignoring half of it",
    both.code === 2 && /not a search query/.test(both.err), `${both.code} ${both.err.trim()}`);
  // A download reads no index, so --stale would do nothing. Refused rather than
  // ignored — silently dropping a flag is what this CLI's parsing exists to stop.
  const staleDownload = cli("--download", "erin/stick.excalidrawlib", "--stale");
  check("--stale alongside --download is refused rather than ignored",
    staleDownload.code === 2 && /--stale applies to a search/.test(staleDownload.err),
    `${staleDownload.code} ${staleDownload.err.trim()}`);

  // No runtime output may name a repo-relative script path: the skill ships to
  // plugin users with no checkout, for whom `node tools/…` does not resolve.
  check("the search output points at no repo-relative command",
    !/node\s+tools\//.test(search.out), search.out);

  const dashed = cli("--", "-aws");
  check("-- makes the next argument query text", dashed.code === 0 && /no library matches "-aws"/.test(dashed.out),
    `${dashed.code} ${dashed.out.trim()}`);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(", ")}` : "\nlibrary index holds");
process.exit(fail.length ? 1 : 0);
