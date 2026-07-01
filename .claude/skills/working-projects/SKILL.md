---
name: working-projects
description: How to add or edit a project on the /working page — the three project kinds (case study, external link, NDA), every configurable front-matter field, ordering, the NDA modal, and the hover-cursor/message system. Use whenever adding a new project, changing how one behaves on click, editing the NDA modal, or touching project card hover states.
---

# Adding a project to /working

Every project is a page bundle at `content/working/<slug>/index.md`. Run the
archetype to scaffold one:

```
hugo new working/my-project/index.md
```

`archetypes/working/index.md` has inline comments for the common fields, but
it's not fully in sync with everything below (notably `weight` and `taggrid`
aren't in it yet) — this doc is the source of truth.

## The three kinds (`type`)

`type` decides how the card behaves when clicked **and** which Hugo template
renders its permalink page, if any:

| `type` | click behavior | cursor default | renders a page? |
|---|---|---|---|
| `case-study` | navigates to the project's own page | `click` | yes — `layouts/case-study/single.html` |
| `external` | opens `externalurl` in a new tab | `external` | **no** |
| `nda` | opens the shared NDA modal | `nda` | **no** |

Only `case-study` has a matching single-page template. `external` and `nda`
projects have no `layouts/<type>/single.html`, no `layouts/working/single.html`,
and no `_default/single.html` to fall back to — Hugo builds **no HTML file**
for them (confirmed: their `content/working/<slug>/` output only contains the
copied images, no `index.html`). That's fine, because a user is never
navigated to that URL — the card always intercepts the click. Don't rely on
`/working/<slug>/` existing as a real page unless `type: "case-study"`.

If `type` is omitted, it falls back to the legacy `external: true/false`
boolean (`external → "external"`, otherwise `"case-study"`).

## Full front-matter reference

```yaml
title: "My Project"
weight: 1                  # ordering — see "Ordering" below
date: 2026-01-01T00:00:00+05:30
year: 2026
tags: [ux, building]
featured: true
slug: "my-project"
description: "One-line summary shown on the card and (for case studies) as the page H1"
cover: image.png           # relative to this bundle; used on the card AND
                            # as the case-study hero / NDA modal cover

type: "case-study"         # case-study | external | nda

# --- hover cursor + message (optional, apply to any type) ---
cursor: "click"            # click | external | nda — overrides the type default
messages: "take a look"    # single string, or a YAML list to cycle (see below)

# --- only used when type = external ---
externalurl: "https://example.com"

# --- only used when type = nda ---
ndaBadge: "Under NDA"      # small tag at the top of the modal (default: "Under NDA")
ndaNote: ""                # sub-text line at the bottom of the modal (has a generic default)

# --- only used when type = case-study ---
bgColor: "#BFAFFE"         # sets <body> background on that project's own page only
taggrid:                   # renders a 4-col info grid under the title (role/duration/etc)
  - title: "Role played"
    value: "Sole Designer"
  - title: "Duration"
    value: "2 months"
```

## Ordering

Cards are **not** explicitly sorted by the template — they render in
`.Site.RegularPages`'s natural order. In practice: give a project a `weight`
(lower = earlier) to pin its position; projects without a `weight` fall in
after the weighted ones. Current order on the live grid: `fabric` (weight 1),
`bloooom` (weight 2), `carvers` (weight 3), then `fast-cast` (no weight, sorts
last). If you want a project to jump the queue, give it a `weight` lower than
its neighbors'.

## Case study specifics

Body content of the markdown file is the page. `description` becomes the H1.
`taggrid` (a list of `{title, value}` pairs) renders as the little info grid
under the title — this replaced an older set of individual fields (`role`,
`timeline`, `team`, `client`, `skills`); those no longer do anything, use
`taggrid` instead. `bgColor` sets that page's `<body>` background — it has no
effect on the card or on external/nda projects, since those never render
their own page.

Template: `layouts/case-study/single.html` (styled by `static/css/content.css`).
Hugo resolves this by `type`, not by section — this is why the layout file
lives at `layouts/case-study/`, not `layouts/working/`.

## External-link specifics

Only needs `externalurl`. The card wraps everything in `<a target="_blank"
rel="noopener">`. No page is rendered (see table above), so don't bother
writing body content — it won't be shown anywhere.

## NDA specifics

The card is a `<button data-nda-open>`. Clicking it opens a single shared
modal (`#ndaModal` in `layouts/index.html`), filled by cloning that project's
`<template data-nda-template>`. Everything inside the modal is configurable:

- **Cover image** — from `cover`, rendered full-bleed at the top of the modal
  (flush edges, no padding, clipped to the panel's rounded top corners).
- **`ndaBadge`** — the small pill above the title. Default: `"Under NDA"`.
  Real examples in use: `"Confidential"`, `"Private site"`.
- **Title/description/tags** — same `.Title` / `description` / `tags` as the
  card.
- **Body content** — whatever markdown you write in the project's `index.md`
  renders inside the modal via `.Content`. Add as much detail as the NDA
  allows — text, images, lists, links, anything markdown supports. Omit it
  for a bare badge/title/note modal (see `fabric`, which has none).
- **`ndaNote`** — the sub-text line below the content, separated by a rule.
  Has a generic NDA-disclaimer default if omitted.

Modal layout: `.nda-modal__panel` is `min(92vw, 900px)` wide on desktop and
`92dvh` tall / full-width on screens ≤640px (a near-full-height sheet). The
close button has no fill — it's a bare "×" in `mix-blend-mode: difference` so
it stays visible over the cover image or the white body.

Controller script: the inline `<script>` at the bottom of `layouts/index.html`
(`open()`/`close()`, Escape key, backdrop click, focus return on close).

## Hover cursor + message (any type, any link)

Independent of the project system — works on any element, anywhere:

```html
<a href="…" data-cursor="external" data-label="opens in a new tab">…</a>
```

- **`data-cursor`**: `click` | `external` | `nda` — swaps the OS pointer for
  one of the three custom SVGs in `static/assets/`. Auto-defaults to
  `external` for any `a[target="_blank"]`/`a.external`; an explicit
  `data-cursor` always wins.
- **`data-label`**: the message that rides next to the cursor on hover,
  animated in with GSAP SplitText (stagger rise from below, then a perpetual
  small wave). No attribute → no message; this is opt-in only, there's no
  default text anywhere.
- Multiple messages: make `data-label` a JSON array. The label cycles to the
  next message every **3 seconds** (`CYCLE_MS` in `cursor-label.js`), replaying
  the same stagger each time, for as long as the element stays hovered.

On a project card, set `cursor:`/`messages:` in front matter — `layouts/index.html`
turns those into `data-cursor`/`data-label` on the `.project-card` (a YAML
list under `messages:` becomes the JSON array automatically).

Text is white with `mix-blend-mode: difference`, so it reads over any
background. GSAP + SplitText are self-hosted (`static/scripts/gsap.min.js`,
`SplitText.min.js`) — no CDN dependency.

## File map

| file | role |
|---|---|
| `archetypes/working/index.md` | scaffold for `hugo new working/...` |
| `layouts/index.html` | project grid loop, card markup per type, NDA modal shell + controller |
| `layouts/partials/project-card-inner.html` | shared cover/title/description/tags markup used inside every card |
| `layouts/case-study/single.html` | the case-study page template (by `type`, not section) |
| `static/css/content.css` | case-study page styles (hero, intro, `taggrid`) |
| `static/css/working.css` | card grid styles + NDA modal styles |
| `static/css/global.css` | `CURSORS` + `CURSOR LABEL` sections |
| `static/scripts/cursor-label.js` | hover-label controller (follow, stagger, cycling) |
| `static/scripts/gsap.min.js`, `SplitText.min.js` | self-hosted GSAP + plugin |
| `static/assets/{click,external,nda}.svg` | cursor images |

## Gotchas

- **`gsap.killTweensOf(label)` without a property filter** kills the
  `quickTo` x/y follow tweens along with whatever you meant to cancel, and the
  label freezes in place instead of tracking the cursor. Always scope it, e.g.
  `killTweensOf(label, 'opacity')`.
- **`external`/`nda` projects render no page.** Don't add body content or link
  to `/working/<slug>/` expecting it to resolve for those types — only
  `case-study` gets a permalink.
- **The global `img { max-width: 100% }` rule** will clamp any attempt to make
  an image wider than its container (e.g. a full-bleed cover) unless you set
  an explicit `max-width` on that specific image to override it.
- **Old case-study meta fields are dead.** `role`, `timeline`, `team`,
  `client`, `skills` did something in an earlier version of the layout; the
  current `layouts/case-study/single.html` only reads `taggrid`.

## Verifying changes

Use the `hugo-pinned` launch config (port 1399, fixed — avoids the autoPort
mismatch the default `hugo` config can hit with the preview tools). Useful
checks in devtools:
- `getComputedStyle(el).cursor` should end in the right `assets/*.svg` path
- `document.getElementById('cursorLabel').textContent` after dispatching a
  `mouseover` shows the current message
- `document.documentElement.clientWidth`/`clientHeight` are more reliable than
  `window.innerWidth`/`innerHeight` in this preview tooling, which has
  sometimes reported 0 for the latter right after a reload.
