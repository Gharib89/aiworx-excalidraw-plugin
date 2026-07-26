# Palette

`brand/palette.json` is the single source of truth. Import it rather than copying
hex values into a generator:

```js
import { palette, PROSE, CODE } from "<plugin>/tools/author.js";
palette.roles.remote.stroke   // "#792A8E"
palette.roles.remote.fill     // "#FFF0FF"
```

## Roles

| role | stroke | fill | means |
|---|---|---|---|
| `local` | `#3A44D4` | `#EEF6FF` | runs locally, on this machine |
| `artifact` | `#0198CB` | `#E1FCFF` | an artifact or output |
| `pass` | `#6E9A21` | `#F0FCE4` | a check that passed, a gate held |
| `remote` | `#792A8E` | `#FFF0FF` | leaves the machine — API or model call |
| `decision` | `#A17E00` | `#FFF6DD` | a decision, a threshold, a trap |
| `fail` | `#B61E24` | `#FFEFEB` | what goes wrong |

Plus `palette.grey` for scaffolding (`stroke`, `fill`, `faint`, `ink`, `canvas`)
and `palette.canvas` = `#FCFCFB` for `viewBackgroundColor`.

One colour, one meaning, across every diagram: a reader who learns that purple
means "this leaves the machine" in one diagram keeps that knowledge in the next.

A role used to colour *text* — a `WHY ·` aside in `decision` gold, a `GOTCHA ·`
in `fail` red — is not also used to fill a card. Gold prose on a gold card is
the same colour twice for two different jobs, and the marker stops reading as a
marker.

## Where the values come from

The strokes are the AIWorx brand's validated categorical slots, used verbatim.
The brand's own validation rejected the raw theme accents for marks — `accent1`
too dark, `accent4` and `accent6` below 3:1 on white — so those are not used here.

Fills are derived by one rule, not hand-picked: snap the stroke to `L = 0.975`,
`C ≤ 0.034` in OKLCH. Cyan is the binding constraint; at `L = 0.965` its stroke
made only 2.98:1 against its own fill.

## Verifying

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/palette.js           # print the table and the checks
node ${CLAUDE_PLUGIN_ROOT}/tools/palette.js --write   # rewrite brand/palette.json
```

It refuses to write unless body text clears 4.5:1 on every fill, strokes clear
3:1 on the canvas and on their own fill, and every fill stays ≥ 0.02 OKLab from
the canvas and from the other fills. A contrast ratio cannot detect a chroma-only
difference, which is why the distance check exists alongside it.

Changing a role colour means re-running this and accepting whatever it says.

## Fonts

`fontFamily: 6` (Nunito) for prose and labels; `fontFamily: 3` (Cascadia) for
code, JSON, paths and numbers-as-data. Both ship with Excalidraw and embed into
exported SVG, so the diagram renders identically anywhere.

Cascadia is a ligature font: `!=` renders as `≠`, `==` as `⩵`, `...` as `…`.
Legible, but the glyph is no longer the character in the source — so keep ASCII
where the point is what the file literally says (`->`, not `→`), and expect the
operators to be reshaped.

Nunito also stands in for the brand's Century Gothic, which cannot be embedded.
Families naming a system font — `2` is Helvetica — substitute per machine, so the
same file reflows into a different layout on a different box.

## No logo on the diagram

Diagrams carry no mark. The logo's "Ai" is overlapping translucent gradient
strokes, and Excalidraw has neither gradients nor stroke transparency, so a
drawn approximation reads as a botched copy of the brand mark. Embedding
`brand/AIWorx_logo.png` costs ~98 KB of base64 per file, because Excalidraw has
no external image references.

The palette and the fonts carry the brand instead.
