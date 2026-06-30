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
