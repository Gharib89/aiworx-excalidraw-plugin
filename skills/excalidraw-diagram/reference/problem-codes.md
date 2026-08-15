# Problem codes

The gate's complete vocabulary. Machine handling keys on `code` — the `message`
prose carries no contract and may be reworded at any time.

The set is **append-only**: a code is added, never renamed or repurposed. A code
that has to change ships as a new code alongside the old one. The old code is
marked `deprecated` here and keeps being emitted while consumers migrate; it stops
being emitted later, and its row stays in this table for good so the name is never
reused. So `live` means "emitted, rely on it", `deprecated` means "listed, may or
may not still be emitted — migrate off it".

## Report shape

`check.js --json` prints one document per invocation:

```jsonc
{
  "ok": false,                    // every file passed
  "files": [{
    "file": "diagram.excalidraw",
    "ok": false,
    "problems": [ /* problem objects, below */ ],
    "stats": { "elements": 42, "frames": 3, "texts": 12, "outsideAll": 1 },
    "error": { "code": "invalid-json", "message": "…" }  // instead of problems
  }]
}
```

- `problems` — one object per defect. Empty when the file passed.
- `stats` — counts for the file, or `null` when it never reached the rules.
  `outsideAll` counts elements that belong to no frame **and** touch no frame.
  That is legal (titles, legends and captions sit outside the band); the count is
  reported so an author can notice an element they meant to bind.
- `error` — present **instead of** a problem list when the file could not be
  checked at all. `stats` is `null` and `problems` is empty.

Every problem object carries three fields, plus the per-code fields in the table:

| field | type | meaning |
|---|---|---|
| `code` | string | the stable kebab-case identifier below |
| `message` | string | human prose — no contract, do not parse |
| `elements` | string[] | the element ids involved, in the order the table names |

## Element-level codes

Emitted by the rules in `verify.js`. Any of them fails the file — the gate has no
warning level.

| code | status | `elements` | extra fields | fails when |
|---|---|---|---|---|
| `malformed-element` | live | (empty) | `index` | the entry at that array index is not an element object |
| `unknown-type` | live | [element] | — | the element's `type` is not one the gate knows |
| `non-finite-geometry` | live | [element] | — | a coordinate or size is `NaN` or `Infinity` |
| `degenerate` | live | [element] | — | a line or arrow has zero length, or a shape zero/negative size |
| `duplicate-id` | live | [element] | — | two elements share one id |
| `frame-overlap` | live | [frame, frame] | — | two frames' outlines overlap |
| `missing-container` | live | [text, container] | — | bound text names a container that is deleted or absent |
| `text-overflow` | live | [text, container] | — | bound text exceeds the container's usable interior |
| `missing-frame` | live | [element, frame] | — | an element names a frame that is deleted or absent |
| `frame-escape` | live | [element, frame] | `element`, `frame` (boxes) | an element's outline leaves the frame it belongs to |
| `frame-edge-crowding` | live | [element, frame] | `clearance`, `needs` | an element stays inside its frame but stops less than 4px from the border |
| `unbound-over-frame` | live | [element, frame] | — | an element sits over a frame without belonging to it, so per-frame export puts it in the wrong panel |
| `dangling-binding` | live | [arrow, target] | — | an arrow's `startBinding`/`endBinding` points at a deleted or absent element |
| `free-text-overlap` | live | [text, text] | — | two unbound texts' outlines overlap |
| `arrow-crossing` | live | [arrow, shape] | — | an arrow's polyline passes through a solid shape it is not bound to |
| `arrow-buried` | live | [arrow, target] | `depth` | an arrowhead or tail lands too far inside its target to read |
| `text-struck-by-arrow` | live | [text, arrow] | `clearance`, `needs` | an arrow's polyline passes within 6px of a text, and the text is not its bound label nor the arrow bound to the text's container |
| `stray` | live | [element] | — | an element sits more than 1000px from anything else — off-canvas, not merely outside a frame |
| `unparseable-color` | live | [element] or (empty) | `field`, `value` | a colour field is neither a hex value, `transparent`, nor empty |
| `text-over-image` | live | [text, image] | — | text sits over an image, whose pixels are a ground no contrast ratio can measure |
| `low-contrast` | live | [text] | `ratio`, `needs`, `ink`, `bg`, `theme` | text misses 4.5:1 (3:1 for large text) against its ground, under the named theme |
| `foreign-font` | live | [text] | — | the text's `fontFamily` is outside the house pair — a spliced library item's own labels are the usual source, so splice it with `text: "drop"` ([authoring.md](authoring.md#real-assets-images-and-library-items)) |
| `missing-image-bytes` | live | [image] | — | the image's `fileId` has no bytes in the files dictionary |

`frame-edge-crowding` is the near miss `frame-escape` does not cover: a per-frame
export crops exactly at the frame border — Excalidraw zeroes padding for frame
export — so content flush with the border renders clipped in the panel even
though it is technically inside. The minimum inset is **4px**, measured on ink
like containment is, and reported as `clearance` (what the element has) against
`needs` (what it must have). A frame that fits itself around `children` places
content at 10px, so an authored diagram clears the inset by construction; the
floor sits below 10 so a rotated shape whose ink legitimately fills its frame is
snug, not a defect. An element that leaves the frame is reported once, as
`frame-escape`; containment tolerates a sub-pixel graze, and an element in that
band is out, so it is not reported as crowding either.

`text-struck-by-arrow` reads text struck through by an arrow as crossed out
rather than pointed at: the minimum clearance is **6px**, reported as
`clearance` against `needs`. Two exemptions, both arrows that cannot truly
strike: a bound label against its *own* container arrow — the renderer masks
that arrow's path behind the label's box, so its line never touches the words —
and an arrow *bound to* the text's container, which terminates at the
container's border while the label sits inside it. The mask covers only the
label's own arrow: any other arrow through the same text still flags.

Both themes are scored on every run, which is why `low-contrast` names the
`theme` it failed under — [palette.md](palette.md) has the filter that makes a
dark-only failure possible.

## File-level codes

Emitted by `check.js` for a file that never reached the rules. They appear under
`error`, never in `problems`.

| code | status | exit | fails when |
|---|---|---|---|
| `unreadable` | live | 2 | the file cannot be read at all — this outranks a rule failure, so a typo'd path is never mistaken for a bad diagram |
| `empty-file` | live | 1 | the file is empty |
| `invalid-json` | live | 1 | the file is not valid JSON |
| `not-excalidraw` | live | 1 | the JSON is not an Excalidraw document |
| `check-crashed` | live | 1 | the gate itself threw while checking the file |
| `invalid-brand-override` | live | 2 | a `.excalidraw-brand.json` brand override discovered above the working directory fails its schema or a contrast claim — the fix is the override file, not the diagram; preflight it with `node tools/palette.js <file>` |

## Invocation

`check.js`, `render.js`, `revise.js` and `library.js` share one argument
vocabulary. Any argument starting with `-` that is not a known flag is refused
as a typo —
exit 2, naming the argument — rather than read as a file name, so `-dark` is an
error instead of a silently dropped `--dark`. A value flag will not swallow one
either: `--out -dark` is a flag left without a value. `--` ends the flags, which
is how a path that really does start with a dash stays reachable.

The exit-code conventions differ deliberately:

| tool | 0 | 1 | 2 |
|---|---|---|---|
| `check.js` | every file passed | any file failed the rules | any file was unreadable, or the invocation was bad |
| `render.js`, `revise.js` | the file was written | the document was refused — unparseable, foreign, or failing the gate | the invocation was bad: an unknown flag, a missing or invalid flag value, no input file, or more files than the tool takes |
| `library.js` | the search answered (no matches is still an answer) or the download landed in the cache — the splice stays a separate step | the request failed — the index, a download, or a hostile entry | the invocation was bad, including a missing or blank query |

A batch reports the **worst** code across its files, so an unreadable input (2)
outranks a file that failed the rules (1) instead of hiding behind it. The
single-file tools have nothing to mask: an unreadable document is a refusal like
any other (1), and 2 stays reserved for an invocation the tool could not act on
at all — every such refusal is a `UsageError` carrying the usage line.
