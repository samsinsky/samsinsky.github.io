# Floorplan Layout

A static tool for laying out an apartment: upload a floorplan image, tell it the
real length of one wall, then drag correctly-scaled furniture over it.

Live at **samsinsky.com/floorplan/** — unlisted, nothing links to it.

It shows, it does not judge. Furniture is drawn translucent, so overlaps are
visible where the colours compound. There are no warnings and no validation —
the eye does the deciding.

## Privacy

The page is public; anyone with the URL can open it. Your floorplan is not:
the image is read straight into the browser, kept in that browser's local
storage, and never sent anywhere. Someone who finds the URL gets an empty tool.

## Using it

1. **Upload** a floorplan image — drop it on the canvas or use the panel.
2. **Set the scale** — drag a line across a wall whose real length you know and
   type that length. Everything downstream depends on this one measurement, so
   pick a long wall with a clearly printed dimension.
3. **Add furniture** — name plus `84 x 36`, `7' x 3'`, or `7'6" x 2'10"`. A
   preset dropdown fills in standard sizes to edit from.
4. *(Optional)* **Trace rooms and doors** — makes furniture snap flush to walls
   and draws door swing arcs.

| | |
|---|---|
| Move | drag |
| Rotate | drag the handle · `R` for 90° · `⇧R` for −90° |
| Nudge | arrows (1″) · `⇧` + arrows (6″) |
| Duplicate | `⌘D` |
| Delete | `delete` |
| Undo / redo | `⌘Z` / `⌘⇧Z` |
| Suspend snapping | hold `⌥` while dragging |
| Cancel / deselect | `esc` |

Layouts autosave to browser storage. Export JSON to move one between devices,
or PNG to send to someone.

## Development

No build step — GitHub Pages serves the ES modules directly. `file://` will not
work, because browsers block module loading over that scheme:

```sh
python3 -m http.server 8000   # from the repo root
open http://localhost:8000/floorplan/
node --test test/*.test.js    # geometry unit tests, no dependencies
```

`geometry.js` is pure functions with no DOM access, and is where the tests live
— unit parsing and snapping maths are where the bugs actually are. Everything
else is verified by hand in the browser.

See `DESIGN.md` for the full design, including the phase 2 AI import that is
designed but not built.
