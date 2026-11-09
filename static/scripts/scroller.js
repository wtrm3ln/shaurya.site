const mainHeader = document.getElementById('mainHeader');
const canvas = document.getElementById('pixelCanvas');
const content = document.getElementById('content');
const heading = document.getElementById('heading');
const headerEl = document.querySelector('.header-content');
const body = document.body;

// This effect only fully exists on pages that have the pixel header.
// Bail early elsewhere so we never throw or attach listeners we can't use.
if (canvas && mainHeader) {
const ctx = canvas.getContext('2d');

const basePadding = 40;
const maxPadding = 120;
const threshold = 80;

// Every pixel is a square of the same size on any screen; wider/taller
// viewports just get more columns/rows.
const cellSize = 10;
let gridWidth = 100;
let gridHeight = 30;
let totalPixels = gridWidth * gridHeight;

const colorSets = [
    ['#FF6542', '#393939'],
    ['#E80051', '#FFFFFF'],
    ['#F6AD00', '#FFF1D0'],
    ['#009B72', '#393939'],
    ['#393939', '#FFFFED'],
    ['#9747FF', '#FFFFED'],
    ['#0017E8', '#FFFFED'],
    ['#FF12AF', '#FFFFED'],
];

const headings = [
    'software is eating the world',
    'finding my place between beauty and practicality',
    'ideating on reality',
    'autodidactic',
    'designing with craft and compassion'
];

let pixelStates = [];
let pixelOrder = [];
let pixelRank = [];     // each cell's place (0..1) in the random flip order
let pullProgress = 0;   // 0..1, how far the current pull is toward max
let startY = 0;
let currentPull = 0;
let reachedThreshold = false;
let currentSetIndex = 0;
let nextSetIndex = 0;

// Wheel and drag events fire faster than the display refreshes. Doing layout
// reads + canvas work inside each event is what makes Safari stutter, so we
// coalesce every gesture update into a single render per animation frame.
let rafPending = false;

// Pick a random color set on page load
currentSetIndex = Math.floor(Math.random() * colorSets.length);


// Initialize pixel states and create random order
function initPixels() {
    pixelStates = new Array(totalPixels).fill(0);
    pixelOrder = Array.from({length: totalPixels}, (_, i) => i);

    // Shuffle array
    for (let i = pixelOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pixelOrder[i], pixelOrder[j]] = [pixelOrder[j], pixelOrder[i]];
    }

    pixelRank = new Array(totalPixels);
    for (let k = 0; k < totalPixels; k++) {
        pixelRank[pixelOrder[k]] = k / totalPixels;
    }
}



function setThemeVars(setIndex) {
    document.documentElement.style.setProperty('--themed-primary', colorSets[setIndex][0]);
    document.documentElement.style.setProperty('--themed-secondary', colorSets[setIndex][1]);
}

function applyThemeColors() {
    setThemeVars(currentSetIndex);
}

function getRandomIndex(currentIndex, arrayLength) {
    let newIndex;
    do {
        newIndex = Math.floor(Math.random() * arrayLength);
    } while (newIndex === currentIndex);
    return newIndex;
}

// The canvas is the whole page background: a fixed, viewport-sized layer
// behind the header, the white card and the footer. Because it is one surface,
// every part of the page dissolves to the new colour together.
//
// Size the bitmap to the viewport so it never has to be reallocated while the
// pull is in flight — reassigning canvas.width/height is the expensive op
// Safari can't do every frame. Reads layout, so it only runs at gesture start
// / on resize — never inside the per-frame render.
function measureCanvas() {
    const w = document.documentElement.clientWidth;
    const h = window.innerHeight;
    // A zero-sized viewport (hidden tab / not laid out yet) would make the
    // cell size 0 and the row count infinite; wait for the next resize.
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height < h) {
        canvas.width = w;
        canvas.height = Math.max(h, canvas.height);
    }
    // Show the bitmap 1:1 so the square cells stay square.
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    const cols = Math.ceil(canvas.width / cellSize);
    const rows = Math.ceil(canvas.height / cellSize);
    if (cols !== gridWidth || rows !== gridHeight) {
        gridWidth = cols;
        gridHeight = rows;
        totalPixels = gridWidth * gridHeight;
        initPixels();
    }
}

function drawPixels() {
    const cell = cellSize;

    // Paint everything in the current colour, then only the cells that have
    // already flipped in the next one (most frames flip few or none).
    ctx.fillStyle = colorSets[currentSetIndex][0];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colorSets[nextSetIndex][0];

    for (let i = 0; i < totalPixels; i++) {
        if (pixelStates[i] === 0) continue;
        const col = i % gridWidth;
        const row = Math.floor(i / gridWidth);
        // Snap edges to whole pixels; adjacent cells share an edge so no gaps.
        const x = Math.floor(col * cell);
        const y = Math.floor(row * cell);
        const w = Math.floor((col + 1) * cell) - x;
        const h = Math.floor((row + 1) * cell) - y;

        ctx.fillRect(x, y, w, h);
    }
}


// The header dissolves first, in step with the pull. The rest of the page
// holds off until the pull is bgStart of the way to max, then follows with an
// accelerating curve (slow at first, then fast) so it lands fully flipped at
// the same moment the pull maxes out.
const bgStart = 0.8;
const bgCurve = 5;

function bgProgress(progress) {
    if (progress <= bgStart) return 0;
    const t = (progress - bgStart) / (1 - bgStart);
    return (Math.exp(bgCurve * t) - 1) / (Math.exp(bgCurve) - 1);
}

// Records how far the pull is; the cells are worked out in render(), where the
// header's real (still easing open) bottom edge can be read once per frame.
function updatePixels(progress) {
    pullProgress = progress;

    // Switch text color at 50% progress
    const textColorIndex = progress > 0.5 ? nextSetIndex : currentSetIndex;
    content.style.color = colorSets[textColorIndex][1];
}

// Which cells have flipped: header cells follow the pull, the rest of the page
// follows bgProgress. The header's padding eases open over 400ms, so its real
// bottom edge trails the pull — reading it (rather than predicting it) keeps
// the page beside the white card from flipping early.
function computePixelStates(headerBottom) {
    const cell = cellSize;
    const headerRows = headerBottom / cell;
    const bgThreshold = bgProgress(pullProgress);

    for (let i = 0; i < totalPixels; i++) {
        const inHeader = Math.floor(i / gridWidth) < headerRows;
        pixelStates[i] = pixelRank[i] < (inHeader ? pullProgress : bgThreshold) ? 1 : 0;
    }
}

function scheduleRender() {
    if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(render);
    }
}

// The single place that touches the DOM each frame: one padding write, one
// canvas draw. Batched writes mean at most one layout/paint per frame.
function render() {
    rafPending = false;
    // Read before the padding writes below so it never forces a layout.
    computePixelStates(headerEl.getBoundingClientRect().bottom);
    const newPadding = basePadding + currentPull;
    mainHeader.style.paddingTop = `${newPadding}px`;
    mainHeader.style.paddingBottom = `${newPadding}px`;
    drawPixels();
}

function handlePullStart(clientY) {
    if (window.scrollY !== 0) return false;

    startY = clientY;
    reachedThreshold = false;
    nextSetIndex = getRandomIndex(currentSetIndex, colorSets.length);
    measureCanvas();
    return true;
}

function handlePullMove(clientY) {
    if (window.scrollY !== 0) return;

    const pullDistance = Math.max(0, clientY - startY);
    currentPull = Math.min(pullDistance, maxPadding - basePadding);

    const progress = currentPull / threshold;
    updatePixels(Math.min(progress, 1));

    // Switch the page background the moment we hit max so it matches the
    // header's new colour; restore it if the user drags back below max.
    if (currentPull >= threshold && !reachedThreshold) {
        reachedThreshold = true;
        setThemeVars(nextSetIndex);
    } else if (currentPull < threshold && reachedThreshold) {
        reachedThreshold = false;
        setThemeVars(currentSetIndex);
    }

    scheduleRender();
}

function handlePullEnd() {
    if (reachedThreshold) {
        currentSetIndex = nextSetIndex;
        heading.textContent = headings[Math.floor(Math.random() * headings.length)];
    }

    reachedThreshold = false;
    pullProgress = 0;

    // Commits the new colour (currentSetIndex now === nextSetIndex), or restores
    // the old one if the pull was released before reaching max.
    applyThemeColors();

    currentPull = 0;
    initPixels();
    scheduleRender();
}

// Initialize
measureCanvas();
initPixels();
applyThemeColors();
scheduleRender();
window.addEventListener('resize', () => {
    measureCanvas();
    scheduleRender();
});

// Touch events
window.addEventListener('touchstart', (e) => {
    handlePullStart(e.touches[0].clientY);
});

window.addEventListener('touchmove', (e) => {
    handlePullMove(e.touches[0].clientY);
});

window.addEventListener('touchend', handlePullEnd);

// Mouse events
let isMouseDown = false;

window.addEventListener('mousedown', (e) => {
    if (handlePullStart(e.clientY)) {
        isMouseDown = true;
    }
});

window.addEventListener('mousemove', (e) => {
    if (isMouseDown) {
        handlePullMove(e.clientY);
    }
});

window.addEventListener('mouseup', () => {
    if (isMouseDown) {
        isMouseDown = false;
        handlePullEnd();
    }
});

// Wheel event
//
// A hard flick keeps firing momentum wheel events long after the fingers
// leave the trackpad. Debouncing the settle on the *last* event meant the
// header stayed stuck at max for as long as momentum lasted. Instead we run a
// tiny state machine: one flick == one commit, held at max for a FIXED time,
// with trailing momentum swallowed until the wheel goes quiet again.
const holdAtMax = 750;      // ms held at full pull before settling (constant pause)
const wheelQuietGap = 180;  // wheel must be silent this long to re-arm
const partialSettle = 140;  // snap-back delay for a sub-threshold pull

let wheelPhase = 'idle';    // 'idle' | 'pulling' | 'cooldown'
let settleTimer = null;
let rearmTimer = null;

// The pull may only begin when a wheel gesture *starts* with the page already
// at the top. Scrolling up from further down the page lands on scrollY === 0
// while momentum events are still arriving; those must scroll normally and
// never turn into a pull. A new gesture begins after the wheel has been quiet
// for wheelGestureGap, and a gesture that leaves the top is disqualified.
const wheelGestureGap = 120;  // ms of silence that ends one wheel gesture
let lastWheelTime = 0;
let gestureStartedAtTop = false;

window.addEventListener('wheel', (e) => {
    const now = performance.now();
    if (now - lastWheelTime > wheelGestureGap) {
        gestureStartedAtTop = window.scrollY === 0;
    }
    lastWheelTime = now;

    if (window.scrollY !== 0) {
        gestureStartedAtTop = false;
        return;
    }
    if (!gestureStartedAtTop || e.deltaY >= 0) return;
    e.preventDefault();

    // Already committed — swallow trailing momentum without re-triggering, and
    // only re-arm once the wheel has actually gone quiet.
    if (wheelPhase === 'cooldown') {
        clearTimeout(rearmTimer);
        rearmTimer = setTimeout(() => { wheelPhase = 'idle'; }, wheelQuietGap);
        return;
    }

    if (wheelPhase === 'idle') {
        wheelPhase = 'pulling';
        nextSetIndex = getRandomIndex(currentSetIndex, colorSets.length);
        measureCanvas();
    }

    const pullAmount = Math.abs(e.deltaY) * 0.5;
    currentPull = Math.min(currentPull + pullAmount, maxPadding - basePadding);
    updatePixels(Math.min(currentPull / threshold, 1));
    scheduleRender();

    if (currentPull >= threshold) {
        // Commit: switch the background now (so it matches the header at max),
        // hold for a fixed time, then settle — independent of momentum length.
        reachedThreshold = true;
        setThemeVars(nextSetIndex);
        wheelPhase = 'cooldown';
        clearTimeout(settleTimer);
        settleTimer = setTimeout(handlePullEnd, holdAtMax);
        clearTimeout(rearmTimer);
        rearmTimer = setTimeout(() => { wheelPhase = 'idle'; }, holdAtMax + wheelQuietGap);
    } else {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            handlePullEnd();
            wheelPhase = 'idle';
        }, partialSettle);
    }
}, { passive: false });
}
