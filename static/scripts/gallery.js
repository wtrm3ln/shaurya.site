// Gallery pages: the three-column wall. Clicking an image is handled by
// preview.js, like any other image on the site. Markup: layouts/_default/gallery.html.
(function () {
  'use strict';

  var grid = document.getElementById('galleryGrid');
  if (!grid) return;

  var tiles = Array.prototype.slice.call(grid.querySelectorAll('.g-item'));
  if (!tiles.length) return;

  // ------------------------------------------------------------------
  // The wall: deal images into columns, each to whichever is shortest, so
  // the order reads left to right and the rows never line up.
  // ------------------------------------------------------------------

  var small = window.matchMedia('(max-width: 560px)');
  var medium = window.matchMedia('(max-width: 900px)');
  var cols = 0;

  function wanted() {
    return small.matches ? 1 : medium.matches ? 2 : 3;
  }

  function layout() {
    var n = wanted();
    if (n === cols) return;
    cols = n;
    var columns = [];
    var heights = [];
    for (var i = 0; i < n; i++) {
      var col = document.createElement('div');
      col.className = 'g-col';
      columns.push(col);
      heights.push(0);
    }
    tiles.forEach(function (tile) {
      var k = 0;
      for (var j = 1; j < n; j++) if (heights[j] < heights[k] - 0.001) k = j;
      columns[k].appendChild(tile);
      heights[k] += (Number(tile.dataset.h) || 1) / (Number(tile.dataset.w) || 1) + 0.03;
    });
    grid.classList.add('is-masonry');
    grid.replaceChildren.apply(grid, columns);
  }

  layout();
  var resizeFrame = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(layout);
  });

  // Fade the images in one after another.
  tiles.forEach(function (tile, i) {
    setTimeout(function () { tile.classList.add('in'); }, 80 + Math.min(i, 12) * 70);
  });
})();
