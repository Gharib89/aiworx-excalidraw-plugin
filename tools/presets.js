/**
 * The output presets: what surface a diagram is destined for, and the type ramp
 * that makes it readable there.
 *
 * A diagram bound for a projected slide and the same diagram bound for an inline
 * doc figure are not one picture at two zoom levels. Text that reads at laptop
 * distance is illegible across a room, so the fix is bigger *type*, not a bigger
 * image: scaling a finished export enlarges the whitespace along with the words
 * and lands back where it started. Because every card and frame here is sized
 * from measured text, raising the ramp before the build widens the cards that
 * hold it and the layout follows for free — which is the whole reason a preset
 * is chosen at authoring time rather than applied to the finished SVG.
 *
 * `surface` is the display the preset targets, in px. It is a *target*, not a
 * clamp: nothing crops or scales a build that overruns it. The build reads it
 * (`surface` on the build context) to decide wrapping widths and panel counts,
 * and `render.js --preset` frames its exports to that aspect ratio. `fit` names
 * no surface — the picture is whatever size its content came out — which is
 * also how a generator tells the two apart.
 *
 * The three rungs are the roles text plays, not element types: `title` for a
 * panel or diagram heading, `label` for the words inside a node, `sublabel` for
 * an edge annotation or a caption. `sublabel` is what `arrowBetween` gives a
 * bare string label, so an author who names no size still gets the ramp.
 *
 * These numbers are public surface — the shipped skill publishes them — and
 * `fit`'s are load-bearing beyond that: every committed example was authored
 * under them, so moving `fit.ramp.label` rewrites artifacts that are supposed
 * to be reproducible.
 */

/** Every preset, keyed by the name `preset:` and `--preset` accept. */
export const PRESETS = {
  /** Today's behaviour: no target surface, the ramp the helpers have always used. */
  fit: {
    surface: null,
    ramp: { title: 28, label: 20, sublabel: 16 },
  },
  /** A figure inside a doc column — read close, so the ramp sits below the default. */
  "doc-inline": {
    surface: { width: 720, height: 480 },
    ramp: { title: 22, label: 16, sublabel: 13 },
  },
  /** A full-width doc figure: the default ramp on a landscape surface. */
  "doc-wide": {
    surface: { width: 1200, height: 675 },
    ramp: { title: 28, label: 20, sublabel: 16 },
  },
  /**
   * A projected 16:9 slide. Every rung clears the gate's 24px large-text
   * threshold, so contrast is judged at the size the room actually sees.
   */
  "slide-16x9": {
    surface: { width: 1600, height: 900 },
    ramp: { title: 48, label: 32, sublabel: 26 },
  },
  /** An Open Graph card — 1200x630 is the size the platforms crop to. */
  "social-og": {
    surface: { width: 1200, height: 630 },
    ramp: { title: 44, label: 30, sublabel: 24 },
  },
};

/** The valid set, in the order an error message and the docs should list it. */
export const PRESET_NAMES = Object.keys(PRESETS);

/**
 * The preset a caller who names none gets. Chosen so that omitting `preset:`
 * and passing `"fit"` are the same run.
 */
export const DEFAULT_PRESET = "fit";
