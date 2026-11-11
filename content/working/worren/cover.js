// Worren's cover: the character from worren.world's footer, in the middle of its grass, going
// through what it does there — waving, hopping, sniffing the grass, stretching and watching
// a butterfly go by, one after another while the grass sways. Hover over it and it watches
// the pointer instead.
//
// The same canvas is the thumbnail on the home page and the banner on the project page
// (partials/cover.html), so everything is measured from the canvas's own size.

const FPS = 16
const TICK = 1000 / FPS
const COLOR = {
  sky: '#FFB300', body: '#F15734', ink: '#664800', light: '#FFF7E5', brick: '#D7340F',
  leaf: '#2B7D24', leafLit: '#2DA80B', dust: '#CC8F00',
}
const INK = { k: COLOR.ink, w: COLOR.light, r: COLOR.brick }
const ART = {
  heart: [' r r ', 'rrrrr', 'rrrrr', ' rrr ', '  r  '],
  flyOpen: ['ww ww', 'wwkww', ' wkw '],
  flyShut: ['  k  ', ' wkw ', ' wkw '],
}

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const mine = new URL(import.meta.url).pathname

for (const canvas of document.querySelectorAll('canvas.cover-scene')) {
  if (canvas.dataset.scene === mine && !canvas.dataset.playing) scene(canvas)
}

function scene(canvas) {
  canvas.dataset.playing = '1'
  const ctx = canvas.getContext('2d')
  let W = 0, H = 0, cell = 8, px = 4, ground = 0

  const rest = () => ({ crouch: 0, ears: false, twitch: -1, tail: false, stretched: false, eyes: 'open', look: 0, down: 0, mouth: false, arm: null })
  let pose = rest(), y = 0, facing = -1
  let ticks = 0, hold = 0, blinkAt = 30, blinkEnd = 0
  let fly = null, real = null, particles = [], rustles = [], gust = null, gustAt = FPS * 3
  const show = choreography()

  function measure() {
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    W = r.width
    H = r.height
    // the character is about two fifths of the height, and never more than a third of the
    // width (a tall banner on a phone), in whole even cells
    cell = Math.max(4, 2 * Math.round(Math.min(H / 34, W / 48)))
    px = cell / 2
    // the grass stands on the bottom edge
    ground = H
    const d = Math.min(devicePixelRatio, 2)
    canvas.width = Math.round(W * d)
    canvas.height = Math.round(H * d)
    ctx.setTransform(d, 0, 0, d, 0, 0)
    draw()
  }
  const left = () => Math.round((W - 7 * cell) / 2)
  const head = () => ({ x: left() + 3.5 * cell, y: ground - (y + 7) * cell })
  const column = (x) => Math.floor(x / px)

  // ── the clock: only while it can be seen ──
  let raf = 0, last = 0, acc = 0, seen = false
  function frame(now) {
    acc += Math.min(now - (last || now), 250)
    last = now
    let stepped = false
    while (acc >= TICK) { acc -= TICK; tick(); stepped = true }
    if (stepped) draw()
    raf = requestAnimationFrame(frame)
  }
  const run = () => {
    if (seen && !still && document.visibilityState === 'visible') { if (!raf) { last = 0; raf = requestAnimationFrame(frame) } }
    else { cancelAnimationFrame(raf); raf = 0 }
  }
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; run() }).observe(canvas)
  document.addEventListener('visibilitychange', run)
  new ResizeObserver(measure).observe(canvas)

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    real = { x: e.clientX - r.left, y: e.clientY - r.top, at: ticks }
    if (real.y > ground - px * 3 && real.y < ground + px) rustle(column(real.x))
  })
  canvas.addEventListener('pointerleave', () => { real = null })

  function tick() {
    ticks++
    if (ticks >= blinkAt) { blinkEnd = ticks + 2; blinkAt = ticks + rand(30, 80) }
    weather()
    particles = particles.filter((p) => { p.x += p.vx; p.y += p.vy; return --p.life > 0 })
    if (fly) {
      fly.x += fly.vx
      fly.y = fly.home + Math.sin(ticks * 0.35) * cell * 0.7
      if (fly.x < -cell * 3 || fly.x > W + cell * 3) fly = null
    }
    // someone's pointer outranks everything: it watches them
    if (real && ticks - real.at < FPS * 3) { watch(real); return }
    if (hold > 0) { hold--; return }
    hold = Math.max((show.next().value ?? 1) - 1, 0)
  }

  // Looks at a point, and turns round when it's behind.
  function watch(at) {
    const h = head(), dx = at.x - h.x
    if (Math.abs(dx) > cell * 2 && Math.sign(dx) !== facing) facing = Math.sign(dx)
    pose.look = Math.abs(dx) < cell ? 0 : 1
    pose.down = at.y < h.y - cell ? -1 : at.y > ground - cell ? 1 : 0
    pose.ears = Math.hypot(dx, at.y - h.y) < cell * 6
  }

  // ── what it does, in turn: each step yields how many ticks to hold ──
  function* choreography() {
    yield FPS
    yield* wave()
    for (;;) {
      const acts = [hop, sniff, stretch, butterfly, wave]
      for (let i = acts.length - 1; i > 0; i--) { const j = rand(0, i); [acts[i], acts[j]] = [acts[j], acts[i]] }
      for (const act of acts) {
        pose = rest(); y = 0
        yield* act()
        pose = rest(); y = 0
        yield rand(FPS, FPS * 2)
      }
    }
  }
  function* wave() {
    pose.ears = true
    for (let i = 0; i < 6; i++) { pose.arm = i % 2 ? 'out' : 'up'; yield 4 }
    pose.arm = null; pose.tail = true; yield 6
  }
  function* hop() {
    for (let n = 0; n < 2; n++) {
      pose.crouch = 1; yield 2
      pose.crouch = 0; pose.ears = true; y = 1; yield 2
      y = 2; yield 3
      y = 1; yield 2
      y = 0; pose.crouch = 1; dust(); yield 2
      pose.crouch = 0; yield 3
    }
  }
  function* stretch() {
    pose.stretched = true; pose.ears = true; pose.eyes = 'closed'; yield 14
    pose.mouth = true; yield 10
    pose.mouth = false; pose.stretched = false; pose.ears = false; pose.eyes = 'open'; yield 4
  }
  function* sniff() {
    pose.crouch = 1; pose.look = 1; pose.down = 1
    const nose = () => column(facing < 0 ? left() - px : left() + 7 * cell + px)
    for (let i = 0; i < 5; i++) { rustle(nose()); pose.twitch = i % 2 ? 0 : 2; yield 5 }
    pose.twitch = -1; pose.crouch = 0; pose.down = 0
    const h = head()
    particles.push({ rows: ART.heart, x: h.x - 2.5 * px, y: h.y - cell * 0.5, vx: 0, vy: -px * 0.5, life: 22 })
    yield 10
  }
  function* butterfly() {
    const fromLeft = Math.random() < 0.5
    fly = { x: fromLeft ? -cell * 2 : W + cell * 2, vx: (fromLeft ? 1 : -1) * Math.max(W / (FPS * 5), cell * 0.2), home: ground - 11 * cell }
    fly.y = fly.home
    let hopped = false
    while (fly) {
      watch(fly)
      pose.down = -1
      if (!hopped && Math.abs(fly.x - head().x) < cell * 2) {
        hopped = true
        pose.crouch = 1; yield 2
        pose.crouch = 0; y = 1; yield 2
        y = 2; yield 3
        y = 1; yield 2
        y = 0; dust()
      }
      yield 1
    }
  }
  // ── the grass ──
  function weather() {
    if (!gust && ticks >= gustAt) gust = { from: ticks, dir: Math.random() < 0.5 ? 1 : -1 }
    if (gust && (ticks - gust.from) * 3 > W / px + 40) { gust = null; gustAt = ticks + rand(FPS * 5, FPS * 10) }
    rustles = rustles.filter((r) => ticks - r.at < FPS * 1.5)
  }
  function rustle(i) {
    if (rustles.length > 40) rustles.shift()
    rustles.push({ i, at: ticks })
  }
  function sway(i) {
    const t = ticks / FPS
    let o = Math.sin(t * 1.6 + i * 0.3) * 0.6 + Math.sin(t * 0.5 + i * 0.05) * 0.5
    if (gust) {
      const front = gust.dir > 0 ? (ticks - gust.from) * 3 - 20 : W / px + 20 - (ticks - gust.from) * 3
      o += gust.dir * 1.8 * Math.exp(-(((i - front) / 7) ** 2))
    }
    for (const r of rustles) {
      const dd = Math.abs(i - r.i)
      if (dd > 3) continue
      const age = (ticks - r.at) / FPS
      o += 1.6 * Math.exp(-age * 2.5) * Math.sin(age * 22 + dd) * (1 - dd / 4)
    }
    return Math.round(o)
  }
  const tall = (i) => { const h = hash(i); return h < 0.15 ? 0 : h < 0.45 ? 1 : h < 0.85 ? 2 : 3 }
  function drawGrass(front) {
    const n = Math.ceil(W / px)
    ctx.fillStyle = front ? COLOR.leafLit : COLOR.leaf
    for (let i = 0; i < n; i++) {
      const h = front ? (hash(i + 900) > 0.92 ? 2 : 0) : tall(i)
      if (!h) continue
      const o = sway(i)
      for (let k = 0; k < h; k++) ctx.fillRect(i * px + Math.round((o * (k + 1)) / h) * px, ground - (k + 1) * px, px, px)
    }
  }
  function dust() {
    const x = left() + 3.5 * cell
    for (const s of [-1, 1]) particles.push({ x: x + s * cell * 2, y: ground - px, vx: s * px * 0.5, vy: -px * 0.3, life: 6, color: COLOR.dust })
    rustle(column(x - cell * 2)); rustle(column(x + cell * 2))
  }

  // ── drawing ──
  function art(rows, x, bottom) {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const color = INK[row[c]]
        if (!color) continue
        ctx.fillStyle = color
        ctx.fillRect(Math.round(x + c * px), Math.round(bottom - (rows.length - r) * px), px, px)
      }
    })
  }
  function drawWorren() {
    const p = pose, x0 = left()
    const path = new Path2D()
    const block = (ox, row, w, h) => {
      const across = facing < 0 ? ox : 7 - ox - w
      path.rect(x0 + across * cell, ground - (y + 7 - row) * cell, w * cell, h * cell)
    }
    const shift = (p.stretched ? -1 : 0) + (p.crouch === 1 ? 1 : 0)
    const closed = p.eyes === 'closed' || (p.eyes === 'open' && ticks < blinkEnd)
    block(0, 1 + shift, 6, 5)
    ;[1, 3, 5].forEach((ear, i) => {
      const tall = (p.ears ? 2 : p.twitch === i ? 1.5 : 1) + (p.ears && p.twitch === i ? 0.5 : 0)
      block(ear, 1 + shift - tall, 1, tall)
    })
    if (p.crouch === 0) for (const leg of [1, 3, 5]) block(leg, 6 + (p.stretched ? -1 : 0), 1, p.stretched ? 2 : 1)
    block(6, (p.tail ? 4 : 5) + shift, 1, 1)
    const ex = -p.look * 0.5, ey = p.down * 0.5
    for (const eye of [2, 4]) {
      if (closed) block(eye + ex, 3 + shift, 1, 0.5)
      else block(eye + ex, 2 + ey + shift, 1, 2)
    }
    if (p.mouth) block(3, 4.5 + shift, 1, 1)
    if (p.arm === 'out') block(-1, 3 + shift, 1, 1)
    if (p.arm === 'up') block(-1, 1 + shift, 1, 2)
    ctx.fillStyle = COLOR.body
    ctx.fill(path, 'evenodd')
  }
  function draw() {
    if (!W) return
    ctx.fillStyle = COLOR.sky
    ctx.fillRect(0, 0, W, H)
    drawGrass(false)
    drawWorren()
    drawGrass(true)
    if (fly) art(ticks % 4 < 2 ? ART.flyOpen : ART.flyShut, fly.x - 2.5 * px, fly.y)
    for (const p of particles) {
      if (p.rows) art(p.rows, p.x, p.y)
      else { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), px, px) }
    }
  }

  measure()
}
