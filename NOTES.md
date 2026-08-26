# Visual-design rules for diagrams — research notes (#186)

Wayfinder ticket [#186](https://github.com/Gharib89/aiworx-excalidraw-plugin/issues/186)
under map [#183](https://github.com/Gharib89/aiworx-excalidraw-plugin/issues/183).
Question: which concrete, checkable visual-design rules apply to diagrams, and
what is their delta against the shipped type ramp, register and palette rules.

Each rule below is one checkable statement, with the numeric value where the
source gives one. Tags: **[P]** primary source read directly; **[S]** secondary
(summary of a paywalled book, or a reproduction); **[D]** derived here from a
primary number plus a stated assumption. Sources are numbered in §9.

## 0 · What ships today (the baseline the deltas are measured against)

Read from `tools/presets.js`, `tools/layout.js`, `tools/author.js`,
`tools/verify.js`, `skills/excalidraw-diagram/reference/{palette,patterns,authoring}.md`
and the committed bundle.

| surface | preset | width × height | title | label | sublabel | title/label | label/sublabel |
|---|---|---|---|---|---|---|---|
| default | `fit` | none | 28 | 20 | 16 | 1.40 | 1.25 |
| doc column | `doc-inline` | 720 × 480 | 22 | 16 | 13 | 1.375 | 1.23 |
| full-width doc | `doc-wide` | 1200 × 675 | 28 | 20 | 16 | 1.40 | 1.25 |
| projected slide | `slide-16x9` | 1600 × 900 | 48 | 32 | 26 | 1.50 | 1.23 |
| Open Graph card | `social-og` | 1200 × 630 | 44 | 30 | 24 | 1.47 | 1.25 |

- **Register** (one per diagram): `roughness 1`, `fillStyle "solid"`, `strokeWidth 2`,
  `strokeStyle "solid"`. `strokeWidth` is register-only — no per-role hierarchy.
- **Depth**: three opacity tiers, 100 / ~50 / ~20; "a fourth tier reads as mud".
- **Palette**: six role hues + grey, fills snapped to OKLCH `L 0.975, C ≤ 0.034`;
  gate floors: text 4.5:1 on fill, stroke 3:1 on canvas and on own fill,
  fills ≥ 0.02 OKLab apart; scored in both themes.
- **Gate contrast rule** (`verify.js:423`): `fontSize >= 24 ? 3 : 4.5` — size only,
  weight ignored.
- **Layout defaults**: `stack` gap 0, `box` padding 20, `graph` gap 40 / layerGap 60,
  `arrowBetween` standoff 10.
- **`wrap` default** `fontSize = 18` — not a rung of any ramp.
- **Line height** is Excalidraw's per-font constant: Nunito 1.35, Cascadia 1.2
  (from `dist/excalidraw-page.js` font metrics).
- **patterns.md "Containers, sparingly"** still says "28 px title, 18 px body, 14 px
  caption"; the `fit` ramp is 28 / 20 / 16.
- **Silent**: colour count per picture, stroke-weight hierarchy, line-length and
  line-count maxima, minimum size per surface, spacing grid, whitespace balance.

## 1 · Type scale

1. **A type scale is a ratio applied repeatedly to a base**: golden section 1.618,
   perfect fifth 1.5, perfect fourth 1.333, major third 1.25, major second 1.125.
   Tim Brown, *More Meaningful Typography* [1] **[P]**; Bringhurst ch. 8 "Shaping the
   Page" is Brown's named source for modular scales [1].
2. **Material 3 uses a major second (1.125) from a 14 sp base**, producing
   11 · 12 · 14 · 16 · 22 · 24 · 28 · 32 · 36 · 45 · 57 sp (label-small → display-large)
   [2][3] **[P]**. "No single product will use all the styles"; a five-size subset is
   the illustrated reduction [2].
3. **Apple iOS Dynamic Type (Large, default)**: 34 · 28 · 22 · 20 · 17 · 17 · 16 · 15 · 13 · 12 · 11 pt
   (Large Title → Caption 2), leading 41 · 34 · 28 · 25 · 22 · 22 · 21 · 20 · 18 · 16 · 13 pt
   [4] **[P]**. Adjacent steps are 1.21 – 1.27 at the top and 1.08 – 1.09 in the body range.
4. **Refactoring UI hand-picked scale**: 12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 60 · 72 px;
   ratio-based scales are named (4:5 major third, 2:3 perfect fifth, golden) and
   rejected for UI because they yield fractional sizes and too few small steps
   [5 p.88] **[S]**.
5. **Adjacent scale values must differ by at least ~25 %** ("make sure no two values
   in your scale are ever closer than about 25 %") [5 p.60] **[S]**. Material states
   the same qualitatively: "provide impactful contrast between sizes by avoiding
   small differences" [2] **[P]**.
6. **Hierarchy is carried by size + weight + colour together, not size alone**
   [5 p.32 "Size isn't everything", p.48 "Balance weight and contrast"] **[S]**;
   Apple: "Adjust font weight, size, and color as needed" [4] **[P]**.
7. **Minimise the number of typefaces** ("Mixing too many different typefaces can
   obscure your information hierarchy") [4] **[P]**. Material splits *brand* typeface
   (Display/Headline) from *plain* typeface (Body/Label) — two at most [2] **[P]**.
8. **Avoid light weights for small text**: prefer Regular … Bold; avoid Ultralight /
   Thin / Light [4] **[P]**.
9. **Line height ≈ 1.5 × font size for body; smaller for large type** [5 p.105
   "Line-height is proportional"] **[S]**; WCAG 1.4.12 requires content to survive
   line-height 1.5 × [6] **[P]**. Apple: at three or more lines, do not tighten leading [4] **[P]**.

## 2 · Spacing and grid

10. **Material: all components align to an 8 dp grid; type and icons may align to a
    4 dp grid; padding is measured in 8 dp or 4 dp increments; margins and gutters are
    8, 16, 24 or 40 dp** [7][8] **[P]**.
11. **Spacing scale = factors and multiples of a base (16 px), dense at the bottom,
    sparse at the top**: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 192 · 256 … ;
    "a linear scale won't work" [5 p.60] **[S]**.
12. **Space between groups must exceed space within groups** ("Avoid ambiguous
    spacing") [5 p.83] **[S]**. Quantified by Kubovy & Wagemans: relative grouping
    strength decays as `e^(−α(d/d₀ − 1))`, α ≈ 6.6 across observers [9][10] **[P]** —
    so a between-group gap 1.5 × the within-group gap leaves ~4 % relative attraction,
    1.25 × leaves ~19 % **[D]**. Rule of thumb for a checker: **inter-group gap ≥ 1.5 ×
    intra-group gap**.
13. **Start with too much whitespace and remove until it is just enough** [5 p.56] **[S]**;
    Apple: "Make essential information easy to find by giving it sufficient space" [11] **[P]**.
14. **Align mixed sizes by baseline, not centre** [5 p.102] **[S]**.

## 3 · Colour count and colour use

15. **Categorical hue supports 6 – 12 discriminable bins *including background and
    highlights*** for non-contiguous small regions (Munzner, *VAD* ch. 10 lecture
    material) [12] **[P]**.
16. **Do not use more than ten colours for coding symbols if reliable identification is
    required**; estimates of rapidly perceivable codes are 5 – 10 (Ware, *Information
    Visualization* ch. 4, guideline G4.15; Healey 1996) [13] **[P]**. Ware's 12
    recommended codes: red, green, yellow, blue, black, white, pink, cyan, grey,
    orange, brown, purple [13]. Only eight colours plus white were consistently named
    in Post & Greene's 210-colour study [13].
17. **Small regions need high saturation; large regions need low saturation** (Ware
    G4.16, G4.17; Munzner) [12][13] **[P]** — pastel fields, saturated marks.
18. **Use a different colour only where it marks a difference of meaning** (Few, rule 4)
    and **only when it serves a communication goal** (rule 3) [14] **[P]**.
19. **Soft colours for most content, bright/dark only to highlight** (Few rule 5);
    **non-data components just visible enough** — thin grey axis lines, white background
    (rule 7) [14] **[P]**.
20. **Avoid red and green as the discriminating pair** (Few rule 8) [14] **[P]**;
    ensure variation in the yellow–blue direction (Ware G4.14) [13] **[P]**.
21. **Limit hue to 2 – 3 hues and vary value/chroma within them** for most designs
    (Stone, *Choosing Colors for Data Visualization*) [15] **[P]**; value (lightness)
    contrast, not hue, defines legibility [15].
22. **Add a luminance-contrasting border around a colour-coded symbol that may sit on a
    variety of backgrounds** (Ware G4.13) [13] **[P]**.
23. **WCAG 2.2 contrast**: text 4.5:1; *large-scale* text (≥ 18 pt = 24 px, or ≥ 14 pt
    bold = 18.66 px) 3:1; non-text graphical objects 3:1 against adjacent colours
    (1.4.3, 1.4.11) [6] **[P]**. AAA: 7:1 / 4.5:1 (1.4.6) [6].
24. **Colour-blind-safe categorical set of 8** (Okabe–Ito: vermilion, orange, yellow,
    bluish green, sky blue, blue, reddish purple, black); thin lines and small text in
    blue or yellow are hard to read for everyone — use darker blue / orange there [16] **[P]**.

## 4 · Stroke weight and visual weight

25. **Three line widths in the ratio 1 : 2 : 4** (narrow : wide : extra-wide), drawn from
    a 1 : √2 series (0.13 … 0.35, 0.5, 0.7, 1, 1.4, 2 mm); mechanical drawings normally
    use two widths at 1 : 2 (ISO 128-2:2022 §5.1; ISO 128-24:2014 §5) [17][18] **[P]**.
26. **Minimum space between parallel lines ≥ 0.7 mm**, i.e. ≥ 2 × the standard 0.35 mm
    line (ISO 128-2 §6.1) [17] **[P]** — a gap should be at least twice the stroke.
27. **Excalidraw's own stroke rungs are 1 / 2 / 4** (`thin` / `medium` / `bold`, with 8
    reserved), default `medium` = 2 (`packages/common/src/constants.ts`) [19] **[P]** —
    the same 1 : 2 : 4 ladder as ISO.
28. **Emphasise by de-emphasising**: make the secondary quieter rather than the primary
    louder [5 p.39] **[S]**; Few rule 5 and Stone's "grays and muted colours with a few
    high-chroma accents" say the same for data graphics [14][15] **[P]**.
29. **Pre-attentive pop-out requires a minority target**: colour, size, orientation and
    enclosure are detected in parallel; a highlight only works when few elements carry
    it (Ware ch. 4 on colour as nominal code; Few rule 5) [13][14] **[P]**. Checkable
    form: **one focal element per panel** carries the strongest weight.
30. **Labels are a last resort**: omit when the format is self-evident, otherwise
    render them as supporting content — smaller, lower contrast, lighter weight
    [5 p.41][20] **[P]** (preview chapter is public).

## 5 · Line length and line count

31. **45 – 75 characters per line for continuous single-column text; 66 ideal;
    40 – 50 for multi-column; 85 – 90 acceptable only for discontinuous text;
    justified text needs ≥ 40** (Bringhurst §2.1.2) [21][22] **[P]**.
32. **Marginal notes and other short text may run 12 – 15 characters per line**
    (measure summary citing Bringhurst) [23] **[S]**.
33. **Web equivalent: 20 – 35 em wide** [5 p.99] **[S]**.
34. **The longer the line, the more leading it needs; short measure tolerates less**
    [21][23] **[P/S]**.
35. **Slides: "6 × 6" — at most six lines, six words per line** (UC Merced accessibility
    checklist) [24] **[S]**; Kosslyn's "rule of four" — about four units of information per
    slide (*Clear and to the Point*, 2007) [25] **[S]**. Apple: at three or more lines
    stop tightening leading [4] **[P]**.
36. **Derived label rule [D]**: a node label wraps at ≤ ~35 characters (below Bringhurst's
    40 multi-column floor because a label is discontinuous text, above the 12 – 15
    marginal-note band) and runs ≤ 3 lines; a title runs ≤ 2 lines (Refactoring UI:
    centred text is fine only for "1 – 2 lines" [5 p.111] **[S]**).

## 6 · Whitespace balance and optical alignment

37. **Margins lock the text block to the page, frame it, and protect it**; a square block
    centred with even margins "isn't likely to encourage reading" — some space must be
    narrow so other space can be wide (Bringhurst ch. 8 "Shaping the Page") [26] **[P]**.
38. **Van de Graaf canon: margins 1/9 and 2/9 of the page, type area the same proportion
    as the page** (inner : top : outer : bottom = 2 : 3 : 4 : 6 on a 2 : 3 page); the type
    area is then 4/9 ≈ 44 % of the page [27] **[S]** — a usable "content occupies
    roughly half the surface" check.
39. **Optical, not mechanical, centring**: "visually center an icon where the visual
    weight is heaviest … mechanically centering doesn't work" (IBM Design Language) [28]
    **[P]**; Material icons: optical corrections only in extreme cases, never by skewing
    forms [29] **[P]**.
40. **Align components to make them scannable; alignment communicates hierarchy**
    (Apple HIG Layout) [11] **[P]**. "Grids are overrated" — fixed widths and
    scale-based spacing over a rigid column grid [5 p.72] **[S]**.
41. **Reading order = top-to-bottom, leading-to-trailing; place the most important item
    near the top-leading corner** (Apple HIG Layout) [11] **[P]**.
42. **Gestalt grouping factors, in the order the psychology names them**: proximity,
    similarity (colour, size, orientation), common fate, good continuation, closure,
    symmetry, parallelism (Wertheimer 1923) [30] **[P]**; **common region** — elements
    inside one bounded area group, and it beats proximity and colour similarity
    (Palmer 1992) [31] **[P]**; **element connectedness** — elements joined by a third
    group, beating proximity and similarity (Palmer & Rock 1994) [31][32] **[P]**.
    Checkable form: a frame (common region) or connector (connectedness) overrides
    distance, so an arrow into a box makes the two a group whatever the gap.

## 7 · Minimum legible size per surface

43. **WCAG sets no minimum font size**; size enters only through the 18 pt / 14 pt-bold
    large-text threshold that relaxes contrast to 3:1 [6] **[P]**.
44. **Apple minimums**: iOS 11 pt (default 17), macOS 10 pt (default 13), tvOS 23 pt
    (default 29), visionOS 12 pt, watchOS 12 pt [4] **[P]**. Material's smallest role is
    label-small 11 sp [3] **[P]**.
45. **Critical print size ≈ 0.2° x-height**; the fluent range is 0.2° – 2°; reading speed
    collapses below 0.2° and declines only gently above 2° (Legge & Bigelow 2011,
    *J. Vision*) [33] **[P]**. Conversion: `angle° = 57.3 × size / distance`; at 40 cm,
    `visual angle ≈ point size / 20` [33].
46. **Slides: ≥ 24 pt body in a physical room, ≥ 18 pt when everyone has the slides on
    their own screen** (U. Minnesota); **24 pt main points / 18 pt minimum** (Lancaster);
    **24 pt body / 36 pt headings / never below 18 pt** (UC Merced); **18 pt minimum,
    30 pt when projected** (Texas Tech); **18 pt or larger** (Microsoft) [24][34][35][36][37]
    **[S]** — consistent floor 18 pt, consistent body 24 pt.
47. **Slide points → preset pixels [D]**: a 16:9 PowerPoint page is 960 × 540 pt, so on
    the 1600 × 900 px preset `1 pt = 1.667 px`: **18 pt = 30 px, 24 pt = 40 px, 30 pt =
    50 px, 36 pt = 60 px**.
48. **Room check via Legge [D]**: for a 1600 px slide shown 2.4 m wide (1.5 mm/px), a
    reader at 8 m needs x-height ≥ 8000 × tan 0.2° ≈ 28 mm ≈ 19 px; with an x-height of
    ~0.5 em that is **≥ 38 px font size**; at 5 m, ≥ 24 px. So 26 px sublabels read
    from 5 m and not from 8 m.
49. **Doc check via Legge [D]**: at 96 dpi and 50 cm, 0.2° x-height = 1.75 mm ≈ 6.6 px ≈
    **13 px font size** — `doc-inline`'s 13 px sublabel sits exactly on the critical
    print size; 12 px is under it.
50. **Downscaled embeds [D]**: a 1200 px `doc-wide` figure placed in a ~720 px doc column
    renders at 0.6 ×, so its 16 px sublabel lands at ~10 px on screen — under Apple's
    10 – 11 pt floor and under rule 49. `social-og` at a ~500 px feed width renders its
    24 px sublabel at ~10 px. Size after embedding, not authored size, is what the eye
    gets.

## 8 · Delta against the shipped ramp, register and palette rules

### Type ramp

- **The ramps already are ratio scales**: label → sublabel is a major third (1.25) in
  three presets and 1.23 in two; title → label ranges 1.375 – 1.5 (between perfect
  fourth and perfect fifth). The ticket's "ratio vs 28/18/14" framing is moot: the
  shipped numbers *are* roughly a major third / perfect fourth-to-fifth ladder.
- **Two rungs break the 25 % floor** (rule 5): `doc-inline` 16 → 13 (+23 %) and
  `slide-16x9` 32 → 26 (+23 %). Moving to 16 → 12 and 32 → 24 restores ≥ 25 % and puts
  both on the Refactoring UI / Material scales — but 12 px breaks rule 49 for the doc
  column, so `doc-inline` should rather move to 22 / 17 / 13 or keep 13 and accept 23 %.
- **Off-scale values**: 13, 26, 44 are on none of the reference scales (Material,
  Apple, Refactoring UI); 20, 30, 48 are on Refactoring UI and Apple but not Material.
  Not a defect — Refactoring UI's whole point is hand-picking — but 26 and 44 have no
  external anchor.
- **The slide ramp is under the 24 pt convention** (rules 46 – 48): 32 px label ≈ 19 pt,
  26 px sublabel ≈ 15.6 pt — the sublabel is under every source's 18 pt floor and the
  label under the 24 pt body. A slide ramp that meets the guidance is ~**60 / 40 / 30**
  (36 / 24 / 18 pt); the smallest move that clears the floor is 48 / 40 / 30.
- **`patterns.md` names 28 / 18 / 14; the ramp is 28 / 20 / 16; `wrap` defaults to 18.**
  Three numbers for one concept — one document and one default should carry the ramp.
- **Gate's large-text rule ignores weight**: WCAG relaxes to 3:1 at 24 px *or* 18.66 px
  bold. The shipped rule is stricter, not wrong; noted so nobody "fixes" it the other way.
- **Nothing in the skill states a minimum size** (rules 43 – 50). A per-preset floor is
  checkable: `doc-inline` ≥ 13, `doc-wide` ≥ 16 *at embed scale*, `slide-16x9` ≥ 30,
  `social-og` ≥ 24 at 1200 px (≥ 11 at feed scale is unreachable; accept).
- **Line height** is Excalidraw's 1.35 (Nunito) / 1.2 (Cascadia) against a 1.5 body
  reference; fine for labels (short measure needs less, rule 34), tight for any
  3-line block.

### Register (finish, stroke, depth)

- **`strokeWidth` is flat at 2.** ISO and Excalidraw agree on a 1 : 2 : 4 ladder (rules
  25, 27). A **stroke hierarchy that mirrors the opacity tiers** is the natural delta:
  1 for scaffolding, leaders and non-data lines (Few rule 7), 2 for the register, 4 for
  the single focal element per panel (rule 29). Checkable: ≤ 3 distinct widths per
  diagram; ≤ 1 element per panel at width 4.
- **Gap-to-stroke**: parallel strokes need a gap ≥ 2 × stroke (rule 26) — at width 2
  that is ≥ 4 px, which `standoff 10` and `gap 40` already clear; an explicit rule would
  catch hand-placed shadows and stacked "gradient" shapes.
- **Depth tiers 100 / 50 / 20** have no external numeric source; the direction (three
  levels, then mud) matches Stone/Few's "muted field, few bright accents" but the
  numbers stay house convention.
- **Spacing defaults 20 / 10 / 40 / 60 are off every 8-grid and off the Refactoring UI
  scale** (rules 10, 11): the nearest on-scale set is padding 16 or 24, standoff 8 or 12,
  gap 32 or 48, layerGap 64. Cosmetic, but a grid rule cannot be stated while the
  defaults break it.
- **Grouping**: rule 12 (inter-group gap ≥ 1.5 × intra-group gap) is not stated anywhere;
  `stack`'s single `gap` cannot express it. Rule 42 is already implicit in "containers
  sparingly" and `frame` semantics; naming common region and connectedness would let
  the read-back prompt test them.

### Palette (colour count and use)

- **Total inventory is inside every ceiling**: 6 role hues + grey + ink + canvas = 9
  colours, under Ware's 10 and inside Munzner's 6 – 12 (rules 15, 16). Post & Greene's
  "eight nameable colours" is a nudge that six role hues is the practical maximum, not a
  starting point.
- **No per-picture or per-panel cap exists.** Stone's 2 – 3 hues (rule 21) and Few's
  rule 4 suggest a checkable **≤ 4 role hues per panel**, grey excluded, with the
  house's one-colour-one-meaning already doing Few's rule 4 globally.
- **Pastel fills + saturated strokes already implement rule 17** (large regions low
  saturation, small marks high). The fill snap `L 0.975` is the house's numeric form.
- **`fail` red and `pass` green are a red–green pair** (Few rule 8; Ware G4.14). The
  brand onboarding pins both by convention. They differ strongly in lightness
  (`#B61E24` vs `#6E9A21`) and the derived fills are checked ≥ 0.02 OKLab apart, which
  is the mitigation Few himself offers; a hue-only test (deuteranopia simulation) is
  the missing check. Okabe–Ito's move — bluish green rather than yellow-green — is the
  brand-override-compatible fix if it ever fails.
- **Gate floors are WCAG's** (rule 23) plus the OKLab distance rule WCAG lacks; no delta.
- **Ware G4.13 (contrasting border around a coded mark)** is what the house's dark
  stroke on a pale fill already does; stating it explains *why* a fill without a stroke
  is the wrong default.

## 9 · Sources

1. Tim Brown, "More Meaningful Typography", *A List Apart*, 2011 — https://alistapart.com/article/more-meaningful-typography/
2. Material Design 3, *Typography — Type scale tokens* (major second, 14 base; reduce styles) — https://m3.material.io/styles/typography/type-scale-tokens
3. Material Components Android, `docs/theming/Typography.md` (baseline sizes 57 … 11 sp) — https://github.com/material-components/material-components-android/blob/master/docs/theming/Typography.md ; Flutter `text_theme.dart` (sizes + line heights)
4. Apple Human Interface Guidelines, *Typography* (minimum sizes table; Dynamic Type specifications) — https://developer.apple.com/design/human-interface-guidelines/typography
5. Wathan & Schoger, *Refactoring UI* (2018), page numbers from the publisher's table of contents; content via reader summaries — https://refactoringui.com/
6. W3C, *WCAG 2.2*, SC 1.4.3, 1.4.6, 1.4.11, 1.4.12 — https://www.w3.org/TR/WCAG22/#contrast-minimum
7. Material Design (M2), *Spacing methods* (8 dp / 4 dp grids, padding increments) — https://m2.material.io/design/layout/spacing-methods.html
8. Material Design (M1), *Metrics & keylines*; *Responsive UI* (margins/gutters 8, 16, 24, 40 dp) — https://m1.material.io/layout/metrics-keylines.html
9. Kubovy & Wagemans, "Grouping by Proximity and Multistability in Dot Lattices", *Psychological Science* 6(4), 1995 — https://doi.org/10.1111/j.1467-9280.1995.tb00597.x
10. Kubovy, Holcombe & Wagemans, "On the Lawfulness of Grouping by Proximity", *Cognitive Psychology* 35, 1998 (slope ≈ −6.6) — https://doi.org/10.1006/cogp.1997.0673
11. Apple HIG, *Layout* — https://developer.apple.com/design/human-interface-guidelines/layout
12. Munzner, *Visualization Analysis and Design* ch. 10 lecture slides (author's site; "6–12 bins including background and highlights"; saturation vs region size) — https://www.cs.ubc.ca/~tmm/talks/vad/VAD-color.pdf
13. Ware, *Information Visualization: Perception for Design*, ch. 4 "Color" (G4.13 – G4.17; 12 recommended codes; Post & Greene) — https://courses.grainger.illinois.edu/cs519/fa2017/InfoVisPerceptionForDesign-Chapter4.pdf
14. Few, "Practical Rules for Using Color in Charts", *Visual Business Intelligence Newsletter*, Feb 2008 — http://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf
15. Stone, "Choosing Colors for Data Visualization", *B-EYE-Network*, 2006 — http://perceptualedge.com/articles/b-eye/choosing_colors.pdf
16. Okabe & Ito, *Color Universal Design* — https://jfly.uni-koeln.de/color/
17. ISO 128-2:2022, *Basic conventions for lines* §5.1, §6.1 (preview) — https://cdn.standards.iteh.ai/samples/83355/10bb39d36fc34caeb80ecd25347ddb0c/ISO-128-2-2022.pdf
18. ISO 128-24:2014, *Lines on mechanical engineering drawings* §5 (preview) — https://cdn.standards.iteh.ai/samples/57099/67be8e32461446f1a410ce15e3aea7ff/ISO-128-24-2014.pdf
19. Excalidraw, `packages/common/src/constants.ts` (`STROKE_WIDTH`, `DEFAULT_ELEMENT_PROPS`) — https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/constants.ts
20. Refactoring UI, public preview "Labels are a last resort" — https://refactoringui.com/previews/labels-are-a-last-resort
21. Bringhurst, *The Elements of Typographic Style* §2.1.2, quoted in full at *The Elements of Typographic Style Applied to the Web* — http://webtypography.net/2.1.2
22. Bringhurst 2004 ed. §2.1.2 facsimile (40-character justified minimum) — https://fliphtml5.com/ysvhh/nfju/
23. "Measure (typography)", Wikipedia (12 – 15 cpl marginal notes; leading vs measure) — https://en.wikipedia.org/wiki/Measure_(typography)
24. UC Merced, *Presentation Accessibility Checklist* (24 pt body, 36 pt headings, never < 18 pt; 6×6) — https://accessibility.ucmerced.edu/digital-accessibility/creating-content-checklists/presentation-accessibility-checklist
25. Kosslyn, *Clear and to the Point: 8 Psychological Principles for Compelling PowerPoint Presentations*, OUP 2007 (rule of four, via summaries)
26. Bringhurst, ch. 8 "Shaping the Page" (facsimile) — https://www.uwosh.edu/faculty_staff/jager/Shaping_The_Page.pdf ; *Pocket Bringhurst* summary — https://cdnc.heyzine.com/files/uploaded/v3/50c603cb9a4d5366180c41f0659899c378d03395.pdf
27. "Canons of page construction", Wikipedia (Van de Graaf 1/9, 2/9; Tschichold) — https://en.wikipedia.org/wiki/Canons_of_page_construction
28. IBM Design Language, *UI icons — Usage* (optical centring) — https://www.ibm.com/design/language/iconography/ui-icons/usage/
29. Material Design (M1), *Icons* (2 dp stroke, optical corrections) — https://m1.material.io/style/icons.html
30. Wertheimer, "Laws of Organization in Perceptual Forms" (1923; Ellis tr. 1938) — https://psychclassics.yorku.ca/Wertheimer/Forms/forms.htm
31. Wagemans et al., "A Century of Gestalt Psychology in Visual Perception I", *Psychological Bulletin* 138(6), 2012 — https://pmc.ncbi.nlm.nih.gov/articles/PMC3482144/
32. Palmer, "Perceptual Grouping: It's Later Than You Think", *Current Directions in Psychological Science*, 2002 — https://palmerlab.berkeley.edu/pdf/Palmer.pdf
33. Legge & Bigelow, "Does print size matter for reading?", *Journal of Vision* 11(5):8, 2011 — https://doi.org/10.1167/11.5.8
34. University of Minnesota ODA, *Slide Presentations* (18 pt own-screen / 24 pt room) — https://accessibility.umn.edu/what-you-can-do/extend-core-skills/provide-accessible-content-events/slide-presentations
35. Lancaster University, *Accessibility checklist for PowerPoint slides* (24 pt / 18 pt) — https://portal.lancaster.ac.uk/ask/digital/accessibility/accessibility-checklists/accessibility-checklist-for-powerpoint-slides/
36. Texas Tech, *Quick Guide to Creating Accessible PowerPoint Presentations* (18 pt; 30 pt projected) — https://www.ttu.edu/accessibility/digital-accessibility/docs/accessible-powerpoint-guide.html
37. Microsoft Support, *Make your PowerPoint presentations accessible* (18 pt or larger) — https://support.microsoft.com/en-us/accessibility/powerpoint/make-your-powerpoint-presentations-accessible-to-people-with-disabilities
