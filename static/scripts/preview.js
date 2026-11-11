// Click any plain image in the page content to see it bigger. No buttons:
// scroll or pinch to zoom, drag to pan, double-click to toggle zoom, click the
// background or press Esc to close. Images that carry data-notes (gallery
// images with annotations) show their pins. Styles: static/css/preview.css.
(function () {
  'use strict';

  var root = document.querySelector('.main-content');
  if (!root) return;

  // Plain images only: not links, buttons, the nav, or tiny icons.
  function eligible(img) {
    if (!img || img.tagName !== 'IMG') return false;
    if (img.closest('a, button, nav, .navigation, header, footer, .project-card, .nda-modal, .cover-scene')) return false;
    if (img.hasAttribute('data-no-preview')) return false;
    var r = img.getBoundingClientRect();
    return r.width >= 80 && r.height >= 60;
  }

  function mark() {
    root.querySelectorAll('img').forEach(function (img) {
      if (eligible(img)) img.classList.add('is-zoomable');
    });
  }
  mark();
  window.addEventListener('load', mark);

  // ---- the viewer (built once, on first use) ----

  var pv, stage, canvas, pic, pinsEl;
  var cur = null;
  var opener = null;
  var v = { z: 1, fit: 1, max: 3, x: 0, y: 0, nw: 1, nh: 1 };
  var animTimer = 0;

  function build() {
    pv = document.createElement('div');
    pv.className = 'pv';
    pv.setAttribute('role', 'dialog');
    pv.setAttribute('aria-modal', 'true');
    pv.setAttribute('aria-label', 'Image preview');
    pv.setAttribute('aria-hidden', 'true');
    canvas = document.createElement('div');
    canvas.className = 'pv-canvas';
    pic = document.createElement('img');
    pic.className = 'pv-img';
    pic.alt = '';
    pic.draggable = false;
    pinsEl = document.createElement('div');
    pinsEl.className = 'pv-pins';
    canvas.appendChild(pic);
    canvas.appendChild(pinsEl);
    pv.appendChild(canvas);
    document.body.appendChild(pv);
    stage = pv;
    bindGestures();
  }

  function vw() { return pv.clientWidth; }
  function vh() { return pv.clientHeight; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function apply() {
    canvas.style.transform = 'translate3d(' + v.x + 'px,' + v.y + 'px,0) scale(' + v.z + ')';
    canvas.style.setProperty('--z', v.z);
    pv.classList.toggle('is-zoomed', v.z > v.fit * 1.01);
  }

  // Centred when smaller than the screen, flush to the edges when larger.
  function constrain() {
    var sw = v.nw * v.z;
    var sh = v.nh * v.z;
    v.x = sw <= vw() ? (vw() - sw) / 2 : clamp(v.x, vw() - sw, 0);
    v.y = sh <= vh() ? (vh() - sh) / 2 : clamp(v.y, vh() - sh, 0);
  }

  function computeFit() {
    var pad = vw() < 560 ? 12 : 48;
    v.fit = Math.min(Math.max(100, vw() - pad * 2) / v.nw, Math.max(100, vh() - pad * 2) / v.nh, 2);
    v.max = Math.max(3, v.fit * 3);
  }

  function setNatural(nw, nh) {
    v.nw = nw;
    v.nh = nh;
    canvas.style.width = nw + 'px';
    canvas.style.height = nh + 'px';
  }

  function animated(change) {
    canvas.classList.add('is-anim');
    change();
    clearTimeout(animTimer);
    animTimer = setTimeout(function () { canvas.classList.remove('is-anim'); }, 320);
  }

  function stopAnimation() {
    clearTimeout(animTimer);
    canvas.classList.remove('is-anim');
  }

  function showFit() {
    v.z = v.fit;
    v.x = 0;
    v.y = 0;
    constrain();
    apply();
  }

  function zoomAt(cx, cy, z) {
    z = clamp(z, v.fit, v.max);
    var k = z / v.z;
    v.x = cx - (cx - v.x) * k;
    v.y = cy - (cy - v.y) * k;
    v.z = z;
    constrain();
    apply();
  }

  function toggleZoom(cx, cy) {
    var target = v.z > v.fit * 1.05 ? v.fit : clamp(Math.max(1, v.fit * 2.2), v.fit, v.max);
    animated(function () { zoomAt(cx, cy, target); });
  }

  // ---- notes ----

  function closeNotes() {
    pinsEl.querySelectorAll('.pv-pin.is-open').forEach(function (p) { p.classList.remove('is-open'); });
  }

  function placeNote(pin) {
    var note = pin.querySelector('.pv-note');
    note.classList.remove('below', 'at-left', 'at-right');
    var r = pin.getBoundingClientRect();
    if (r.top < 150) note.classList.add('below');
    if (r.left < 160) note.classList.add('at-left');
    else if (window.innerWidth - r.right < 160) note.classList.add('at-right');
  }

  function buildPins(notes) {
    pinsEl.replaceChildren();
    notes.forEach(function (n, i) {
      var pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pv-pin';
      pin.style.left = n.x * 100 + '%';
      pin.style.top = n.y * 100 + '%';
      pin.setAttribute('aria-label', 'Note ' + (i + 1) + ': ' + n.text);
      pin.textContent = String(i + 1);
      var bubble = document.createElement('span');
      bubble.className = 'pv-note';
      bubble.textContent = n.text;
      pin.appendChild(bubble);
      pin.addEventListener('pointerenter', function () { placeNote(pin); });
      pin.addEventListener('focus', function () { placeNote(pin); });
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = pin.classList.contains('is-open');
        closeNotes();
        if (!wasOpen) {
          placeNote(pin);
          pin.classList.add('is-open');
        }
      });
      pinsEl.appendChild(pin);
    });
  }

  function notesOf(img) {
    var notes = [];
    try { notes = JSON.parse(img.dataset.notes || '[]') || []; } catch (e) {}
    return notes.filter(function (n) { return n && typeof n.x === 'number' && typeof n.y === 'number' && n.text; });
  }

  // ---- open / close ----

  function open(img) {
    if (!pv) build();
    cur = img;
    opener = img;
    stopAnimation();
    closeNotes();

    var full = img.dataset.full || img.currentSrc || img.src;
    var nw = Number(img.dataset.nw) || img.naturalWidth || 1000;
    var nh = Number(img.dataset.nh) || img.naturalHeight || 1000;
    setNatural(nw, nh);
    // The thumbnail is already loaded, so show it straight away and swap in the
    // full-size file once it arrives.
    pic.src = img.currentSrc || img.src;
    pic.alt = img.alt || '';
    buildPins(notesOf(img));
    computeFit();

    if (full !== pic.src) {
      var loader = new Image();
      loader.onload = function () {
        if (cur !== img) return;
        if (loader.naturalWidth && (loader.naturalWidth !== v.nw || loader.naturalHeight !== v.nh)) {
          var atFit = Math.abs(v.z - v.fit) < 0.001;
          setNatural(loader.naturalWidth, loader.naturalHeight);
          computeFit();
          if (atFit) showFit(); else { v.z = clamp(v.z, v.fit, v.max); constrain(); apply(); }
        }
        pic.src = full;
      };
      loader.src = full;
    }

    pv.classList.add('is-open');
    pv.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Grow out of the image that was clicked.
    var r = img.getBoundingClientRect();
    if (r.width && r.bottom > 0 && r.top < window.innerHeight) {
      pv.classList.add('is-flying');
      v.z = r.width / v.nw;
      v.x = r.left;
      v.y = r.top;
      apply();
      void canvas.offsetWidth;
      animated(showFit);
      setTimeout(function () { pv.classList.remove('is-flying'); }, 300);
    } else {
      showFit();
    }
  }

  function close() {
    if (!cur) return;
    var r = cur.getBoundingClientRect();
    pv.classList.remove('is-open');
    pv.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    pv.classList.add('is-flying');
    if (r.width && r.bottom > 0 && r.top < window.innerHeight) {
      animated(function () { v.z = r.width / v.nw; v.x = r.left; v.y = r.top; apply(); });
    }
    cur = null;
  }

  // ---- gestures: drag to pan, pinch / wheel to zoom, double tap to toggle ----

  var pointers = new Map();
  var drag = null;
  var pinch = null;
  var lastTap = null;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function bindGestures() {
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.pv-pin')) return;
      stopAnimation();
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = { sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, moved: false, onImage: e.target === pic };
      } else if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        pinch = { d: dist(pts[0], pts[1]), z: v.z, mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, x: v.x, y: v.y };
        drag = null;
      }
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        var pts = Array.from(pointers.values());
        var z = clamp(pinch.z * dist(pts[0], pts[1]) / pinch.d, v.fit, v.max);
        var k = z / pinch.z;
        var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        v.z = z;
        v.x = mid.x - (pinch.mid.x - pinch.x) * k;
        v.y = mid.y - (pinch.mid.y - pinch.y) * k;
        constrain();
        apply();
      } else if (drag) {
        var dx = e.clientX - drag.sx;
        var dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          stage.classList.add('is-dragging');
        }
        if (drag.moved && v.z > v.fit * 1.01) {
          v.x = drag.ox + dx;
          v.y = drag.oy + dy;
          constrain();
          apply();
        }
      }
    });

    function end(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      stage.classList.remove('is-dragging');
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        drag = null;
        return;
      }
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.moved) return;

      var now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        toggleZoom(e.clientX, e.clientY);
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (pinsEl.querySelector('.pv-pin.is-open')) {
        closeNotes();
      } else if (!d.onImage) {
        // A tap on the background closes, unless it turns into a double tap.
        var tapped = lastTap;
        setTimeout(function () { if (lastTap === tapped && cur) close(); }, 330);
      }
    }

    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      stopAnimation();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // A trackpad pinch arrives as ctrl+wheel and needs a heavier hand.
      zoomAt(e.clientX, e.clientY, v.z * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.002)));
    }, { passive: false });
  }

  // ---- hooking it up ----

  root.addEventListener('click', function (e) {
    var img = e.target;
    if (img.tagName === 'IMG' && img.classList.contains('is-zoomable')) open(img);
  });

  document.addEventListener('keydown', function (e) {
    if (cur && e.key === 'Escape') { e.preventDefault(); close(); }
  });

  window.addEventListener('resize', function () {
    if (!cur) return;
    var atFit = Math.abs(v.z - v.fit) < 0.001;
    computeFit();
    if (atFit) showFit(); else { v.z = clamp(v.z, v.fit, v.max); constrain(); apply(); }
  });
})();
