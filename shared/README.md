# shared/

Design tokens and form controls for every project on samsinsky.com.

Plain CSS on native elements. No build step, no dependency, no framework —
which is the point: the site is static, and nothing here can rot, drift, or
need upgrading.

## Using it

Link it *before* the project's own stylesheet, so the project can override:

```html
<link rel="stylesheet" href="../shared/ui.css">
<link rel="stylesheet" href="app.css">
```

## What it gives you

**Tokens** — surfaces, a four-step ink scale, hairlines, accent and danger,
radii, and the three site typefaces. Use `var(--ink-soft)`, not a literal
`oklch(...)`, so a palette change lands everywhere at once.

**Checkbox and radio** — black boxes and circles with white marks, drawn with
borders rather than an SVG or icon font so they stay crisp and load nothing
extra. Hover, checked, focus-visible and disabled states included.

**Switch** — the same `<input type="checkbox">` with `class="switch"`, for when
a control reads as on/off rather than done/not-done. Same element, same
semantics, different presentation.

**`.check`** — puts a control and its label on one baseline and makes the whole
row a click target.

```html
<label class="check"><input type="checkbox"> Show grid</label>
<label class="check"><input type="checkbox" class="switch"> Dark mode</label>
```

## Extending it

Add something here when a second project needs it, not before. Buttons, inputs,
selects and cards currently live in `floorplan/app.css`; they are worth moving
up the first time another project wants them, and not a moment sooner.
