// Cursor-following hover label, powered by GSAP + SplitText.
// Any element with a non-empty `data-label` shows that text right next to the
// cursor on hover. SplitText splits it into characters; the characters first
// rise up from below (staggered), then settle into a perpetual staggered wave.
//
// `data-label` may hold either a single message ("view overview") or a JSON
// array of messages ('["view overview","under nda"]'). With multiple messages,
// the label swaps to the next one every 5s using the same stagger animation,
// looping for as long as the element stays hovered.
//
// Opt-in only — elements without the attribute show nothing.
(function () {
  const label = document.getElementById('cursorLabel');
  if (!label) return;

  // No cursor to caption on touch / hover-less devices.
  if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;

  // Bail gracefully if the GSAP libraries didn't load.
  if (typeof gsap === 'undefined' || typeof SplitText === 'undefined') return;

  gsap.registerPlugin(SplitText);

  const OFFSET_X = 16;
  const OFFSET_Y = 4;
  const CYCLE_MS = 5000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current = null;
  let split = null;
  let timeline = null;
  let cycleTimer = null;

  // Park off-screen, then follow the cursor with a tight, lightly smoothed ease
  // so the label stays right next to it.
  gsap.set(label, { x: -200, y: -200, opacity: 0 });
  const followDur = reduceMotion ? 0 : 0.16;
  const xTo = gsap.quickTo(label, 'x', { duration: followDur, ease: 'power3' });
  const yTo = gsap.quickTo(label, 'y', { duration: followDur, ease: 'power3' });

  // Read one message or a JSON array of messages from the element's data-label.
  function readMessages(el) {
    const raw = el.getAttribute('data-label');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      if (typeof parsed === 'string' && parsed) return [parsed];
    } catch (e) { /* not JSON — treat as a plain string below */ }
    return [raw];
  }

  function clearAnimation() {
    if (timeline) { timeline.kill(); timeline = null; }
    if (split) {
      gsap.killTweensOf(split.chars);
      split.revert();
      split = null;
    }
  }

  function clearCycle() {
    if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
  }

  // Split `text` into characters and play the intro rise + perpetual wave.
  function buildMessage(text) {
    clearAnimation();
    label.textContent = text;
    split = SplitText.create(label, { type: 'chars', charsClass: 'char' });

    if (reduceMotion) {
      gsap.set(split.chars, { yPercent: 0, opacity: 1 });
      return;
    }

    timeline = gsap.timeline();
    // Intro: each letter rises up from below, staggered.
    timeline.fromTo(
      split.chars,
      { yPercent: 120, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power3.out', stagger: 0.05 }
    );
    // Then keep going: a perpetual staggered wave. The child timeline repeats
    // forever (yoyo), so the letters keep travelling up and back in sequence.
    const wave = gsap.timeline({ repeat: -1, yoyo: true });
    wave.to(split.chars, {
      yPercent: -32,
      duration: 0.55,
      ease: 'sine.inOut',
      stagger: { each: 0.06, from: 'start' }
    });
    timeline.add(wave, '>-0.1');
  }

  function show(el) {
    const messages = readMessages(el);
    if (!messages.length) return;
    current = el;
    // Cancel a pending fade-out *only* — killing all tweens of `label` would
    // also kill the quickTo x/y follow tweens and freeze the label in place.
    gsap.killTweensOf(label, 'opacity');
    gsap.set(label, { opacity: 1 });

    let index = 0;
    buildMessage(messages[index]);

    clearCycle();
    if (messages.length > 1) {
      // Swap to the next message every 5s, replaying the stagger each time.
      cycleTimer = setInterval(function () {
        index = (index + 1) % messages.length;
        buildMessage(messages[index]);
      }, CYCLE_MS);
    }
  }

  function hide() {
    current = null;
    clearCycle();
    gsap.killTweensOf(label, 'opacity'); // leave the x/y follow tweens running
    gsap.to(label, {
      opacity: 0,
      duration: 0.15,
      ease: 'power2.out',
      onComplete: clearAnimation
    });
  }

  window.addEventListener('pointermove', function (e) {
    xTo(e.clientX + OFFSET_X);
    yTo(e.clientY + OFFSET_Y);
  }, { passive: true });

  // Delegated so links added after load (e.g. filter buttons) are covered too.
  document.addEventListener('mouseover', function (e) {
    const el = e.target.closest('[data-label]');
    if (!el || el === current) return;
    if (!el.getAttribute('data-label')) return;
    // No need to reposition here: pointermove tracks the cursor continuously
    // (even while hidden), so the label is already next to the pointer.
    show(el);
  });

  document.addEventListener('mouseout', function (e) {
    if (!current) return;
    if (e.target.closest('[data-label]') !== current) return;
    // Moving onto a child of the labelled element is not a real exit.
    if (e.relatedTarget && current.contains(e.relatedTarget)) return;
    hide();
  });
})();
