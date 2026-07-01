---
title: "{{ replace .Name "-" " " | title }}"
date: {{ .Date }}
year: {{ now.Format "2006" }}
tags: []
featured: true
slug: "{{ .Name | urlize }}"
description: ""
# How this project opens from the work grid:
#   case-study → opens this case study page (write the story below)
#   external   → opens `externalurl` in a new tab (live site)
#   nda        → opens a modal with the info below (for NDA work)
type: "case-study"
# Cursor shown on hover. Defaults by type (case-study→click, external→external,
# nda→nda). Override with one of: click | external | nda
# cursor: "click"
# Message(s) that ride with the cursor on hover. One string, or a list to cycle
# through (each shown for 5s). Omit entirely for no message.
# messages: "take a look"
# messages:
#   - "take a look"
#   - "3 min read"
# Only used when type = external:
externalurl: ""
# Only used when type = nda:
# ndaBadge: "Under NDA"     # text of the little tag at the top of the modal
# ndaNote: ""               # the sub-text line beneath the modal content
cover: image.png
bgColor: ""
---

<!-- For an NDA project, anything you write here becomes the modal's body
     content — add as much as you like. For a case study, this is the page. -->
