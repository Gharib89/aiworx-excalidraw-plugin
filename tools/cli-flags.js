/**
 * What each CLI accepts, named in one place, so a guard can read the inventory
 * without running a CLI: `check.js` and `revise.js` parse `process.argv` at
 * module top level, so importing either to ask what it takes would execute the
 * tool. `tests/drawn-commands.js` holds a band's drawn `--flag` to the flags of
 * the script it follows; `tests/cli-flags.js` holds this declaration to what the
 * CLIs really do with those flags, which is what keeps the two from drifting.
 *
 * render.js parses generically — flag name to option key — so it takes its two
 * sets straight from here. check.js and revise.js each match one flag by name,
 * which keeps a flag added to a set below from silently aliasing the one already
 * handled; `tests/cli-flags.js` is what proves those names still agree.
 *
 * The flags are public surface. This module is not.
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
