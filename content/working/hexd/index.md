---
title: Hexd
date: 2026-11-10T03:21:21+05:30
year: 2026
tags: [development, ai]
featured: true
slug: hexd
description: "Soul searching for films: matching people to the film for the moment they're in"
type: case-study
cover: tempimageq9sm5e.jpg
draft: false
bgColor: "#ffd9a8"
---
Most recommendations ask what you like. hexd asks what you're going through, and looks for the film that has reached people who were in the same place.

{{< metrics >}}
  {{< metric value="3,400" label="films on the map" >}}
  {{< metric value="44" label="moments in life" >}}
  {{< metric value="~180" label="films read by AI each day" >}}
{{< /metrics >}}

{{< button href="https://hexd-7xr.pages.dev" >}}Try hexd{{< /button >}}

#### Where it started
### Two small projects that were really one idea

[Watch When](https://watch-when.pages.dev) let people browse films by the point in life to watch them: when you've lost someone, when you're about to leave home. A separate experiment, talkaboutitmovies, was a place to read what people said about a film after watching it, over years.

One was the *before*, the other the *after*. hexd joins them into a cycle, and the cycle becomes the dataset.

{{< process "Watch when" "Watch" "Check in" "Talk" >}}

---

#### The problem
## A film about your situation isn't the film for your situation

Recommenders match on what a film is *about*. Type "my dad is sick" into most of them and you get films with fathers in the title. The film that helps might not mention a father at all.

So hexd matches on what a film *does to you*.

---

#### Soul searching
## Every film gets a soul, and people keep rewriting it

An AI reads each film and writes one sentence about what it does to someone at the right moment, with the themes it awakens and who it's right for. No plot. For *Aftersun*: "It helps you see your parents as flawed and fragile people, too."

That text is turned into a point on a map of meaning, where things that feel alike sit close together. What you're going through goes on the same map, asked as a feeling rather than a topic, and hexd looks for the nearest films.

Then people take over. Every check-in adds what a film woke in someone and where they were in life, so over time a film's soul is mostly written by the people it reached.

{{< figure src="watch-when.jpg" caption="Watch when: a moment, and films ranked by how well they meet it" alt="hexd's watch when page ranking films for 'you've lost someone close'" >}}

---

#### Design decisions
## Old Reddit's bones, with fewer things on each screen

{{< 2col >}}
  {{< col >}}
**Points mean alignment, not popularity.** The number next to an entry is how much it aligns with *you*, learned from what you write, vote on and check in. Holding Alt peeks at the crowd's count.

**Check-ins are open.** No star ratings or tiers. You say how it landed in your own words, hexd asks one follow-up question, then shows the tags it heard so you can correct them.
  {{< /col >}}
  {{< col >}}
**The film is the post.** Each film has one thread that grows over the years, instead of a list of separate posts.

**Motion only where it explains something.** A pick flies into your journal; scores roll in the direction your vote pushed them; tags appear one by one as hexd reads them out of your words.
  {{< /col >}}
{{< /2col >}}

{{< figure src="film.jpg" caption="A film's page: its details under a band tinted by its own poster, and everything you do below" alt="hexd film page for Aftersun" >}}

---

#### Under the hood
## A small intelligence that learns from what actually happened

Every time hexd shows films, it logs why it ranked each one. A check-in afterwards is the label: did it reach you? A ranker learns from those outcomes and is only replaced when a new version is measurably better at predicting which films reach people. Older signal fades, so it moves with the times.

It runs entirely on Cloudflare's free tier. A background engine wakes every eight minutes to read one more film, refresh films people are talking about, and pull in new releases.

{{< accordion title="What I learned" >}}
- **What you embed matters more than the model.** Embedding plots matched surface words ("Jobs" for "I hate my job"). Embedding what a film does to you, and asking the question as a feeling, fixed it.
- **Prompts need taste.** The first AI readings said every film "stirs profound self-reflection". Banning the clichés and showing two examples of the voice I wanted changed everything.
- **Budgets shape design.** A daily AI allowance meant reading films slowly, saving check-ins even when the model is busy, and tagging them later.
{{< /accordion >}}

{{< button href="https://hexd-7xr.pages.dev/soul-searching" >}}Read how soul searching works{{< /button >}}
