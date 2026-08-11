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

/** A CLI was invoked wrongly: print the usage text, exit 2, do nothing else. */
export class UsageError extends NamedError {}

/**
 * The input file is not a parseable Excalidraw document. It lives here rather
 * than beside the authoring API because every tool that opens a file raises it —
 * render.js would otherwise load the whole authoring module for one class.
 * Re-exported from tools/author.js, which is where the API documents it.
 */
export class DocumentError extends NamedError {}

/**
 * A runtime dependency the checkout never installed. It lives here rather than
 * beside either raiser because both the browser driver (playwright-core) and the
 * graph engine (elkjs) reach it, and layout.js must not import the browser
 * driver for one class. Re-exported from tools/browser.js, which is where the
 * install story is documented.
 */
export class MissingDependencyError extends NamedError {}
