/**
 * What each CLI accepts, named in one place. The parsers stay in the CLIs; this
 * module only holds the inventory, so a guard can read it without running one:
 * `check.js` and `revise.js` parse `process.argv` at module top level, so
 * importing either to ask what it takes would execute the tool.
 *
 * The flags are public surface — this module is not. Its one job is that the
 * inventory a parser enforces and the inventory a guard reads cannot drift
 * apart, so `tests/drawn-commands.js` can hold a band's drawn `--flag` to the
 * real flags of the script it follows.
 */

/** render.js flags that consume the next argument. */
export const RENDER_VALUE_FLAGS = new Set(["out", "scale", "frame", "padding", "background"]);
/** render.js flags that stand alone. */
export const RENDER_BOOL_FLAGS = new Set(["no-frames", "dark"]);
/** check.js selects output only — verification takes no options. */
export const CHECK_FLAGS = new Set(["json"]);
export const REVISE_FLAGS = new Set(["no-svg"]);

/**
 * Every flag a script accepts, keyed by the file name a drawn command names.
 * `--` is absent on purpose: it ends the flags rather than being one.
 */
export const FLAGS_BY_SCRIPT = {
  "check.js": CHECK_FLAGS,
  "render.js": new Set([...RENDER_VALUE_FLAGS, ...RENDER_BOOL_FLAGS]),
  "revise.js": REVISE_FLAGS,
};
