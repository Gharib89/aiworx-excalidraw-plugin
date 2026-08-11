/**
 * The library index: discovery in front of the splice.
 *
 * `spliceLibraryItem` inserts an item from a local `.excalidrawlib`, but nothing
 * helped find one. This module fetches the community index behind
 * libraries.excalidraw.com, caches it on disk, searches it, and downloads a
 * chosen library to a path the splice takes unchanged. Discovery feeds the
 * splice; it never inserts anything itself.
 *
 * The index is the `excalidraw/excalidraw-libraries` repo published as one JSON
 * array — there is no other API. Each entry carries `name`, `description`,
 * `authors`, `source`, `preview`, `created`, `updated` and `version`; `id` and
 * `itemNames` are optional and, in the real index, frequently absent. So
 * **`source` is the handle** — it is present on every entry and is literally the
 * path the library downloads from — and there is no `tags` field, which is why
 * a query is matched against the name, the description and the item names.
 *
 * CLI face: tools/library.js.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { NamedError } from "./errors.js";

/** The published index, and the prefix every entry's `source` hangs off. */
export const INDEX_URL = "https://libraries.excalidraw.com/libraries.json";
export const LIBRARY_URL_BASE = "https://libraries.excalidraw.com/libraries/";

/**
 * How long a cached index is used without asking the network. Long enough that a
 * whole authoring session — the acceptance case of a second search with the
 * network down — never reaches out twice, short enough that a library published
 * this month is findable next week.
 */
export const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The index, a downloadable library, or the cache behind them is unusable. A
 * distinct class from author.js's LibraryError, which is about the *contents* of
 * a `.excalidrawlib` the author already has: this one is about reaching one.
 */
export class LibraryIndexError extends NamedError {}

/**
 * Where downloads live. Outside the checkout on purpose: the cache is a user's,
 * not a repo's, and CI refuses a verification run that dirties a tracked file.
 * `EXCALIDRAW_LIBRARY_CACHE` overrides it outright — the same escape hatch
 * `CHROME_PATH` gives the browser driver, and what the tests use to stay offline.
 */
export function cacheRoot(env = process.env) {
  if (env.EXCALIDRAW_LIBRARY_CACHE) return resolve(env.EXCALIDRAW_LIBRARY_CACHE);
  const base = env.XDG_CACHE_HOME ? resolve(env.XDG_CACHE_HOME) : join(homedir(), ".cache");
  return join(base, "aiworx-excalidraw", "libraries");
}

/**
 * How long a request is given before it counts as unreachable. Node's fetch has
 * no default timeout, and a host that accepts the connection then stalls would
 * otherwise hang the CLI with no output — the refusals below are only reachable
 * if the request is bounded.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** The default transport: Node's own fetch, so no dependency is added for it. */
const httpTransport = {
  fetchText: async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  },
};

/** An index entry usable enough to search and to download from. */
const isUsableEntry = (e) => Boolean(e) && typeof e === "object" && typeof e.source === "string";

/** The cached index and its stamp, or null when nothing is cached yet. */
function readCachedIndex(dir) {
  let raw;
  try {
    raw = readFileSync(join(dir, "index.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const held = JSON.parse(raw);
    if (!Array.isArray(held?.entries) || typeof held.fetchedAt !== "number") return null;
    // Filtered on the way out as well as in: a cache file can be hand-edited, and
    // the search must never meet an entry it would crash on.
    return { ...held, entries: held.entries.filter(isUsableEntry) };
  } catch {
    // A half-written or hand-edited cache is treated as absent rather than
    // fatal: the remedy is a re-fetch, which the caller is already able to do.
    return null;
  }
}

function writeCachedIndex(dir, entries, fetchedAt) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.json"), JSON.stringify({ fetchedAt, entries }));
}

/**
 * The index entries, from the cache when it is fresh and from the network when it
 * is not. Returns `{ entries, from, fetchedAt }` — `from` is `"cache"` or
 * `"network"`, so a caller can tell an author which they are looking at.
 *
 * `refresh` forces the network; `stale` accepts an aged cache the network cannot
 * refresh. Without `stale`, an aged cache plus an unreachable network refuses —
 * silently serving month-old data is how a missing library becomes a mystery.
 */
export async function loadIndex({
  cacheDir = cacheRoot(), refresh = false, stale = false,
  transport = httpTransport, now = Date.now(),
} = {}) {
  const cached = readCachedIndex(cacheDir);
  const fresh = cached && now - cached.fetchedAt < INDEX_TTL_MS;
  if (cached && fresh && !refresh) return { entries: cached.entries, from: "cache", fetchedAt: cached.fetchedAt };

  let text;
  try {
    text = await transport.fetchText(INDEX_URL);
  } catch (err) {
    if (cached) {
      // An aged cache is usable material, but only on the author's say-so.
      if (stale) return { entries: cached.entries, from: "cache", fetchedAt: cached.fetchedAt };
      const age = Math.round((now - cached.fetchedAt) / 86_400_000);
      throw new LibraryIndexError(`the cached index is ${age} days old and it cannot be refreshed — ${err.message}`, {
        where: "the library index",
        next: "Reconnect, or pass --stale to search the cached index anyway",
      });
    }
    throw new LibraryIndexError(`the index was never cached and cannot be fetched — ${err.message}`, {
      where: "the library index", next: "Connect to the network once; every later search reads the cache",
    });
  }

  let entries;
  try {
    entries = JSON.parse(text);
  } catch (err) {
    throw new LibraryIndexError(`the index is not valid JSON — ${err.message}`, {
      where: "the library index", next: "Retry; if it persists the published index is broken, so report it upstream",
    });
  }
  if (!Array.isArray(entries)) {
    throw new LibraryIndexError(`the index is not an array of libraries (got ${typeof entries})`, {
      where: "the library index", next: "Retry; if it persists the published index changed shape, so report it upstream",
    });
  }
  // The index is remote data, so an entry is checked before it is kept: one
  // `null` or one missing `source` reaching the search would surface as a raw
  // TypeError, which states neither what failed nor what to do about it. A few
  // unusable entries are dropped rather than failing the other 230; all of them
  // unusable means the published shape moved, which is worth refusing over.
  const usable = entries.filter(isUsableEntry);
  if (entries.length > 0 && usable.length === 0) {
    throw new LibraryIndexError(`no entry in the index has a source (${entries.length} seen)`, {
      where: "the library index", next: "Retry; if it persists the published index changed shape, so report it upstream",
    });
  }
  writeCachedIndex(cacheDir, usable, now);
  return { entries: usable, from: "network", fetchedAt: now };
}

/**
 * The exact shape of every `source` in the published index: one author segment,
 * one file segment, `.excalidrawlib`. Checked rather than trusted, because
 * `source` arrives in a remote document and is then pasted into a filesystem
 * path — a crafted entry saying `../../…` must not write outside the cache.
 */
const SOURCE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*)\.excalidrawlib$/;

/**
 * Why `text` is not a library the splice could use, or `null` when it is.
 *
 * The bar is `spliceLibraryItem`'s own (tools/author.js): the v2 `libraryItems`
 * array or the v1 `library` array, holding at least one item. Checked here so a
 * download that is really an error page — or a file left half-written — is
 * refused at the moment it arrives, where the cause is still visible, rather than
 * surfacing as a LibraryError from inside a later splice.
 */
function libraryDefect(text) {
  let held;
  try {
    held = JSON.parse(text);
  } catch (err) {
    return err.message;
  }
  if (held?.type !== "excalidrawlib") return `type is ${JSON.stringify(held?.type)}`;
  const items = Array.isArray(held.libraryItems) ? held.libraryItems
    : Array.isArray(held.library) ? held.library : null;
  if (!items) return "it holds neither a libraryItems nor a library array";
  if (items.length === 0) return "it holds no library items";
  return null;
}

/**
 * Download the library named by an index entry's `source` and return the
 * **absolute** path of the cached file — the path `spliceLibraryItem` takes, so
 * discovery ends exactly where the existing insertion path begins.
 *
 * A library already in the cache is not re-fetched, so a second insertion works
 * with the network down. `refresh` forces the download again.
 */
export async function downloadLibrary(source, {
  cacheDir = cacheRoot(), refresh = false, transport = httpTransport,
} = {}) {
  if (typeof source !== "string" || !SOURCE_PATTERN.test(source)) {
    throw new LibraryIndexError(`not a library source (expected <author>/<name>.excalidrawlib)`, {
      where: String(source), next: "Copy the `source` field of a search result verbatim",
    });
  }
  const path = resolve(join(cacheDir, source));
  if (!refresh) {
    try {
      // Held to the same bar as a fresh download: a cached file that cannot be
      // spliced is treated as absent and re-fetched, so a truncated one heals
      // instead of failing every splice from here on.
      if (libraryDefect(readFileSync(path, "utf8")) === null) return path;
    } catch {
      // Not cached yet — fall through to the download.
    }
  }

  let text;
  try {
    text = await transport.fetchText(LIBRARY_URL_BASE + source);
  } catch (err) {
    throw new LibraryIndexError(`cannot download the library — ${err.message}`, {
      where: source, next: "Check the network, then retry; a search result older than the index may have been withdrawn",
    });
  }
  const defect = libraryDefect(text);
  if (defect !== null) {
    throw new LibraryIndexError(`what was downloaded is not a library the splice can use — ${defect}`, {
      where: source, next: "Retry with --refresh; if it persists the published library is broken, so report it upstream",
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  // Written aside and renamed into place, because the cached path above trusts
  // whatever it finds: a write interrupted midway would otherwise leave a partial
  // file that every later call accepts. Rename within one directory is atomic.
  const pending = `${path}.pending-${process.pid}`;
  writeFileSync(pending, text);
  renameSync(pending, path);
  return path;
}

/**
 * Rank a hit by where the query matched. A library whose *name* says "aws" is
 * what an author asking for "aws" wants; one that merely mentions it in prose is
 * a fallback, so the axis the match landed on orders the results.
 */
const NAME_RANK = 3;
const ITEM_RANK = 2;
const DESCRIPTION_RANK = 1;

/**
 * Search index entries by a case-insensitive substring of the name, the item
 * names, or the description, best axis first and alphabetical within a rank.
 *
 * Returns the metadata an author chooses on: `source` (the handle every later
 * call takes), `name`, `description`, `itemCount`, `authors`, `updated`,
 * `version`, and `id` — `null` where the entry omits one, never invented. The
 * index has no item-count field, so `itemCount` is `itemNames.length` and `null`
 * for an entry without them: an unknown count, not an empty library.
 */
export function searchIndex(entries, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (needle === "") {
    throw new LibraryIndexError("empty search query", {
      where: "query", next: "Name what to search for — a vendor, a product, or an icon name",
    });
  }
  const has = (text) => typeof text === "string" && text.toLowerCase().includes(needle);
  return entries
    .map((e) => {
      const itemNames = Array.isArray(e.itemNames) ? e.itemNames : null;
      const rank = has(e.name) ? NAME_RANK
        : itemNames?.some(has) ? ITEM_RANK
          : has(e.description) ? DESCRIPTION_RANK : 0;
      return {
        rank,
        hit: {
          source: e.source,
          name: e.name ?? null,
          description: e.description ?? null,
          itemCount: itemNames ? itemNames.length : null,
          authors: Array.isArray(e.authors) ? e.authors.map((a) => a?.name).filter(Boolean) : [],
          updated: e.updated ?? null,
          version: e.version ?? null,
          id: e.id ?? null,
        },
      };
    })
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank || String(a.hit.name).localeCompare(String(b.hit.name)))
    // The rank orders the results and then stops existing: the CLI prints hits
    // straight into `--json`, so a field kept here would become public surface
    // this module never documented.
    .map((r) => r.hit);
}
