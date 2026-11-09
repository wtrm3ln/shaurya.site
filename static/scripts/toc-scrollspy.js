(function () {
  const sidebarLinks = Array.from(document.querySelectorAll('.case-study-sidebar a[href^="#"]'));
  if (!sidebarLinks.length) return;

  const headings = sidebarLinks
    .map((link) => document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1))))
    .filter(Boolean);

  if (!headings.length) return;

  const offset = 110;

  function setActive() {
    let currentIndex = 0;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top - offset <= 0) {
        currentIndex = i;
      } else {
        break;
      }
    }
    sidebarLinks.forEach((link) => link.classList.remove('active'));
    sidebarLinks[currentIndex].classList.add('active');
  }

  // Index clicks: a custom eased scroll (browsers' built-in smooth scrolling
  // has a fixed, quick duration). Slow ease-in-out so it glides rather than
  // snaps; skipped for reduced-motion, and cancelled if the reader scrolls.
  const DURATION = 1400;
  const STOP_OFFSET = 100; // leave room under the sticky nav
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let rafId = null;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function scrollToY(targetY) {
    const startY = window.scrollY;
    const distance = targetY - startY;
    if (rafId) cancelAnimationFrame(rafId);
    if (reduceMotion.matches || Math.abs(distance) < 2) {
      window.scrollTo(0, targetY);
      return;
    }
    // Longer jumps take a little longer, but never snappy or endless.
    const duration = Math.min(2200, Math.max(DURATION * 0.6, DURATION * Math.min(1, Math.abs(distance) / 2000) + 400));
    const startTime = performance.now();

    function cancel() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
    }
    window.addEventListener('wheel', cancel, { passive: true, once: true });
    window.addEventListener('touchstart', cancel, { passive: true, once: true });

    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      window.scrollTo(0, startY + distance * easeInOutCubic(t));
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        cancel();
      }
    }
    rafId = requestAnimationFrame(step);
  }

  sidebarLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      scrollToY(target.getBoundingClientRect().top + window.scrollY - STOP_OFFSET);
      history.pushState(null, '', '#' + id);
    });
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        setActive();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  setActive();
})();
