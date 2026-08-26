# What makes hand-drawn Excalidraw diagrams look good (#187)

Research notes for wayfinder ticket #187 (map #183). Question: what separates a
hand-drawn diagram that *looks good* from one that is merely sketchy, and how
does the shipped register — `roughness 1`, `fillStyle solid`, `strokeWidth 2`,
Nunito + Cascadia — compare with what Excalidraw itself and its exemplars do.

Sources are primary where one exists: the pinned `@excalidraw/excalidraw@0.18.1`
bundle (`node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js`,
read directly), Excalidraw's source and PR history on GitHub, rough.js's own
documentation, the published library index (`excalidraw/excalidraw-libraries`,
all 231 `.excalidrawlib` files downloaded and tallied), two peer-reviewed
studies on sketchy rendering, and the visual-thinking authors named in the
brief. Numbers below marked *(tally)* come from that library census; the script
is described in §8.

## 1. Answer in one paragraph

Excalidraw's own defaults *are* the shipped register: `roughness 1` ("Artist"),
`fillStyle "solid"`, `strokeWidth 2`, `strokeStyle "solid"`, `roundness "round"`,
`endArrowhead "arrow"` — and the maintainers moved to solid fill and width 2
deliberately in 2023 for legibility (#6698). The pipeline already sits on the
studied default; what makes a picture read as "good" rather than "sketchy" is
everything the register does *not* fix: one dominant stroke weight with thinner
arrows, a light-tint fill under a dark stroke of the same hue (Excalidraw's
palette is built that way: stroke shade index 4, fill shade index 1), three or
four hues at most, small text kept off small shapes (Excalidraw silently halves
roughness under 20 × 50 px because wobble at that size is noise), and a
hand-drawn *typeface* — every exemplar uses one, and the house pair uses none.
That last item is the only material register delta: the exemplars and the
editor read as hand-drawn chiefly through Virgil/Excalifont; a Nunito-labelled
diagram at `roughness 1` reads as a clean diagram with slightly wobbly boxes.

## 2. Roughness and sloppiness

**What the three levels are.** Excalidraw exposes rough.js's `roughness` as three
presets: `ROUGHNESS = { architect: 0, artist: 1, cartoonist: 2 }`; the default
element props set `roughness: ROUGHNESS.artist` (constants, pinned bundle:
`artist:1,cartoonist:2`). The UI deliberately offers *only* these three — the
2020 PR that introduced the property strip wrote "Reduced the number of options
dramatically. This way there's no choice paralysis … For Sloppiness, just
'Draftsman', 'Artist', 'Cartoonist'" ([PR #192]). rough.js itself documents
roughness as "A rectangle with the roughness of 0 would be a perfect rectangle.
Default value is 1. There is no upper limit to this value, but a value over 10 is
mostly useless" ([rough.js wiki]).

**Roughness is not a flat multiplier — Excalidraw adapts it to size.** The
pinned bundle contains (`adjustRoughness`, from `packages/element/src/shape.ts`):

```ts
// don't reduce roughness if
if (
  // both sides relatively big
  (minSize >= 20 && maxSize >= 50) ||
  // is round & both sides above 15px
  (minSize >= 15 && !!element.roundness && canChangeRoundness(element.type)) ||
  // relatively long linear element
  (isLinearElement(element) && maxSize >= 50)
) { return roughness; }
return Math.min(roughness / (maxSize < 10 ? 3 : 2), 2.5);
```

So a 12 px timeline dot at `roughness 1` renders at 0.5; under 10 px at 0.33.
This was introduced in [PR #6698] ("renderer tweaks", Oct 2023: default stroke
width 1 → 2, default fill hachure → solid, adaptive roughness, edges kept
continuous below cartoonist) "to improve legibility" of small shapes, then
softened in [PR #7250] after [issue #7239] ("Adaptive roughness reduces
hand-drawn feel") and [issue #7231] (horizontal cartoonist arrows rendered
straight). Two consequences for authoring:

- Small shapes and short arrows *cannot* be made to look as rough as large ones;
  the register's roughness is a ceiling, not a value. A panel of 16 px dots and
  40 px arrows will read as "architect" whatever the register says.
- The maintainers' own judgement, recorded in code: wobble on small geometry is
  noise. The skill's "Roughness 2 stays unused: past 1 the shake reads as noise"
  is the same call one notch up.

**Vertices are pinned below cartoonist.** `preserveVertices: continuousPath ||
element.roughness < ROUGHNESS.cartoonist` — at `roughness 0` and `1` the corners
of a rectangle land exactly where the geometry says; only cartoonist lets the
end points wander. This is why `roughness 1` boxes still stack and align cleanly
and why arrows still meet their bindings. Ellipses additionally get
`curveFitting = 1` so their rendered extent matches their bounds.

**Seeding.** `seed: element.seed` is passed to rough.js so the wobble is stable
across re-renders ([rough.js wiki]: "sets the seed for creating random values …
between 1 and 2^31"). Excalidraw declined a "reseed" button on principle — "our
guiding principle for Excalidraw is to get the defaults right, and offer limited
customization for the rest" ([issue #1978]). For the pipeline: a deterministic
seed per element gives reproducible PNGs; a *shared* seed across siblings makes
identical shapes wobble identically, which reads as copy-paste. Excalidraw
assigns a fresh random seed per element.

**Multi-stroke is the "hand-drawn" tell, and it is off for dashed/dotted.**
rough.js draws each outline twice by default (`disableMultiStroke: false`);
Excalidraw sets `disableMultiStroke: element.strokeStyle !== "solid"` "because it
tends to make dashes/dots overlay each other", and compensates with
`strokeWidth + 0.5` "to make it visually similar to solid strokes" (comments in
`generateRoughOptions`). A dashed provisional card therefore looks *cleaner* than
its solid neighbours — single stroke, slightly heavier — which is the visual
grammar the skill's "dashed = provisional" already relies on.

**When sketchiness helps, when it hurts (evidence).**

- Schumann, Strothotte, Raab & Laser, *Assessing the Effect of Non-photorealistic
  Rendered Images in CAD* (CHI '96): sketched renderings of the *same* design
  were preferred for early drafts and produced more, and more critical,
  discussion between architect and client, because a sketch reads as preliminary
  and therefore open to change ([CHI 96]; the study Wood et al. cite as their
  motivation). This is the whole case for a hand-drawn register on a
  working document — and the whole case against it on anything the reader must
  take as settled.
- Wood, Isenberg, Isenberg, Dykes, Boukhelifa & Slingsby, *Sketchy Rendering for
  Information Visualization* (IEEE TVCG 2012): "relative area judgment is
  compromised by sketchy rendering and … its influence is dependent on the shape
  being rendered"; sketchiness "may be judged on an ordinal scale but … its
  judgement varies strongly between individuals"; "where a visualization is
  clearly sketchy, engagement may be increased and … attitudes to participating
  in visualization annotation are more positive" ([Wood 2012]). Translation:
  sketchy is fine for structure and flow, wrong for anything a reader must
  *measure* — which is exactly the skill's "drop to `roughness 0` where
  precision is the content: chart axes, real numbers".
- Excalidraw's own adaptive-roughness code (above) is the practitioner version:
  below ~20 × 50 px the wobble stops being charm.
- A 2026 review of the tool for academic use makes the audience point bluntly:
  "The hand-drawn style reads as unfinished to a significant fraction of
  reviewers regardless of your intent" ([Augmented Scholar]) — the register is a
  claim about epistemic status, and the reader decides whether it was earned.

## 3. Fill

**Solid is the modern default; hachure was the old one.** [PR #6698] changed the
default `fillStyle` from `hachure` to `solid` (Oct 2023). rough.js's own default
is `hachure` ("sketchy parallel lines with the same roughness as defined by the
roughness and the bowing properties") and it also offers `zigzag`, `cross-hatch`,
`dots`, `dashed`, `zigzag-line`; Excalidraw exposes only `solid`, `hachure`,
`cross-hatch` ([rough.js wiki]; pinned bundle). The pipeline's `fillStyle`
validator matches that trio.

**Hachure geometry is tied to stroke width.** Excalidraw pins
`fillWeight: strokeWidth / 2` and `hachureGap: strokeWidth * 4` explicitly
"because if not specified, roughjs uses strokeWidth to calculate them (and we
don't want the fills to be modified)" when the dashed `+0.5` kicks in. So at
`strokeWidth 2` a hachure card is 1 px lines 8 px apart; at `strokeWidth 1` it is
0.5 px lines 4 px apart — which at 1× export is sub-pixel grey mush. Hachure is
only legible at width ≥ 2 and export scale ≥ 2.

**What the exemplars do.** Across all 231 published libraries, closed shapes are
67 % `solid`, 21 % transparent (outline only), 6 % `cross-hatch`, 5 % `hachure`
*(tally)*. Per library, the dominant fill is solid in 146, none in 48, hachure in
15, cross-hatch in 7. The two libraries that lean on hachure are wireframe kits
(`spfr/lo-fi-wireframing-kit`: 44 hachure vs 0 solid) and a system-design starter
(`pratheeshpm/basic-system-design`: 68 hachure vs 27 solid) — both places where
"placeholder" is the intended reading. The skill's "hachure means explicitly
unfinished" matches how the corpus uses it.

**Fill under a stroke.** Excalidraw's colour system is built so that the fill is
a *tint of the stroke's hue*: `DEFAULT_ELEMENT_STROKE_COLOR_INDEX = 4` and
`DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX = 1` on an open-color ladder sampled at
weights 50/200/400/600/800 ([colors.ts]). The redesign rationale: "the default
shade for background will be ~one shade lighter than the stroke. Stroke needs
more contrast, while background needs to be less strong … the common case is
that you create a container with a background, and want to pick a matching
stroke color which is still distinguishable from the background" ([issue
#5931]). The 2020 first cut used open-color 9 for stroke, 6 for fill, 0 for
canvas ([PR #378], [Open Colors blog]). The house palette derives fills from
strokes by OKLCH lightness-snapping (`L = 0.975`), i.e. the same idea taken one
step lighter than Excalidraw's index 1 (~weight 200). The practitioner guide
that circulates most widely says the same in plain words: "the shade of the
stroke should always be darker than the shade of the background … otherwise it
looks pretty dirty" ([Hazeflow]).

## 4. Stroke width and export scale

**Three widths, default 2.** `STROKE_WIDTH = { thin: 1, bold: 2, extraBold: 4 }`
in the UI (property strip: "Thin", "Bold", "Extra Bold" — [PR #192]); the default
became 2 in [PR #6698]. Frames render at `strokeWidth 2`, `roughness 0`, `#bbb`
(`FRAME_STYLE`, pinned bundle) — Excalidraw's own containers are *not* sketchy.

**What the exemplars do.** Element stroke widths across the corpus: 1 → 51 %,
2 → 34 %, 4 → 15 % *(tally)*; dominant width per library: 1 in 140 libraries,
2 in 56, 4 in 31. Arrows specifically: 1 → 45 %, 2 → 39 %, 4 → 16 %. Most of the
corpus predates the 2023 default change (which explains the width-1 majority),
but the *hierarchy* is consistent in the diagram-oriented libraries: shapes at
one weight, arrows at the same or thinner, never thicker. The Hazeflow guide
says of arrows: "Try to always use the smallest width. Bigger widths look ugly in
most cases, unless you have a specific concept in mind." The baseline survey
flagged "stroke-weight hierarchy (`strokeWidth` is register-only)" as silent in
the skill; the exemplars supply the rule: **arrows ≤ shapes, structure lines ≤
arrows, one step apart at most.**

**Export scale.** Excalidraw's export dialog offers `EXPORT_SCALES = [1, 2, 3]`
(pinned bundle `Cs=[1,2,3]`); `exportPadding` defaults to 10 ([export docs]).
Strokes are vector: a `strokeWidth 1` line at 1× is one device pixel, and a
hachure at width 1 is half a pixel. The pipeline's `render.js` rasterises at
`--scale` (default 2) via `deviceScaleFactor` and pins `exportScale: 1` inside
`exportToSvg` so the SVG's declared size is not doubled (`tools/page.js`
comment). At 2× a width-2 stroke is 4 device px — the weight a marker on a
whiteboard has — and width-1 arrows are 2 px, which is the thinnest that still
reads as drawn rather than ruled. Anything the pipeline emits below `strokeWidth
1` (author.js accepts any positive number) will be sub-pixel at 1× and should be
refused or clamped at export.

**Arrowheads scale with the arrow, not the stroke.** `getArrowheadSize` returns
25 for `arrow`, 12 for `diamond`, 15 otherwise; the actual head is
`min(size, lastSegmentLength × 0.5)` (0.25 for diamonds), and `circle` heads add
`strokeWidth - 2` to their radius ([bounds.ts]). A 30 px arrow therefore gets a
15 px head — half its length — and a `strokeWidth 4` arrow gets the *same* 25 px
head as a `strokeWidth 1` one, so heavy arrows look blunt and thin long arrows
look fine. Keep arrows ≥ ~60 px if the head must read as a head, and do not use
`extraBold` on arrows.

## 5. Fonts

**The 2024/25 font change and what each family is for.** [PR #8012] ("introduce
font picker", shipped in 0.18.0) replaced Virgil with **Excalifont** ("taken
Virgil and made small changes here and there to improve legibility" — Excalidraw
on X, 2024; the font page: "carefully curated to improve legibility while
preserving its hand-drawn nature", OFL-1.1 — [Excalifont]), and deprecated
Virgil, Helvetica and Cascadia: "retained for backward compatibility but hidden
by default … shown once element with this font is used in the scene". The picker's
three quick picks map role → family (pinned bundle and `FontPicker.tsx`):

| role label | family | `fontFamily` id |
|---|---|---|
| Hand-drawn | Excalifont | 5 |
| Normal | Nunito | 6 |
| Code | Comic Shanns | 8 |

plus Lilita One (7, heading) and Liberation Sans (9, server-side fallback). The
pinned metadata marks `Virgil`, `Helvetica` and `Cascadia` `deprecated: true`;
Cascadia was *re-added with ligatures* in [PR #8291] — which is exactly the
`!=` → `≠` reshaping the skill's anti-pattern list warns about. Line heights per
family (pinned `FONT_METRICS`): Excalifont 1.25, Nunito **1.35**, Comic Shanns
1.25, Cascadia 1.2, Lilita One 1.15. Default font size is 20 (`ut=20`), default
family Excalifont (`Ft=Ie.Excalifont`).

**Why a handwritten face matters more than roughness.** Every widely-copied
exemplar uses one. In the corpus, text elements are 72 % Virgil (1), 11 %
Excalifont (5), 9 % Cascadia (3), 7 % Helvetica (2), <1 % Comic Shanns/Nunito
*(tally)* — i.e. 83 % hand-drawn faces, 7 % clean sans. The 2021 font search
([issue #2945]) records the trade-off: Virgil "has been an important part of the
success of Excalidraw" yet "can be hard to read", and the requirement was still
"handwritten look and feel". Rohde's sketchnoting practice is built on lettering
as the carrier of hierarchy and voice: "The crossover between drawing and the
writing might be lettering … making them bolder or compressed or wider or scripty
… that just draws attention to those items and gives them emphasis over other
things" ([Rohde, ImageThink]). A sans-serif label on a wobbly box is the one
combination none of the exemplars use.

**Legibility limits of the hand-drawn face.** The reason Excalifont exists is
that Virgil failed at small sizes and in dense labels; the maintainers' fix was a
new face, not a smaller roughness. If the house pair ever gains a hand-drawn
face, it belongs on titles and short labels (the skill's `title`/`label` rungs)
and not on the `sublabel` rung, on code, or on numbers.

## 6. Colour on the hand-drawn register

- **Curated, few, tinted.** Excalidraw offers 13 hues × 5 shades and a quick-pick
  of exactly five per role: stroke `black, red[4], green[4], blue[4], yellow[4]`,
  fill `transparent, red[1], green[1], blue[1], yellow[1]` ([colors.ts]). The
  stated reason: "we want to pick a set of colors that all look good by default …
  avoid a full color picker … to retain simplicity, reduce decision paralysis,
  and promote consistency!" ([issue #5931]). The canvas picks are near-white
  (`#ffffff`, `#f8f9fa`, `#f5faff`, `#fffce8`, `#fdf8f6`); the house canvas
  `#FCFCFB` is in that family.
- **How many colours a good diagram uses.** Distinct stroke+fill colours per
  library: median 9, p25 3, p75 16 *(tally)* — but that counts icon packs with
  brand colours. The diagram-oriented libraries sit lower: `decision-flow-control`
  4, `data-flow` 3, `systems-design-components` 4, `stick-figures` 5,
  `basic-ux-wireframing` 5; the maximalist `basic-system-design` hits 37 and is
  the one that looks like a sticker sheet. Three to five hues with the black ink
  is where the well-regarded ones land; the house palette's six roles + grey is at
  the top of that range, which is fine only because "one colour, one meaning" is
  enforced.
- **Black ink dominates.** 39.5 % of shape strokes are `#000000` and 11 % the
  newer `#1e1e1e` *(tally)*; colour is the exception that marks something. Roam's
  and Rohde's practice is the same: ink first, colour to *point*.
- **Dark export is a filter, not a palette.** Excalidraw's dark theme applies
  `invert(93%) hue-rotate(180deg)` to the whole canvas (pinned bundle
  `THEME_FILTER`), and `exportWithDarkMode` reuses it. Tinted fills survive that
  filter badly (a pale tint becomes a dark muddy tint), which is why the skill's
  palette.md scores dark exports separately.
- **Contrast floors the hand-drawn register does not relax.** The Hazeflow guide's
  "stroke darker than background" and Excalidraw's shade ladder are the same
  rule; the house `tools/palette.js` gates (4.5:1 body text on fill, 3:1 stroke
  on canvas and on own fill) are stricter than anything in the exemplars and
  should stay.

## 7. Arrowheads

- **Default is `arrow`; most arrows carry one head.** `currentItemEndArrowhead:
  "arrow"`, `startArrowhead: null` by default (pinned bundle). In the corpus:
  end heads `arrow` 57 %, `null` 21 %, `triangle` 20 %, `dot` 1 %; start heads
  `null` 95 % *(tally)*. Two-headed arrows are rare; a bare line (`null`/`null`)
  is the second-commonest arrow and means "connected".
- **Triangle is the exemplars' emphatic head**, used wholesale in
  `basic-system-design` (35 triangle vs 1 arrow) — one library, one head, which
  is the skill's "set them once instead of per arrow".
- **Excalidraw 0.18.1 has more heads than the pipeline validates**: `bar`,
  `circle`, `circle_outline`, `triangle_outline`, `diamond`, `diamond_outline`,
  and the crow's-foot family (`crowfoot_one`, `crowfoot_many`,
  `crowfoot_one_or_many` — all present by name in the pinned bundle; master has
  since renamed them `cardinality_*`, [bounds.ts] `getArrowheadSize`). The register
  validator (`tools/author.js`) accepts `null | arrow | triangle | diamond | circle
  | bar`. Not a defect — the skill's arrowhead table maps exactly those six to
  meanings — but a data-model diagram could use crow's feet if the vocabulary
  ever grows.
- **Head size is fixed per type, not per stroke** (§4): a `strokeWidth 4` arrow
  has a visibly under-sized head. The exemplars do not put `extraBold` on arrows
  (16 % of arrows at width 4, almost all in one icon pack).

## 8. What the exemplars do

**Census method.** `libraries.json` from `excalidraw/excalidraw-libraries`
(231 entries) → each `.excalidrawlib` fetched raw → 4 134 library items,
53 119 elements tallied by type-appropriate property. Bias to state up front:
the corpus is dominated by icon packs (AWS, Azure, GCP, Snowflake) drawn at
`roughness 0` with brand colours, and most of it predates the 2023 default change
and the 2024 fonts. Aggregates therefore under-state roughness 1 / width 2 /
Excalifont relative to what a *new* diagram in the editor gets. The per-library
rows below are the diagram-oriented subset and are the better exemplar signal.

| library (source) | n | roughness | strokeWidth | fill | end head | font | colours |
|---|---|---|---|---|---|---|---|
| System Design Template (aretecode) | 106 | 1:53 2:49 | 1:102 | hachure 24 / solid 20 / none 16 | arrow 6 / null 6 | Virgil, Cascadia for code | 22 |
| System Design Components (rohanp) | 193 | 1:162 0:30 | 1:193 | solid 125 | arrow | Virgil | 12 |
| Software Architecture (youritjang) | 41 | 1:35 | 1:38 | solid 19 | — | — | 15 |
| Stick Figures (youritjang) | 78 | 1:71 | **2:61** | none 13 | — | — | 5 |
| Sticky Notes (ferminrp) | 26 | 1:26 | 1:26 | — | — | — | 16 |
| Decision flow control (aretecode) | 64 | 1:40 2:24 | **2:64** | none | null 24 / arrow 9 / dot 7 | Virgil | **4** |
| Data Flow (wmartzh) | 7 | 1:7 | 1:7 | solid | — | Virgil 20px | **3** |
| C4 Architecture (dmitry-burnyshev) | 34 | 1:20 2:14 | 1:34 | solid 28 | arrow | Virgil/Cascadia/Helvetica | 11 |
| Architecture diagram components (anna-pastushko) | 62 | **0:62** | 2:52 | cross-hatch 15 / solid 14 | — | Virgil 20px | 12 |
| Basic system design (pratheeshpm) | 203 | 1:189 | 1:203 | hachure 68 / solid 27 | **triangle 35** | Virgil | 37 |
| Lo-Fi Wireframing Kit (spfr) | 187 | 1:166 | 1:180 | none 64 / hachure 44 | arrow | Virgil 13px | 16 |
| Cloud Design Patterns (michelcaradec) | 152 | 1:152 | 1:138 | solid 56 | arrow 40 | Virgil 16px | 12 |
| Hexagonal Architecture (corlaez) | 476 | 1:353 0:120 | 1:465 | solid 173 | null 37 / arrow 27 | Virgil 20px | 22 |
| Flow Chart Symbols (finfin) | 23 | 1:23 | 2:23 | none | — | Virgil 20px | 10 |
| Systems Design Components (arach) | 87 | 0:56 1:31 | 1:81 | solid 42 | arrow | Virgil 16px | **4** |
| Network topology icons (dwelle, maintainer) | 98 | **0:98** | 2:68 | solid | — | — | 5 |
| Universal UI kit (manuelernestog) | 82 | 1:73 | 2:81 | none 20 / solid 13 | — | Virgil 20px | 9 |

Patterns that survive the bias:

1. **Artist everywhere, architect for icons.** Per-library dominant roughness:
   1 in 132 libraries, 0 in 82, 2 in 15. The `0` libraries are icon packs and
   component stencils (including the maintainer's own network icons); the
   diagrams are `1`. Cartoonist appears as a *minority* within a library
   (aretecode mixes 1 and 2), never as the voice of a well-regarded one.
2. **One weight per library.** Every row above is ≥ 90 % one stroke width; the
   figure/flow libraries pick 2, the dense component libraries pick 1.
3. **Solid or none; hachure means placeholder.** Wireframe kits and the
   "starter" system-design pack are the hachure users.
4. **Sharp corners, mostly.** 84 % of closed shapes have `roundness: null`
   *(tally)* — though the editor's default is `round` (`currentItemRoundness:
   "round"`, adaptive radius), so new diagrams drawn by hand are rounder than
   the library corpus.
5. **A hand-drawn face on every label.** No diagram-oriented library uses
   Helvetica or Nunito as its primary face; Cascadia appears only for code
   snippets inside System Design Template and C4.
6. **Sizes cluster at 16 and 20** (23 % of text at 20, 15 % at 16, then 36 and
   28 for titles *(tally)*): a two-rung body and a title rung, which is the
   skill's ramp with `sublabel` folded into `label`.

**The circulating practitioner guide** ([Hazeflow], "How to create beautiful
diagrams", 2025) is secondary but widely shared and consistent with the census:
stroke darker than fill; four sizes S/M/L/XL with "Always use S for small
objects and for text on arrows … L for subtitles and text on large objects … XL
for titles"; arrows "the same color that most of your diagram contains, although
we usually stick with black"; arrow width "always the smallest"; sloppiness "the
third is a handwritten line by a five-year-old"; positioning is a *second pass*
after the relationships are right ("change the positioning but keep the
structure the same").

**ByteByteGo.** The brief names it; its diagrams are not Excalidraw (the author
lists Excalidraw as a tool he *recommends* for interviews, not one he draws
with — [ByteByteGo comments]) and the recognisable traits others describe are
"high information density, no visual noise … arrows that don't cross when they
don't need to" ([YesPress]). What transfers is composition, not finish: white
ground, uniform node size within a layer, one reading direction, numbered steps
on the arrows.

## 9. Sketchnoting and visual-thinking guidance

- **Hierarchy and white space carry the picture, not the pen.** Rohde: "You've
  got a hierarchy of structure that you're working with"; "White space refocuses
  your attention on the things that are in the space — it's part of the image as
  much as the drawing is"; "When you really put too much information on a page,
  it's really hard to consume … if they don't know where to begin … they may
  never begin" ([Rohde, ImageThink]). His *Sketchnote Handbook* reduces drawing to
  five elements — square, circle, triangle, line, dot — and separates *structure*
  from *art*: "Kids draw to express ideas. They don't worry about how perfect
  their drawings are, as long as their ideas are conveyed" (p. 15, via [Bruff]).
  The imperfection is allowed, not aimed for: "if it's imperfect … that just
  says it wasn't a machine that made it" — said of lettering he then *corrects*
  for weight balance ([Rohde, Art Toolkit]).
- **Match the picture to the question.** Roam's "Basic Six": portrait for
  who/what, chart for how much, map for where, timeline for when, flowchart for
  how, multi-variable plot for why ([Roam, Ten Commandments]); "Don't worry about
  what your picture looks like, concentrate on what it shows"; "Draw a
  conclusion … push that pen one more time to write a title". This is the
  skill's idea → pattern table and its "a diagram argues", with an independent
  pedigree.
- **Where sketchiness hurts, per the studies (§2):** quantities, areas, anything
  compared by size; dense graphs where every edge wobbles (the multi-stroke
  doubles the ink of every crossing); thin strokes at 1× export where the second
  stroke of the pair becomes a grey halo; small text on small shapes, which
  Excalidraw itself de-roughens.

## 10. Register delta

| property | shipped register | Excalidraw 0.18.1 default | exemplar practice | verdict |
|---|---|---|---|---|
| `roughness` | 1 | 1 (`artist`) | 1 for diagrams, 0 for icon packs, 2 only as a minority accent | **match.** Keep; note the adaptive floor (§2) — small elements render at ½–⅓ regardless. |
| `fillStyle` | `solid` | `solid` (since #6698) | solid 67 %, transparent 21 %, hachure = placeholder | **match.** The skill's "hachure = unfinished" is the corpus's usage. |
| `strokeWidth` | 2 | 2 (`bold`) | 1 or 2 per library, arrows ≤ shapes | **match on shapes; silent on arrows.** Exemplars thin arrows one step; the register applies 2 to everything STROKED. |
| `strokeStyle` | `solid` | `solid` | 98 % solid | match. |
| arrowheads | `arrow` end, `null` start | same | 57 % arrow / 21 % none / 20 % triangle; 95 % no start head | match. |
| `roundness` | not in register (pass-through) | `round` (adaptive radius) | 84 % sharp in libraries | **unset.** Editor and corpus disagree; the pipeline has no house position. |
| prose font | Nunito (6) | Excalifont (5) is default; Nunito is the "Normal" pick | 83 % hand-drawn faces (Virgil/Excalifont) | **the material delta.** The exemplars read as hand-drawn through the *type*; the register reads as hand-drawn through the *outline* only. |
| code font | Cascadia (3) | Comic Shanns (8) is the "Code" pick; Cascadia is `deprecated`, re-added *with ligatures* (#8291) | Cascadia for code snippets in the two libraries that have code | **defensible, with a known cost** — the ligature reshaping the skill already warns about is the price of the deprecated face; Comic Shanns is the upstream answer and has no ligatures. |
| line height | per-family upstream | Nunito 1.35, Cascadia 1.2, Excalifont 1.25 | — | Nunito's 1.35 is the tallest in the set; a Nunito label needs ~8 % more card height than the same text in Excalifont. |
| colour | 6 roles + grey, fills by OKLCH snap | 5 quick picks, fill = stroke hue at shade 1 | 3–5 hues in the good ones | **match in mechanism**, at the upper bound in count. |
| opacity tiers | 100/50/20 | — | opacity used for ghosts in wireframe kits | no upstream position; keep. |

**The one recommendation that changes something:** the register's hand-drawn
signal is carried by the outline alone; Excalidraw's, and every exemplar's, is
carried mostly by the typeface. Either accept that the house voice is "clean
type on a sketched line" (a legitimate register — Excalidraw offers Nunito as a
first-class pick precisely for it) and say so in the skill, or add Excalifont to
the house pair for the `title` rung only, where legibility at 28–48 px is not in
question. Not a fork to decide in a research ticket; it is the fork the ticket
surfaces.

## 11. Rendering constraints the pipeline must respect

1. **Adaptive roughness floor.** Elements under `min 20 × max 50` px (or lines
   under 50 px) render at roughness ÷ 2 (÷ 3 under 10 px). A register cannot make
   a small element look rough, and a gate that compares "register roughness" to
   rendered output would be wrong on small shapes.
2. **Vertices are exact below cartoonist.** `preserveVertices` is on at roughness
   0 and 1, so measured geometry and rendered geometry agree at corners and
   bindings; at 2 they do not. Another reason 2 stays out of the register.
3. **Dashed/dotted disable multi-stroke and add 0.5 to the width.** A dashed
   element at `strokeWidth 2` is drawn at 2.5 single-stroke; hachure inside it
   keeps `fillWeight 1`, `hachureGap 8` (computed from the *unmodified* width).
4. **Hachure legibility is `strokeWidth × scale`.** Lines are `strokeWidth / 2`
   wide, `strokeWidth × 4` apart; at width 1, 1× export they are half a pixel.
   If hachure is ever allowed as a register value, require width ≥ 2 or export
   scale ≥ 2.
5. **Arrowhead size is `min(25, 0.5 × lastSegment)` for `arrow`** (12/0.25 for
   diamond, 15 otherwise) and ignores stroke width. Short final segments shrink
   heads; heavy strokes do not grow them. Orthogonal routes whose last segment is
   short (e.g. `standoff`-length) land with a stubby head.
6. **Export scale is a raster multiplier over vector strokes.** `render.js`
   defaults to 2 with `exportScale: 1` pinned in the SVG; `EXPORT_SCALES` upstream
   is 1/2/3. Any width below 1 is sub-pixel at 1× and should be refused by the
   register validator (today it accepts any positive number).
7. **Fonts: Cascadia is `deprecated` in 0.18.1 and ships ligatures.** It renders
   (deprecated fonts are hidden from the picker, not removed) and is vendored by
   `tools/fonts.js`, so the pipeline is safe; the ligature reshaping is inherent
   to the face, not a bug to fix downstream. Nunito's line height is 1.35, the
   tallest of the vendored four — card heights follow it.
8. **Dark export is `invert(93%) hue-rotate(180deg)` over the whole canvas**, not
   a second palette. Tints chosen for white ground are not chosen for dark; the
   palette gate's separate dark scoring must stay.
9. **Seeds must be per element and stable.** rough.js takes `seed` 1…2³¹;
   Excalidraw generates one per element. Reusing a seed across identical
   siblings makes them wobble identically, which reads as duplication; omitting
   it makes renders non-reproducible.
10. **Frames are architect.** Upstream `FRAME_STYLE` is `roughness 0`,
    `strokeWidth 2`, `#bbb`, radius 8, name at 14 px — a sketched frame border
    would be off-voice for the editor and for every export a user compares against.

## Sources

- [PR #192]: https://github.com/excalidraw/excalidraw/pull/192 — property strip: three fills, three widths, three sloppiness levels.
- [PR #378]: https://github.com/excalidraw/excalidraw/pull/378 — open-color adoption (stroke 9, fill 6, canvas 0).
- [Open Colors blog]: https://blog.excalidraw.com/open-colors
- [issue #1978]: https://github.com/excalidraw/excalidraw/issues/1978 — reseed declined; "get the defaults right".
- [issue #2945]: https://github.com/excalidraw/excalidraw/issues/2945 — search for a more legible handwritten font.
- [issue #5931]: https://github.com/excalidraw/excalidraw/issues/5931 — colour-picker redesign rationale (5 shades, fill one shade lighter than stroke).
- [PR #6216]: https://github.com/excalidraw/excalidraw/pull/6216 — colour picker redesign.
- [PR #6698]: https://github.com/excalidraw/excalidraw/pull/6698 — renderer tweaks: default width 2, default fill solid, adaptive roughness.
- [issue #7231]: https://github.com/excalidraw/excalidraw/issues/7231 · [issue #7239]: https://github.com/excalidraw/excalidraw/issues/7239 · [PR #7250]: https://github.com/excalidraw/excalidraw/pull/7250 — adaptive roughness pushback and softening.
- [PR #8012]: https://github.com/excalidraw/excalidraw/pull/8012 — font picker; Excalifont; Virgil/Helvetica/Cascadia deprecated.
- [PR #8291]: https://github.com/excalidraw/excalidraw/pull/8291 — Cascadia re-added with ligatures. [PR #8641]: https://github.com/excalidraw/excalidraw/pull/8641 — Comic Shanns fixes.
- [CHANGELOG 0.18.0]: https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/CHANGELOG.md
- [shape.ts]: https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/shape.ts — `generateRoughOptions`, `adjustRoughness` (verified identical in the pinned 0.18.1 bundle).
- [bounds.ts]: https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/bounds.ts — `getArrowheadSize`, `getArrowheadPoints`.
- [colors.ts]: https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/colors.ts — palette indexes and quick picks.
- [FontPicker.tsx]: https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/FontPicker/FontPicker.tsx — `DEFAULT_FONTS` role → family.
- Pinned bundle: `node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js` (0.18.1) — `ROUGHNESS`, `FONT_FAMILY`, `FONT_METRICS`, `FRAME_STYLE`, `EXPORT_SCALES`, `THEME_FILTER`, default app state.
- [export docs]: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export
- [Excalifont]: https://plus.excalidraw.com/excalifont · Excalidraw on X, 25 Jul 2024: https://x.com/excalidraw/status/1816545048689086823
- [rough.js wiki]: https://github.com/rough-stuff/rough/wiki
- [draw.io rough style]: https://www.drawio.com/blog/rough-style — the other rough.js diagrammer: exposes jiggle, fill weight, hachure gap/angle, multi-stroke toggles; "comic" = subtler single-stroke.
- Library census: https://github.com/excalidraw/excalidraw-libraries (`libraries.json` + `libraries/*.excalidrawlib`, fetched 2026-08-26).
- [CHI 96]: Schumann, Strothotte, Raab, Laser, "Assessing the Effect of Non-photorealistic Rendered Images in CAD", CHI '96, pp. 35–42.
- [Wood 2012]: Wood, Isenberg, Isenberg, Dykes, Boukhelifa, Slingsby, "Sketchy Rendering for Information Visualization", IEEE TVCG 18(12), 2012 — https://doi.org/10.1109/tvcg.2012.262 (open PDF: https://openaccess.city.ac.uk/id/eprint/1274/).
- [Rohde, ImageThink]: https://www.imagethink.net/sketchnoting-ask-the-expert-fireside-chat-with-mike-rhode/ · [Rohde, Art Toolkit]: https://www.youtube.com/watch?v=RZZq5W8FY2A · [Bruff]: https://derekbruff.org/2013/08/01/summer-reading-the-sketchnote-handbook-by-mike-rohde/ · *The Sketchnote Handbook* sample: https://ptgmedia.pearsoncmg.com/images/9780321857897/samplepages/0321857895.pdf
- [Roam, Ten Commandments]: https://www.theartof.com/articles/the-ten-and-a-half-commandments-of-visual-thinking · *The Back of the Napkin*: https://www.penguinrandomhouse.com/books/300247/
- [Hazeflow]: https://research.hazeflow.xyz/p/excalidraw-how-to-create-beautiful (secondary, practitioner).
- [Augmented Scholar]: https://augmentedscholars.com/tools/excalidraw/ (secondary, audience effect).
- [ByteByteGo comments]: https://blog.bytebytego.com/p/diagram-as-code/comments · [YesPress]: https://yespress.io/alex-xu-sahn-lam (secondary).
