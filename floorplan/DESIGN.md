# Floorplan Layout Tool — Design

**Date:** 2026-08-19
**Status:** Approved, ready for implementation
**Lives at:** `samsinsky.com/floorplan/` (unlisted — nothing links to it)

**Phase 1** is the manual tool — the body of this document. **Phase 2** adds
AI-assisted import, designed in the appendix but deliberately not built until
phase 1 has been used on a real floorplan.

## Problem

Laying out a new apartment from a floorplan image. The image has printed
dimensions; the furniture has measured dimensions. Nothing connects the two, so
"will the sofa fit under that window" is guesswork.

This tool connects them: establish the image's real-world scale once, then drag
correctly-scaled furniture rectangles over it and look at the result.

## Design principle

**Show, don't judge.** The tool does not decide whether something fits. It draws
everything at true scale and lets the eye do the rest. Overlaps are obvious
because furniture is translucent and colors double up where pieces cross. There
are no warnings, no validation, no red badges.

## Non-goals

Multi-floor plans. 3D. A furniture catalog with images. Auto-layout. Accounts or
sync. Curved walls. Automated fit or clearance checking.

Phase 1 additionally excludes everything in the appendix.

## User flow

1. **Upload** a floorplan image (drag-drop or file picker) — *or* a saved
   `.json` layout, which skips straight to step 4 with everything restored.
   Step 1 sniffs the file rather than making the user find the right control:
   the saved layout is the more valuable of the two files, so it belongs
   wherever the image is accepted.
2. **Calibrate** — drag a line across a known dimension, type its real length.
3. **Add furniture** — name plus dimensions; drag it into place.
4. *(Optional)* **Trace rooms and doors** for wall-snapping and swing arcs.

Steps 1 and 2 are required and gate the rest. Step 4 is available any time and
can be skipped entirely.

## Coordinate system

**World units are inches.** One coordinate space for everything.

Calibration stores two points in *image pixel* space plus the real length
between them. That derives:

```
inchesPerPixel = realInches / pixelDistance(p1, p2)
```

The floorplan image is then rendered at `naturalWidth * inchesPerPixel` inches
wide. Rooms, doors, and furniture are authored directly in inches and need no
conversion.

Before calibration, `inchesPerPixel` is 1 — the world is simply image pixels.
Nothing else can be created until calibration is set, so nothing needs
rescaling at that moment.

**Re-calibrating later** scales existing content by the ratio between the old
and new `inchesPerPixel`, so everything stays pinned to the same features of
the image. Room polygons, door endpoints, and furniture *positions* all scale.
Furniture *dimensions* do not — an 84" sofa is 84" regardless of what the
floorplan turns out to be.

Zoom and pan are pure `viewBox` manipulation on the root SVG — no transform
bookkeeping on individual elements.

### Verification line

In calibrate mode, after the scale is set, the user can drag additional lines
that read out their computed real-world length. This catches a mistyped
calibration or a floorplan whose printed dimensions disagree with each other.
Verification lines are transient and never stored.

## Data model

```js
{
  version: 1,
  image: { dataUrl, naturalWidth, naturalHeight } | null,
  calibration: { p1: {x,y}, p2: {x,y}, realInches } | null,  // image px
  rooms:     [{ id, name, points: [{x,y}, ...] }],           // inches
  doors:     [{ id, p1: {x,y}, p2: {x,y}, hinge, swing }],   // inches
  furniture: [{ id, name, w, d, x, y, rot, color }],         // inches
  settings:  { gridOn, gridSize, snapOn }
}
```

- Furniture `x, y` is the **center** of the piece; `rot` is degrees clockwise.
- `w` is the dimension along the piece's local X axis, `d` along local Y.
- `hinge` is `'p1' | 'p2'` — which endpoint the door pivots on.
- `swing` is `'cw' | 'ccw'` — which side the arc sweeps to.
- `color` is assigned by cycling a fixed palette as pieces are added.

## Dimension parsing

One parser handles every reasonable way to type a measurement. A bare number is
**inches**.

| Input | Inches |
|---|---|
| `84` | 84 |
| `84"` | 84 |
| `7'` | 84 |
| `7' 6"` | 90 |
| `7'6` | 90 |
| `6.5'` | 78 |

Pair form accepts `x` or `×` as the separator with any spacing: `84x36`,
`84 x 36`, `7' x 3'`, `7'6" x 2'10"`.

Display format is `7' 6"`, dropping the inches part when zero. Areas display as
square feet to one decimal.

## Rooms and doors (optional)

**Tracing a room:** click each corner, close the loop by clicking the first
point or pressing Enter. While tracing, if the segment from the previous point
is within 12° of horizontal or vertical, it snaps to exact axis alignment — so
rectangular rooms come out clean without precision clicking. Each room gets an
editable name and displays its area in square feet.

**Placing a door:** click two points. Each endpoint snaps to the nearest traced
wall segment within 18"; with no rooms traced, the points land where clicked.
Hinge side and swing direction are toggled after placement. Rendered as the standard architectural symbol: a leaf line plus a
quarter arc.

Doors exist purely as a visual reference. Nothing checks whether furniture
blocks them.

## Furniture

**Shape:** rectangle or L. Internally an L is its bounding box minus a notch —
`w`, `d`, `armDepth`, `legWidth`, `corner`. The *form* does not ask for it that
way.

**The form asks for what the spec sheet prints.** A sectional's product page
gives a total width, a total depth, and a seat depth. So the form asks for
exactly those: `Total width × depth`, then `Seat depth`. Both arms share the
seat depth, with a `Chaise is a different width` checkbox revealing the fourth
number in the rare case they differ. Two fields for the common case.

This took three attempts, and the failures are worth recording. Asking for the
footprint plus two *arm thicknesses* produced a field called "long side depth",
which a user read as the length of the sofa and filled with their overall
depth — silently refused. Re-modelling as two arms, each `length × depth`, was
internally cleaner but forced the user to derive numbers their spec sheet
already gave them. **The rule that survived: ask for the numbers the user is
reading off, never numbers they have to compute.**

A live preview backs this up regardless of labelling: the panel draws the shape
as you type, annotated with every dimension, and shows a dashed red outline
when the numbers leave no L.

**Handedness, not orientation.** The model stores a `corner` of `nw|ne|sw|se`,
but the form offers only two choices — *chaise left* and *chaise right*. The
other two are reachable by rotating the piece: `sw` is `ne` turned 180°, and
`se` is `nw` turned 180°. What rotation cannot do is mirror, so a left-facing
sectional never becomes a right-facing one, and that is the only distinction
worth a control. Sectionals are sold exactly this way.

Each option is rendered as a thumbnail of the shape at the proportions
currently entered, captioned in words, and placed directly under the seat depth
rather than below the help text. The earlier version — four abstract glyphs at
the bottom of the form — was reported as the control not existing.

An L is a single piece: it drags, rotates, snaps and exports as one. Because
snapping consumes edge lists rather than rectangles, an L snaps by its true
outline, including the two inner edges of the notch — so a coffee table nestles
into a sectional's corner flush against both.

Degenerate parameters (an arm as thick as the footprint, or zero) collapse to
the bounding rectangle rather than producing a self-crossing polygon.

**Adding:** a form with name, shape and dimensions. A preset dropdown pre-fills
standard sizes, which the user then edits to match their actual piece:

Twin bed 39×75 · Full 54×75 · Queen 60×80 · King 76×80 · Cal King 72×84 ·
Sofa (3-seat) 84×36 · Loveseat 60×36 · Armchair 35×35 · Coffee table 48×24 ·
Side table 22×22 · Nightstand 24×18 · Dresser (6-drawer) 60×20 ·
Dresser (3-drawer) 36×18 · Desk 60×30 · Office chair 26×26 ·
Dining table (4) 48×30 · Dining table (6) 72×36 · Dining chair 18×18 ·
TV stand 60×16 · Bookcase 32×12 · Washer/dryer 27×30 · Refrigerator 36×32 ·
Rug 60×96 · Rug 96×120

L-shaped presets: Sectional (small) 94×64 with 36" arms · Sectional (large)
112×88 with 38"/40" arms · Corner desk 60×60 with 24" arms.

**Colour** is assigned by cycling a fixed palette, and can be changed per piece
from the selection panel — eight palette swatches plus a native colour input
for anything else. Colour is the only thing distinguishing two similar
rectangles at a glance, so it has to be editable rather than whatever the cycle
happened to hand out.

**Stacking order** is the furniture array itself: index 0 paints first and
therefore sits at the bottom. The sidebar list shows the reverse — topmost
first, as every drawing tool does — and the index flip lives in exactly one
place. Drag a row to restack, or use *Send to back* / *Bring to front* in the
selection panel, since dragging to the end of a long list to bury a rug is a
chore. Restacking goes through the normal undo stack.

**Sidebar list:** every piece, with its dimensions and colour swatch. Click to
select and center; edit dimensions in place; delete; drag to restack.

## Interaction

Mode state machine: `select` · `calibrate` · `trace-room` · `place-door`.
Explicit toolbar buttons; Esc always returns to `select`.

### Manipulating furniture

| Action | Control |
|---|---|
| Move | Drag the piece |
| Rotate | Drag the handle above it — 15° snaps, Shift for free rotation |
| Rotate 90° | `R` (`Shift+R` for counter-clockwise) |
| Nudge 1" | Arrow keys |
| Nudge 6" | Shift + arrow keys |
| Duplicate | `⌘D` / `Ctrl+D` — offset 6" down-right |
| Delete | Delete or Backspace |
| Undo / Redo | `⌘Z` / `⌘⇧Z` |

### Snapping

Hold Option/Alt to suspend all snapping.

- **Grid** — toggleable, 6" default, origin at the image's top-left corner.
- **Piece to piece** — edges align within 4".
- **Piece to wall** — a furniture edge within 4" of a traced wall segment, and
  within 8° of parallel to it, translates flush against it. Translation only;
  the tool never rotates a piece for the user.

### Navigation

Wheel zooms at the cursor, clamped to 0.1×–20× of the fit-to-screen scale.
Space-drag or middle-drag pans. On touch: one finger starting on a piece drags
that piece, one finger starting on empty canvas pans the view, two fingers
pinch-zoom. In `trace-room` and `place-door` modes a one-finger tap places a
point instead. A "Fit" button resets the view.

## Rendering

A single SVG whose `viewBox` is in inches. Layers, bottom to top:

1. Floorplan image
2. Traced rooms — translucent fill, solid stroke
3. Doors — leaf line and swing arc
4. Furniture — 45% opacity fill, 2px stroke, centered label
5. Selection outline and rotate handle
6. Calibration and verification lines (calibrate mode only)

The 45% fill is load-bearing: it is the entire overlap-detection mechanism.
Where two pieces cross, the fills compound into a visibly darker region.

## Persistence and export

- **Autosave** to `localStorage` under `floorplan-planner-v1`, debounced 500ms.
  The toolbar shows the time of the last successful save, and turns red with
  "not saved" if a write fails — tracing a plan is expensive enough that silent
  save failure is not acceptable.
- **Erasing takes two clicks.** "Start over" arms itself and relabels for five
  seconds before it will actually wipe. Deliberately not a `confirm()` dialog,
  which blocks the page.

## Feedback placement

Validation messages appear **inline, beneath the control that produced them**,
not only in the toolbar. The toolbar status line sits ~700px from the sidebar
buttons; a refusal shown only there reads as the button doing nothing, which is
exactly how the first L-shape bug was reported. Inline errors clear as soon as
the user edits the offending field.

Gated cards dim their controls but keep a full-opacity note saying what unlocks
them. A card with `pointer-events: none` and no explanation swallows clicks
silently — the worst possible failure for a step-gated flow.
- The uploaded image is **downscaled to a 2000px long edge and re-encoded as
  JPEG at q0.85** before storage. This keeps a typical plan under 500KB, well
  inside the ~5MB origin quota.
- **Export / import JSON** — full document including the image, for moving a
  layout between laptop and phone. Verified lossless: export, wipe, re-import,
  export again, and the two files are byte-identical.
- **Importing is undoable.** It replaces the whole document, so it pushes onto
  the undo stack instead of clearing it, and says so. Dropping the wrong file
  is one ⌘Z from recovery. This is why undo snapshots carry the image by
  reference — a pointer per entry buys back the one operation that can destroy
  a traced plan.
- **Export PNG** — serialize the SVG, draw to a canvas at 2×, download. Exports
  the full plan extent, not the current viewport, so the output does not depend
  on where the view happens to be scrolled.

Undo is snapshot-based: a deep clone of state excluding the image, capped at 50
entries.

## Hosting and privacy

Static files in the `samsinsky.github.io` repo at `portfolio/floorplan/`,
served by GitHub Pages at `samsinsky.com/floorplan/`. No build step — the repo
has none, and GitHub Pages serves native ES modules correctly.

**The page is public.** Unlisted is not private: anyone with the URL can open
it, and the repo is public so the source is browsable. `<meta name="robots"
content="noindex">` and a `robots.txt` disallow keep it out of search results.

**The floorplan image is private.** It is read directly into the browser, kept
only in that browser's local storage, and never transmitted anywhere —
including to GitHub. Someone who finds the URL gets an empty tool.

## Code structure

```
portfolio/floorplan/
  index.html      shell, toolbar, sidebar
  app.css         styling — matches the main site
  geometry.js     dimension parsing, shape polygons, polygon area, snapping
  model.js        state, undo, localStorage, JSON import/export
  render.js       draws the SVG scene from state
  interact.js     pointer/touch handling, mode state machine
  ui.js           panels, forms, furniture list
  test/geometry.test.js
```

`geometry.js` is pure functions with no DOM access — everything else may touch
the DOM.

Local development: `python3 -m http.server 8000` from the repo root, then
`localhost:8000/floorplan/`. Opening via `file://` will not work, because
browsers block ES module loading over that scheme.

## Styling

Matches the existing site so the page reads as part of it: `rgb(240, 233, 226)`
paper background, Space Grotesk for headings and controls, DM Sans for body,
white cards at 14px radius with `oklch(90% 0.01 240)` borders, the same
`fadeUp` entrance animation. Fonts load from the same Google Fonts URL the
homepage already uses.

The canvas area itself sits on white for contrast against the floorplan image.

## Testing

`node --test` over `test/geometry.test.js`, no dependencies. Coverage focuses
where the bugs will actually be:

- Dimension parsing across every accepted format, including malformed input
- Inch formatting round-trips
- Polygon area
- Rotated rectangle corner computation
- L-shape polygons: vertex count, area, all four corners, degenerate collapse
- Grid snapping, parallel-wall detection, and corner settling

Interaction and rendering are verified by hand in the browser.


---

# Phase 2 — Reading the plan's own labels

**Built.** Not with a vision model, and not with an API key. What shipped is
OCR — Tesseract compiled to WASM, running in a Web Worker in the browser.
Nothing is uploaded, nothing needs a key, and it works offline after the first
use.

## Why not a model

The governing constraint was always that **the reader supplies numbers, the
human supplies geometry** — models read text far better than they report pixel
coordinates. OCR takes that further: it reports bounding boxes natively, which
is what makes room naming and the calibration cross-check possible at all.

A local LLM (Ollama with gemma3, or an in-browser VLM over WebGPU) was
considered and rejected: 1–5GB of download, desktop-only, and small multimodal
models misread dense printed digits while sounding certain. OCR is ~4MB, runs
on a phone, and fails visibly.

## What the spike found, and what it forced

Default Tesseract on a floorplan is bad, in two specific ways that shaped the
implementation:

1. **It merges across the page.** `FOYER` and `BEDROOM`, at opposite corners,
   came back as one line `"FOYER BEDROOM"`. Fixed by page segmentation mode 11
   (sparse text), which treats scattered labels as separate. Room names then
   read at 91–97% confidence.

2. **It drops apostrophes.** `10'9"` came back as `109`, and `9'1 x 7'10` as
   `91x 710`. These parse as perfectly good numbers and are wrong by a factor
   of ten — precisely the silent failure this whole design exists to prevent.

Confidence is *not* a reliable filter for this: at 6× upscale a wrong reading
(`91x710`) came back at 75% confidence. Two hard rules do the work instead:

- **An explicit foot or inch mark is required.** `91x710` is discarded; `10'9`
  is kept. This is the single most important line in `ocr.js`.
- **Measurements must be plausible** — between 1 and 60 feet. A garbled `5'3`
  once read as `95'3`, keeping its apostrophe.

On the test plan this yields two correct offers and zero wrong ones. Roughly
half the labels are missed. That is the right trade: a missed dimension costs a
few seconds of typing, a wrong one silently ruins the layout.

Upscaling to ~1900px on the long edge is worth it; beyond that accuracy plateaus
and only the clock suffers. About 3–5 seconds per plan, in a worker, so
calibrating by hand is never blocked.

The example floorplan that motivated this feature demonstrates why. Its room
labels — `KITCHEN 9'1 x 7'10`, `LIVING / DINING 16'3 x 13'8`, `FOYER 8'1 x
5'3`, `BEDROOM 14'5 x 10'9` — are crisp, high-contrast, and trivially readable.
But the same image also carries `390`, `480`, and `330` in blue, which are
window or line numbers, not measurements. A model that silently adopts `330` as
a wall length produces a plan wrong by a factor of three, and no downstream
check would catch it. A pick-list the human confirms makes that failure
impossible at a cost of about two seconds.

Note also that room labels are **nominal**. In the example, the living/dining
room is L-shaped and the bedroom has a notch, yet each carries a single
`W × D`. Those numbers describe a span, not a rectangle — so the human must
choose which span the calibration line crosses.

## What it drives

Labels are stored on the document in **image pixels**, so they survive
re-calibration, and are converted to world inches on demand.

**A read can always be asked for.** Firing only on upload meant any document
restored from storage — including every layout made before this shipped — had
no labels and no way to get them, which read as the feature being missing. The
Scale card now shows the reader whenever there is an image, with a button that
runs or re-runs it, and renders saved labels without re-reading.

1. **Calibration is a tap, not a transcription.** The Scale card lists what was
   found, grouped under the room name it belongs to. Drag the line across that
   wall, tap `14'5`.
2. **Tracing names itself.** A traced room adopts the name of the label printed
   inside it, falling back to `Room N`.
3. **Tracing checks the calibration.** *"Traced 14' 4.8" × 11' 0.5", plan says
   14' 5" × 10' 9". Your scale checks out."* Over 5% drift and it says so
   instead. This is the safety net for the one measurement everything else
   depends on, and it costs nothing — it caught a deliberately bad calibration
   during testing, reporting it as 39% out.

Nothing is ever applied automatically.

## Not built: furniture import

More reliable than floorplan import, because product pages state dimensions as
text in a spec table. Two input paths, one extraction schema:

- **Paste text** — copy the spec block from a product page. No vision call
  needed; cheaper and instant. This is the default.
- **Upload an image** — a screenshot or photo of a spec sheet. Vision call.

Both return `{ name, width, depth, height }`, land in the same add-furniture
form as manual entry, and are editable before committing. Height is captured
but unused in phase 1.

## No API key, by construction

Everything runs locally. There is no key to paste, nothing to leak, and no
per-use cost — which also means the public URL cannot be used to spend anything
of Sam's. The only third-party dependency is the Tesseract bundle, pinned to a
version and loaded from jsDelivr with a subresource-integrity hash.

Failure is always survivable: if the CDN is unreachable or the read finds
nothing, the panel says so and manual entry works exactly as before.
