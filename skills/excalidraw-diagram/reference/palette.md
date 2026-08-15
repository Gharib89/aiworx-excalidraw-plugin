# Palette

`brand/palette.json` is the single source of truth for the **house palette**; a
project can replace its colours with a **brand override** file (see below), and
every tool picks that up through the same import. Import rather than copying hex
values into a generator:

```js
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT ?? process.argv[2];   // guarded as in authoring.md, Measuring
const { palette, PROSE, CODE } = await import(pathToFileURL(join(root, "tools/author.js")).href);
palette.roles.remote.stroke   // "#792A8E"
palette.roles.remote.fill     // "#FFF0FF"
```

## Roles

What each role *means* lives in SKILL.md's House style table; these are the house
palette's values (a brand override, below, replaces them project-wide).

| role | stroke | fill |
|---|---|---|
| `local` | `#3A44D4` | `#EEF6FF` |
| `artifact` | `#0198CB` | `#E1FCFF` |
| `pass` | `#6E9A21` | `#F0FCE4` |
| `remote` | `#792A8E` | `#FFF0FF` |
| `decision` | `#A17E00` | `#FFF6DD` |
| `fail` | `#B61E24` | `#FFEFEB` |

Plus `palette.grey` for scaffolding (`stroke`, `fill`, `faint`, `ink`, `canvas`)
and `palette.canvas` = `#FCFCFB` for `viewBackgroundColor`.

One colour, one meaning, across every diagram: a reader who learns that purple
means "this leaves the machine" in one diagram keeps that knowledge in the next.

A role used to colour *text* — a `WHY ·` aside in `decision` gold, a `GOTCHA ·`
in `fail` red — stays off the cards, so the marker keeps its own colour. Gold
prose on a gold card is one colour doing two jobs, and the marker stops reading
as a marker.

A mark that means "picked by this thing" — a ring around a retrieved point, a
highlight over a page region — takes the *picker's* colour, not the marked
item's. In the item's own colour it disappears into it and stops reading as a
mark at all.

## Where the values come from

The strokes are the AIWorx brand's validated categorical slots, used verbatim.
The brand's own validation rejected the raw theme accents for marks — `accent1`
too dark, `accent4` and `accent6` below 3:1 on white — so those are not used here.

Fills are derived by one rule, not hand-picked: snap the stroke to `L = 0.975`,
`C ≤ 0.034` in OKLCH. Cyan is the binding constraint; at `L = 0.965` its stroke
made only 2.98:1 against its own fill.

## Verifying

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/palette.js"           # print the table and the checks
node "${CLAUDE_PLUGIN_ROOT}/tools/palette.js" --write   # rewrite brand/palette.json
```

It refuses to write unless body text clears 4.5:1 on every fill, strokes clear
3:1 on the canvas and on their own fill, and every fill stays ≥ 0.02 OKLab from
the canvas and from the other fills. A contrast ratio cannot detect a chroma-only
difference, which is why the distance check exists alongside it.

Changing a role colour means re-running this and accepting whatever it says.

## Brand override

A project that is not AIWorx-branded drops a `.excalidraw-brand.json` at its
root. Every palette consumer — authoring, gate, render — discovers it by walking
up from the working directory (first hit wins) and derives the full palette from
it in memory on every read; there is no generated file to go stale. No file means
the house palette, unchanged.

The file names strokes only:

```json
{
  "canvas": "#FCFCFB",
  "ink": "#1A1A19",
  "roles": {
    "local": "#3A44D4",
    "artifact": "#0198CB",
    "pass": "#6E9A21",
    "remote": "#792A8E",
    "decision": "#A17E00",
    "fail": "#B61E24"
  }
}
```

`canvas`, `ink` and all six roles are required, each a 6-digit hex. Everything else is derived, so
the override cannot drift from the rules above: fills by the same OKLCH snap,
grey by neutralising chroma at the house grey's lightness values over the
override's ink and canvas. Fonts are not overridable — the derived palette keeps
the house pair.

The alternate form `{ "defaults": "accepted" }` records the explicit decision to
keep the house palette (when both `roles` and `defaults` appear, `roles` wins).

An override that fails the schema or any contrast claim above — scored in both
themes, exactly as the house palette is — **refuses the run** with a
`BrandOverrideError`; the gate reports it as the file-level problem code
`invalid-brand-override`, exit 2. Nothing falls back silently: authored output is
either the override's colours or a named refusal. Preflight a candidate file
before relying on it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/palette.js" path/to/.excalidraw-brand.json
```

It prints the derived palette, the contrast report for both themes, and a
verdict — exit 0 only when every claim holds.

## Dark exports

Excalidraw's dark theme is not a second palette. `exportToSvg` puts one CSS filter
chain on the root `<svg>` — `invert(93%) hue-rotate(180deg)` — and every pixel
including the background rect goes through it; images carry a counter-filter so
photographs survive. So a dark colour is a pure function of its light one, and
`tools/palette.js` runs the whole check list twice, once per theme. Both pass:
under the filter the canvas becomes `#151514`, ink `#D7D7D6`, and the tightest
margin is `pass` stroke-on-own-fill at 4.24:1 against a 3:1 floor.

The filter is not contrast-preserving, though — it compresses some opposing hue
pairs toward each other. Dark green `#145A32` on pale salmon `#F5B7B1` clears
4.84:1 light and only 4.20:1 dark. The gate therefore scores the contrast rule
against both themes on every run — each `low-contrast` problem names the theme
it failed under, so an off-palette pair that only breaks dark still fails the
gate. `render.js --dark` sits beside that as output selection: it picks which
theme you look at, while verification always scores both.

## Fonts

Family assignment and the embed/substitution rule live in SKILL.md's House
style. Two facts beyond it:

Cascadia is a ligature font: `!=` renders as `≠`, `==` as `⩵`, `...` as `…`.
Legible, but the glyph is no longer the character in the source — so keep ASCII
where the point is what the file literally says (`->`, not `→`), and expect the
operators to be reshaped.

Nunito stands in for the brand's Century Gothic, which cannot be embedded.

