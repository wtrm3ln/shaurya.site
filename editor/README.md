# Portfolio editor

The Mac app for editing this site. It lives in `/Applications/Portfolio.app`.

It's a small native window (`mac/main.swift`) around a local page (`web/`) and a
local server (`server.js`). The server edits the files in this repo, runs a Hugo
preview in the background, and publishes with git. Pushing to GitHub is what
makes Cloudflare deploy the site, so there's no hosting to look after.

Needs Node, Hugo and git, all already installed through Homebrew.

## Changing it

- **Editor page or server:** edit the file and reopen the app, or press ⌘R for
  page changes. No rebuild.
- **Writing surface** (`src/richtext.js`): `npm install && npm run build` in this
  folder, which regenerates `web/vendor/richtext.js`.
- **The window or icon** (`mac/`): run `mac/build.sh` to rebuild and reinstall.

## Where things live

| What | Where |
|---|---|
| Text that isn't part of a page (home, nav, footer) | `data/site.json`, edited under "Home & site text" |
| Images on a page with its own folder | beside its `index.md` |
| Images on a single-file page, like writing | `static/images/<section>/<page>/` |
| Project blocks | `layouts/shortcodes/` |

## Gallery pages

`painting` and `gallery` are full-screen image walls (3 columns, staggered, plain
images; click one to open the preview, with notes pinned on it). Any folder whose `_index.md` says
`layout: gallery` is one; **New… → Gallery** makes another.

- The images are the image files in the page's folder. `gallery.json` beside them
  holds what files can't: the order, each image's caption (shown under it, and its alt text) and its notes
  (`x` and `y` are fractions of the image's width and height).
- In the app a gallery page shows a board instead of a text editor: drop, paste or
  "Add images…" to add, drag to reorder, click an image to pin notes on it
  (click the picture to drop a pin, drag a pin to move it).
- Layout: `layouts/_default/gallery.html`, the wall in `static/css/gallery.css` and
  `static/scripts/gallery.js`.
- Clicking any plain image on the site (About, case studies, galleries) opens the
  preview: `static/scripts/preview.js` + `static/css/preview.css`. Images inside
  links or buttons are skipped; add `data-no-preview` to skip one.
- A new gallery isn't in the top menu until you add it under Home & site text.
  Give a menu item `"expand": true` in `data/site.json` to get the slide-up
  transition into a full-screen page.

## Captions

- **In page text:** an image's caption is the quoted text after its address,
  `![alt](images/foo.png "Your caption")`. In the app, type it in the "Add a
  caption" line under the picture. Handled by `layouts/_markup/render-image.html`.
- **On gallery pages:** each image has a Caption field and its notes
  (saved as `caption` in `gallery.json`). It shows under the image on the wall.

## Adding a block

Add a template to `layouts/shortcodes/` and it appears in the Blocks picker under
"Your own blocks", with a form built from the template's `.Get "name"` values. Add
an entry to `BLOCK_TYPES` in `web/blocks.js` for a nicer name, sketch and fields.

Things the app never publishes are listed in `isNoise` in `server.js`, such as
Obsidian's workspace file and `.DS_Store`.
