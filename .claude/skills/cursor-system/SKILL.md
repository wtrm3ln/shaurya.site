---
name: cursor-system
description: Custom cursors, cursor-following hover messages, and the project card/NDA-modal content system on this Hugo site. Use when adding a new project to /working, changing hover messages or cursors on any link, or editing the NDA modal.
---

# Cursor & project-card system

This site replaces the OS pointer with custom SVG cursors and pairs them with a
GSAP-powered message that rides next to the cursor on hover. Project cards on
the homepage (`layouts/index.html`) are the primary consumer, but the same
attributes work on any `<a>`/element anywhere on the site.

## The three cursors

| name | file | meaning |
|------|------|---------|
| `click` | `static/assets/click.svg` | default — normal/internal navigation |
| `external` | `static/assets/external.svg` | opens a live site in a new tab |
| `nda` | `static/assets/nda.svg` | opens a modal instead of navigating |

Defined in `static/css/global.css` under `CURSORS`. `html, body` and generic
`a, button, ...` get `click` by default. `a[target="_blank"]` / `a.external`
auto-get `external`. Anything with an explicit `data-cursor="…"` wins over
those defaults (via `[data-cursor="…"][data-cursor]` specificity bump) and
extends to child elements (`[data-cursor="…"] *`).

To add a fourth cursor (e.g. `data-cursor="download"`):
1. Drop the SVG in `static/assets/`.
2. Add a `[data-cursor="download"][data-cursor], [data-cursor="download"] * { cursor: url('/assets/download.svg') X Y, pointer; }` rule next to the others.
3. Use `data-cursor="download"` wherever needed (front matter `cursor:` param or a raw `data-cursor` attribute).

## The hover message (cursor label)

Any element with a `data-label` attribute shows that text riding next to the
cursor on hover — letters rise up from below (GSAP SplitText + stagger), then
settle into a perpetual small wave for as long as it's hovered. Text is white
with `mix-blend-mode: difference` so it stays legible over any background.

**No attribute → no message.** This is opt-in only, there is no default text.

```html
<a href="/contact" data-cursor="external" data-label="say hello">get in touch</a>
```

### Multiple messages (cycling)

`data-label` can hold a JSON array instead of a plain string. With more than
one message, the label swaps to the next one every **5 seconds** (same
stagger animation), looping for as long as the element stays hovered.

```html
<a data-label='["view overview","it&#39;s under nda"]'>…</a>
```

Implementation: `static/scripts/cursor-label.js`. `readMessages()` tries
`JSON.parse` on the attribute; a plain string that isn't valid JSON is treated
as a single message. The cycle uses `setInterval(…, 5000)` and is cleared on
mouseout. GSAP + SplitText are self-hosted at `static/scripts/gsap.min.js` /
`static/scripts/SplitText.min.js` (loaded in `layouts/_default/baseof.html`,
before `cursor-label.js`) — no CDN dependency.

## Project cards: adding a new project

Run the archetype (`hugo new working/my-project/index.md`) and fill in the
front matter documented inline in `archetypes/working/index.md`:

```yaml
type: "case-study"        # case-study | external | nda
cursor: "click"           # optional override; else derived from type
messages: "take a look"   # or a YAML list to cycle; omit for no message
externalurl: ""           # only used when type = external
ndaBadge: "Under NDA"     # only used when type = nda
ndaNote: ""               # only used when type = nda
```

`type` decides both the click behavior and the default cursor:

| type | click behavior | default cursor |
|------|-----------------|----------------|
| `case-study` | navigates to this page | `click` |
| `external` | opens `externalurl` in a new tab | `external` |
| `nda` | opens the NDA modal | `nda` |

The card-rendering logic lives in `layouts/index.html` inside the
`$projects` range loop — it reads `type`/`cursor`/`messages`, sets
`data-cursor`/`data-label` on the `.project-card` wrapper, and branches the
inner markup (`<a>`, `<a target=_blank>`, or `<button data-nda-open>` +
`<template data-nda-template>`).

## The NDA modal

One shared modal shell (`#ndaModal` in `layouts/index.html`) is filled at
click-time by cloning the matching project's `<template data-nda-template>`.
Controller: the inline `<script>` at the bottom of `layouts/index.html`
(`open()`/`close()`, Escape key, backdrop click, focus return).

Customize per-project via front matter:
- **`ndaBadge`** — the small tag at the top (default: `"Under NDA"`)
- **`ndaNote`** — the sub-text line below the content (default: a generic
  "this work is covered by an NDA..." sentence)
- **Body content** — whatever markdown you write in the project's `index.md`
  body renders inside the modal via `.Content`, so you can add as much (or as
  little) detail as the NDA allows — text, images, lists, anything markdown
  supports.

## File map

| file | role |
|------|------|
| `static/assets/{click,external,nda}.svg` | cursor images |
| `static/css/global.css` | `CURSORS` + `CURSOR LABEL` sections |
| `static/scripts/cursor-label.js` | hover-label controller (follow, stagger, cycling) |
| `static/scripts/gsap.min.js`, `SplitText.min.js` | self-hosted GSAP + plugin |
| `layouts/_default/baseof.html` | loads GSAP/SplitText/cursor-label.js, `#cursorLabel` element |
| `layouts/index.html` | project card loop, NDA modal shell + controller |
| `layouts/partials/project-card-inner.html` | shared cover/title/tags markup for every card type |
| `static/css/working.css` | card + modal visual styles (`.nda-modal`, `.nda-detail`, `.nda-trigger`) |
| `archetypes/working/index.md` | scaffold + inline docs for new projects |

## Verifying changes

Use the `hugo-pinned` launch config (port 1399, fixed — avoids the
autoPort mismatch the default `hugo` config can hit with the preview tools).
Check in devtools:
- `getComputedStyle(el).cursor` should end in the right `assets/*.svg` path
- `document.getElementById('cursorLabel').textContent` after a `mouseover`
  dispatch shows the current message
- `gsap.getTweensOf(label)` should still include the `quickTo` x/y follow
  tweens after a hover — if `killTweensOf(label)` is ever called without a
  property filter, it'll kill those and the label will stop following.
