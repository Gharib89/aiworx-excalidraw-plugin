/**
 * The shared error base. Every error the tools throw derives from NamedError, so
 * a caller can dispatch on `instanceof` and still print a name that matches the
 * class — the name is the CLIs' user-visible output contract.
 *
 * Not for tools/page.js: that file is minified into the page bundle and the
 * minifier renames classes, which would make new.target.name emit the mangled
 * name. FontIntegrityError's string-literal name is deliberate — leave it off
 * this base.
 */

/**
 * Base for every named error: the subclass's own name, no per-class boilerplate.
 *
 * An error states three things — **what** failed, **where** (the file, element id
 * or API call it failed on), and the one **next** action that fixes it. The three
 * are separate fields so the quality bar is machine-checkable
 * (`tests/error-messages.js`), and the message is composed from them so a caller
 * that only prints `err.message` still reads all three:
 *
 *     `${where}: ${what} — ${next}`
 *
 * `where` and `next` are optional only so a bare `new SomeError("boom")` stays
 * legal for tests and re-wraps; every throw site in tools/ passes both.
 * Next actions are commands or instructions, never links — messages rot slower
 * than URLs do.
 */
export class NamedError extends Error {
  constructor(what, { where = "", next = "" } = {}) {
    // A `what` that lists things (paths tried, defects found) ends on a list
    // line; joining the remedy onto it with an em dash would read as one more
    // list entry, so it goes on its own line instead.
    const joined = [where && `${where}:`, what].filter(Boolean).join(" ");
    super(next ? joined + (what.includes("\n") ? `\n${next}` : ` — ${next}`) : joined);
    this.name = new.target.name;
    this.what = what;
    this.where = where;
    this.next = next;
  }
}

/**
 * A rejected value, rendered for its own message. JSON reads best and is what the
 * refusals show, but it throws on a bigint and on a circular object, and drops
 * `undefined` — and an error about a bad value must not fail on the value.
 *
 * It lives beside NamedError because it is part of the same contract: a check
 * that reached a verdict has to be able to say so, whatever it was handed. Every
 * refusal that quotes a caller's value goes through here, and
 * `tests/error-messages.js` pins that for the modules which import it.
 *
 * Total: for every input, this returns a non-empty string and throws nothing.
 * Three tiers, each a fallback for the one before, because the first two run
 * code the caller controls.
 */
export const shown = (value) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch { /* not serialisable — try the value's own string form */ }
  try {
    return String(value);
  } catch { /* no usable string form either — fall through to the type */ }
  // Both attempts run code the caller controls: JSON.stringify consults `toJSON`
  // and property getters, String consults `Symbol.toPrimitive` and `toString`,
  // and any of them can throw or be missing. `Object.create(null)` with a
  // self-reference defeats both without being hostile at all. `typeof` is the
  // only rendering that runs nothing and cannot fail, so the floor is built on
  // it — a vaguer message than the value deserves, but a message.
  return `an unprintable ${typeof value}`;
};

/** A CLI was invoked wrongly: print the usage text, exit 2, do nothing else. */
export class UsageError extends NamedError {}

/**
 * The input file is not a parseable Excalidraw document. It lives here rather
 * than beside the authoring API because every tool that opens a file raises it —
 * render.js would otherwise load the whole authoring module for one class.
 * Re-exported from tools/author.js, which is where the API documents it.
 *
 * `kind` is the machine-readable file-level code (`unreadable`, `empty-file`,
 * `invalid-json`, `not-excalidraw`) check.js maps to its code contract.
 */
export class DocumentError extends NamedError {
  constructor(what, { kind = "", ...rest } = {}) {
    super(what, rest);
    this.kind = kind;
  }
}

/**
 * A brand override file (`.excalidraw-brand.json`) that fails its schema or a
 * contrast claim. It lives here rather than beside the loader (tools/brand.js)
 * because check.js catches it to map the refusal into its code contract, and
 * the CLI should not depend on the loader for one class. Never a silent
 * fallback to house colours: an override that cannot be honoured refuses the
 * run.
 */
export class BrandOverrideError extends NamedError {}

/**
 * A runtime dependency the checkout never installed. It lives here rather than
 * beside either raiser because both the browser driver (playwright-core) and the
 * graph engine (elkjs) reach it, and layout.js must not import the browser
 * driver for one class. Re-exported from tools/browser.js, which is where the
 * install story is documented.
 */
export class MissingDependencyError extends NamedError {}

/**
 * Import a runtime dependency on first use, turning "the package is not there"
 * into the one command that fixes it.
 *
 * The deferral is the point: a static import would make an uninstalled checkout
 * die with the loader's bare ERR_MODULE_NOT_FOUND — an error naming an internal
 * specifier and no remedy — before any of the calling module runs.
 *
 * `needed` says what the caller wanted it *for*, because the remedy is the same
 * command for every dependency and only that clause tells the reader which
 * capability they just lost.
 */
export async function loadDependency(specifier, needed) {
  try {
    return await import(specifier);
  } catch (err) {
    // The package itself, not something missing inside it: a broken install is a
    // different fault and `npm install --omit=dev` is not its remedy.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && err.message.includes(`Cannot find package '${specifier}'`)) {
      throw new MissingDependencyError(`is not installed — ${needed}`, {
        where: specifier, next: "Run: npm install --omit=dev",
      });
    }
    throw err;
  }
}
