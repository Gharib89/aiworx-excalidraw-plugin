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

/** Base for every named error: the subclass's own name, no per-class boilerplate. */
export class NamedError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
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
