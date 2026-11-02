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

## Adding a block

Add a template to `layouts/shortcodes/` and it appears in the Blocks picker under
"Your own blocks", with a form built from the template's `.Get "name"` values. Add
an entry to `BLOCK_TYPES` in `web/blocks.js` for a nicer name, sketch and fields.

Things the app never publishes are listed in `isNoise` in `server.js`, such as
Obsidian's workspace file and `.DS_Store`.
