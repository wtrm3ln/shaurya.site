---
title: "{{ replace .Name "-" " " | title }}"
date: {{ .Date }}
project: ""
description: ""
slug: "{{ .Name | urlize }}"
build:
  render: never
  list: local
draft: true
---

Write the update here.

Add images in this same folder and reference them with standard Markdown:

![Progress](image.png)
