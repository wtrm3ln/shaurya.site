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
#   nda        → opens a modal with the limited info below (for NDA work)
type: "case-study"
# Optional: override the hover label that rides with the cursor over this card.
# Defaults by type — case study → "view case study", external → "view live site",
# nda → "view overview".
# label: ""
# Only used when type = external:
externalurl: ""
# Only used when type = nda (optional — overrides the default modal message):
ndaNote: ""
cover: image.png
bgColor: ""
---
