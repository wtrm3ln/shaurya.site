const mainHeader = document.getElementById('mainHeader');
const canvas = document.getElementById('pixelCanvas');
const content = document.getElementById('content');
const heading = document.getElementById('heading');
const body = document.body;

// This effect only fully exists on pages that have the pixel header.
// Bail early elsewhere so we never throw or attach listeners we can't use.
if (canvas && mainHeader) {
const ctx = canvas.getContext('2d');

const basePadding = 40;
const maxPadding = 120;
const threshold = 80;

const gridWidth = 100;
const gridHeight = 30;
const totalPixels = gridWidth * gridHeight;

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

// Size the canvas bitmap to the header's *maximum* height (fully pulled) so it
// never has to be reallocated while the pull is in flight — reassigning
// canvas.width/height is the expensive op Safari can't do every frame. The
// grid is full-bleed and CSS stretches the canvas to fit, so the bitmap being
// slightly taller than the resting header is invisible. Reads layout, so it
// only runs at gesture start / on resize — never inside the per-frame render.
function measureCanvas() {
    const w = mainHeader.offsetWidth;
    const maxH = mainHeader.offsetHeight + (maxPadding - basePadding) * 2;
    if (canvas.width !== w || canvas.height < maxH) {
        canvas.width = w;
        canvas.height = maxH;
    }
}

function drawPixels() {
    const pixelWidth = Math.ceil(canvas.width / gridWidth);
    const pixelHeight = Math.ceil(canvas.height / gridHeight);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < totalPixels; i++) {
        const x = Math.floor((i % gridWidth) * (canvas.width / gridWidth));
        const y = Math.floor(Math.floor(i / gridWidth) * (canvas.height / gridHeight));

        const colorIndex = pixelStates[i] === 0 ? currentSetIndex : nextSetIndex;
        ctx.fillStyle = colorSets[colorIndex][0];
        ctx.fillRect(x, y, pixelWidth, pixelHeight);
    }
}


// Pure state update — no layout reads, no drawing. The actual paint happens
// once per frame in render().
function updatePixels(progress) {
    const pixelsToTurn = Math.floor(progress * totalPixels);

    pixelStates.fill(0);
    for (let i = 0; i < pixelsToTurn; i++) {
        pixelStates[pixelOrder[i]] = 1;
    }

    // Switch text color at 50% progress
    const textColorIndex = progress > 0.5 ? nextSetIndex : currentSetIndex;
    content.style.color = colorSets[textColorIndex][1];
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
    pixelStates.fill(0);

    // Commits the new colour (currentSetIndex now === nextSetIndex), or restores
    // the old one if the pull was released before reaching max.
    applyThemeColors();

    currentPull = 0;
    initPixels();
    scheduleRender();
}

// Initialize
initPixels();
measureCanvas();
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

window.addEventListener('wheel', (e) => {
    if (window.scrollY !== 0 || e.deltaY >= 0) return;
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
