import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three'

import { assetUrls } from '../bloxity/avatarAssets'
import { VILLAIN_BY_ID, VILLAINS } from '../state/content'

/**
 * Villain skins, painted at runtime directly onto the Bloxity body UV layout (read
 * out of player.glb), so a villain is the player's own rig wearing a different
 * texture - same skeleton, same animations, no extra models to download.
 *
 * The layout is the Bloxity 64 x 64 grid, painted at SKIN_SCALE x that: clothing
 * stays chunky and blocky, while faces get real detail - big glossy eyes, lashes,
 * lipstick and blush for the women, scowls and smirks for the men.
 *
 * Regions are [x, y, w, h] in grid pixels, y down. On side faces row 0 is the top of
 * the limb. +X is the character's left (it faces +Z).
 */
export const SKIN_SCALE = 4
const SKIN_PX = 64 * SKIN_SCALE

const R = {
  head: {
    back: [1, 4, 8, 8],
    top: [1, 12, 8, 8],
    front: [1, 20, 8, 8],
    bottom: [1, 28, 8, 8],
    left: [21, 20, 8, 8],
    right: [11, 20, 8, 8],
  },
  torso: {
    front: [39, 29, 14, 12],
    back: [17, 29, 14, 12],
    top: [39, 21, 14, 8],
    bottom: [39, 41, 14, 8],
    right: [31, 29, 8, 12],
    left: [53, 29, 8, 12],
  },
  armL: {
    front: [30, 7, 6, 12],
    top: [30, 0, 6, 7],
    outer: [10, 7, 7, 12],
    back: [17, 7, 6, 12],
    inner: [23, 7, 7, 12],
    bottom: [30, 19, 6, 7],
  },
  armR: {
    front: [57, 8, 6, 12],
    top: [57, 1, 6, 7],
    outer: [50, 8, 7, 12],
    back: [44, 8, 6, 12],
    inner: [37, 8, 7, 12],
    bottom: [57, 20, 6, 7],
  },
  legL: {
    front: [3, 38, 7, 12],
    top: [21, 42, 7, 8],
    outer: [7, 51, 8, 12],
    back: [15, 51, 7, 12],
    inner: [22, 51, 8, 12],
    bottom: [12, 42, 7, 8],
  },
  legR: {
    front: [55, 51, 7, 12],
    top: [55, 43, 7, 8],
    outer: [47, 51, 8, 12],
    back: [40, 51, 7, 12],
    inner: [32, 51, 8, 12],
    bottom: [30, 42, 7, 8],
  },
}

const SIDE_FACES = {
  head: ['front', 'back', 'left', 'right'],
  torso: ['front', 'back', 'left', 'right'],
  arm: ['front', 'outer', 'back', 'inner'],
  leg: ['front', 'outer', 'back', 'inner'],
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** '#rrggbb' scaled towards black (k < 1) or white (k > 1). */
function tone(hex, k) {
  const v = parseInt(hex.slice(1), 16)
  const ch = (shift) => {
    const c = (v >> shift) & 255
    const out = k <= 1 ? c * k : c + (255 - c) * (k - 1)
    return Math.max(0, Math.min(255, Math.round(out)))
  }
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

/** '#rrggbb' with an alpha, for soft overlays. */
function alpha(hex, a) {
  const v = parseInt(hex.slice(1), 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

/** Painting in grid pixels (the context is scaled by SKIN_SCALE). */
function makePainter(ctx) {
  const fill = (rect, color) => {
    ctx.fillStyle = color
    ctx.fillRect(rect[0], rect[1], rect[2], rect[3])
  }
  /** Rows [r0, r1) of a face. */
  const rows = (rect, r0, r1, color) => {
    const a = Math.max(0, r0)
    const b = Math.min(rect[3], r1)
    if (b <= a) return
    ctx.fillStyle = color
    ctx.fillRect(rect[0], rect[1] + a, rect[2], b - a)
  }
  /** Columns [c0, c1) of a face, rows [r0, r1). Fractions are fine: 0.25 = one texel. */
  const block = (rect, c0, r0, c1, r1, color) => {
    ctx.fillStyle = color
    ctx.fillRect(rect[0] + c0, rect[1] + r0, c1 - c0, r1 - r0)
  }
  const px = (rect, c, r, color) => block(rect, c, r, c + 1, r + 1, color)
  /** A filled ellipse centred at (c, r) inside a face. */
  const oval = (rect, c, r, rc, rr, color) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(rect[0] + c, rect[1] + r, rc, rr, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  /** A stroked polyline through face points [[c, r], ...]. */
  const line = (rect, points, width, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    points.forEach(([c, r], i) => (i ? ctx.lineTo(rect[0] + c, rect[1] + r) : ctx.moveTo(rect[0] + c, rect[1] + r)))
    ctx.stroke()
  }
  /** A filled polygon through face points. */
  const poly = (rect, points, color) => {
    ctx.fillStyle = color
    ctx.beginPath()
    points.forEach(([c, r], i) => (i ? ctx.lineTo(rect[0] + c, rect[1] + r) : ctx.moveTo(rect[0] + c, rect[1] + r)))
    ctx.closePath()
    ctx.fill()
  }
  return { ctx, fill, rows, block, px, oval, line, poly }
}

/** Subtle per-texel brightness noise, so flat clothing reads as fabric. */
function addGrain(ctx, rect, rng, amount = 0.06) {
  const [x, y, w, h] = rect.map((v) => v * SKIN_SCALE)
  const img = ctx.getImageData(x, y, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const k = 1 + (rng() * 2 - 1) * amount
    d[i] = Math.min(255, d[i] * k)
    d[i + 1] = Math.min(255, d[i + 1] * k)
    d[i + 2] = Math.min(255, d[i + 2] * k)
  }
  ctx.putImageData(img, x, y)
}

/** Soft top-lit volume on a side face: brighter at the top, deeper at the bottom. */
function shadeFace(p, rect, strength = 1) {
  const g = p.ctx.createLinearGradient(0, rect[1], 0, rect[1] + rect[3])
  g.addColorStop(0, `rgba(255,255,255,${0.1 * strength})`)
  g.addColorStop(0.35, 'rgba(255,255,255,0)')
  g.addColorStop(1, `rgba(20,10,40,${0.24 * strength})`)
  p.ctx.fillStyle = g
  p.ctx.fillRect(rect[0], rect[1], rect[2], rect[3])
}

/* --- Hair -------------------------------------------------------------------- */

function paintHair(p, look) {
  const { hair, hairStyle } = look
  const H = R.head
  const dark = tone(hair, 0.78)
  const shine = tone(hair, 1.35)
  const tips = look.hairTips
  if (hairStyle === 'bald') return
  p.fill(H.top, hair)
  switch (hairStyle) {
    case 'long':
      // Parted in the middle, framing the face, falling down the back and sides.
      p.fill(H.back, hair)
      p.rows(H.front, 0, 1.5, hair)
      p.poly(H.front, [[0, 0], [3.6, 0], [1.2, 2.6], [0, 5.5]], hair)
      p.poly(H.front, [[8, 0], [4.4, 0], [6.8, 2.6], [8, 5.5]], hair)
      p.block(H.front, 0, 0, 0.75, 8, hair)
      p.block(H.front, 7.25, 0, 8, 8, hair)
      for (const side of [H.left, H.right]) p.rows(side, 0, 8, hair)
      if (tips) {
        p.rows(H.back, 6, 8, tips)
        for (const side of [H.left, H.right]) p.rows(side, 6.5, 8, tips)
        p.block(H.front, 0, 6.5, 0.75, 8, tips)
        p.block(H.front, 7.25, 6.5, 8, 8, tips)
      }
      break
    case 'bangs':
      // A full fringe with a scalloped edge, long at the sides.
      p.fill(H.back, hair)
      p.rows(H.front, 0, 2, hair)
      for (let c = 0; c < 8; c += 1) p.poly(H.front, [[c, 2], [c + 1, 2], [c + 0.5, 2.9]], hair)
      p.block(H.front, 0, 0, 0.75, 6.5, hair)
      p.block(H.front, 7.25, 0, 8, 6.5, hair)
      for (const side of [H.left, H.right]) p.rows(side, 0, 7, hair)
      if (tips) for (const side of [H.left, H.right]) p.rows(side, 5.5, 7, tips)
      break
    case 'curly':
      p.rows(H.front, 0, 2, hair)
      p.px(H.front, 2, 2, hair)
      p.px(H.front, 5, 2, hair)
      for (const side of [H.left, H.right]) p.rows(side, 0, 3, hair)
      p.rows(H.back, 0, 6, hair)
      for (let c = 0.5; c < 8; c += 2) p.oval(H.front, c, 1.2, 0.5, 0.4, dark)
      break
    case 'spiky':
      p.rows(H.front, 0, 1, hair)
      for (let c = 0; c < 8; c += 2) p.poly(H.front, [[c, 1], [c + 2, 1], [c + 1, 2.4]], hair)
      for (const side of [H.left, H.right]) {
        p.rows(side, 0, 2, hair)
        p.poly(side, [[0, 2], [3, 2], [1.5, 3.4]], hair)
        p.poly(side, [[4, 2], [7, 2], [5.5, 3.4]], hair)
      }
      p.rows(H.back, 0, 5, hair)
      break
    case 'slick':
      p.rows(H.front, 0, 1, hair)
      p.poly(H.front, [[0, 1], [2.5, 1], [0, 2.4]], hair)
      for (const side of [H.left, H.right]) p.rows(side, 0, 2, hair)
      p.rows(H.back, 0, 4, hair)
      for (let r = 1; r < 8; r += 2) p.block(H.top, 0, r, 8, r + 0.35, dark)
      if (tips) p.block(H.top, 3.2, 0, 4.8, 8, tips)
      break
    case 'short':
    default:
      p.rows(H.front, 0, 1, hair)
      p.poly(H.front, [[0, 1], [3, 1], [1, 2]], hair)
      p.poly(H.front, [[8, 1], [5, 1], [7, 2]], hair)
      for (const side of [H.left, H.right]) p.rows(side, 0, 3, hair)
      p.rows(H.back, 0, 5, hair)
      break
  }
  // An anime shine band across the top and back.
  p.block(H.top, 0.5, 5.6, 7.5, 6.1, shine)
  p.block(H.back, 1, 1, 7, 1.4, alpha('#ffffff', 0.35))
  if (hairStyle === 'long' || hairStyle === 'bangs') p.block(H.front, 2, 0.45, 6, 0.75, alpha('#ffffff', 0.3))
}

/* --- Faces ------------------------------------------------------------------- */

/**
 * One eye in face cells, centred at (c, r). Women's eyes are bigger and rounder with
 * a lash line and a flick; men's are narrower under a heavy brow. Glowing eyes are
 * solid light with a halo.
 */
function paintEye(p, F, c, r, look, mirror) {
  const female = look.gender === 'f'
  const iris = look.eyeColor || '#3d2a1a'
  const ink = '#1a1020'
  if (look.eyeGlow) {
    p.oval(F, c, r, female ? 1.15 : 1.05, female ? 0.85 : 0.6, alpha(iris.startsWith('#') ? iris : '#ff2a2a', 0.35))
    p.oval(F, c, r, female ? 0.82 : 0.78, female ? 0.6 : 0.42, iris)
    p.oval(F, c - 0.15, r - 0.1, 0.32, 0.22, '#ffffff')
  } else {
    const rx = female ? 0.9 : 0.82
    const ry = female ? 0.82 : 0.52
    p.oval(F, c, r, rx, ry, '#ffffff')
    p.oval(F, c, r + 0.05, female ? 0.6 : 0.42, female ? 0.72 : 0.5, iris)
    p.oval(F, c, r + 0.25, female ? 0.6 : 0.42, female ? 0.42 : 0.28, tone(iris.startsWith('#') ? iris : '#3d2a1a', 0.7))
    p.oval(F, c, r + 0.08, female ? 0.28 : 0.2, female ? 0.36 : 0.26, ink)
    p.oval(F, c + (mirror ? -0.28 : 0.28), r - 0.3, 0.2, 0.2, '#ffffff')
    if (female) p.oval(F, c - (mirror ? -0.3 : 0.3), r + 0.35, 0.1, 0.1, '#ffffff')
  }
  if (female) {
    // Upper lash line with an outer flick, a hint of a lower lash.
    const o = mirror ? -1 : 1
    p.line(F, [[c - 0.95 * o, r - 0.45], [c, r - 0.9], [c + 0.95 * o, r - 0.5], [c + 1.35 * o, r - 0.95]], 0.32, ink)
    p.line(F, [[c - 0.5 * o, r + 0.8], [c + 0.6 * o, r + 0.75]], 0.12, alpha('#1a1020', 0.6))
  } else {
    p.line(F, [[c - 0.85, r - 0.45], [c + 0.85, r - 0.45]], 0.22, ink)
  }
}

function paintBrows(p, F, look) {
  const female = look.gender === 'f'
  const color = look.hairStyle === 'bald' || !look.hair ? tone(look.skin, 0.5) : tone(look.hair, 0.6)
  const angry = look.brows === 'angry' || (!female && look.brows !== 'none')
  if (look.brows === 'none') return
  if (female) {
    p.line(F, [[1.3, 2.05], [2.1, 1.75], [3.0, 1.95]], 0.2, color)
    p.line(F, [[6.7, 2.05], [5.9, 1.75], [5.0, 1.95]], 0.2, color)
  } else if (angry) {
    p.line(F, [[1.0, 1.75], [2.2, 2.0], [3.3, 2.45]], 0.42, color)
    p.line(F, [[7.0, 1.75], [5.8, 2.0], [4.7, 2.45]], 0.42, color)
  }
}

function paintMouth(p, F, look) {
  const ink = '#1a1020'
  const white = '#ffffff'
  const lips = look.lips
  if (lips) {
    // Lipstick: a bowed upper lip and a fuller lower lip with a shine.
    p.poly(F, [[2.9, 6.05], [3.6, 5.75], [4, 5.95], [4.4, 5.75], [5.1, 6.05], [4, 6.35]], tone(lips, 0.85))
    p.poly(F, [[3.05, 6.1], [5, 6.1], [4.6, 6.75], [3.4, 6.75]], lips)
    p.block(F, 3.7, 6.32, 4.25, 6.45, alpha('#ffffff', 0.55))
    if (look.mouth === 'fangs') {
      p.poly(F, [[3.35, 6.15], [3.65, 6.15], [3.5, 6.75]], white)
      p.poly(F, [[4.35, 6.15], [4.65, 6.15], [4.5, 6.75]], white)
    }
    return
  }
  switch (look.mouth) {
    case 'teeth':
      p.block(F, 1.6, 5.6, 6.4, 6.9, '#3a0a14')
      p.block(F, 1.7, 5.65, 6.3, 6.15, white)
      p.block(F, 1.7, 6.45, 6.3, 6.85, white)
      for (let c = 2.2; c < 6.3; c += 0.7) p.block(F, c, 5.65, c + 0.08, 6.85, '#3a0a14')
      break
    case 'snarl':
      p.poly(F, [[2.2, 6.2], [5.8, 5.9], [5.2, 6.7], [2.8, 6.8]], '#3a0a14')
      p.block(F, 2.6, 6.0, 5.5, 6.25, white)
      break
    case 'grin':
      p.poly(F, [[2, 5.7], [6, 5.7], [5, 6.7], [3, 6.7]], ink)
      p.poly(F, [[2.4, 5.8], [5.6, 5.8], [5.2, 6.2], [2.8, 6.2]], white)
      break
    case 'flat':
      p.line(F, [[2.9, 6.2], [5.1, 6.2]], 0.3, ink)
      break
    case 'smirk':
    default:
      // The villain's smirk: one corner pulled up.
      p.line(F, [[2.8, 6.25], [4.4, 6.3], [5.4, 5.85]], 0.3, ink)
  }
}

/**
 * Full-face villain designs that replace the regular eyes and mouth. Return true when
 * the face is complete.
 */
function paintVillainFace(p, look) {
  const F = R.head.front
  const white = '#ffffff'
  const glow = look.eyeColor || '#ff2a2a'
  switch (look.face) {
    case 'widow':
      // Symbiote eyes: big white teardrops sweeping up to sharp points, red lips.
      p.poly(F, [[0.6, 2.2], [3.6, 3.3], [3.3, 4.6], [1.6, 4.4], [0.9, 3.5]], white)
      p.poly(F, [[7.4, 2.2], [4.4, 3.3], [4.7, 4.6], [6.4, 4.4], [7.1, 3.5]], white)
      p.line(F, [[0.6, 2.2], [3.6, 3.3]], 0.18, '#3a3a5a')
      p.line(F, [[7.4, 2.2], [4.4, 3.3]], 0.18, '#3a3a5a')
      paintMouth(p, F, look)
      return true
    case 'visor': {
      const band = look.visor || '#ff2a2a'
      for (const face of [F, R.head.left, R.head.right]) p.rows(face, 2, 5, '#1a1a1e')
      const g = p.ctx.createLinearGradient(F[0], 0, F[0] + 8, 0)
      g.addColorStop(0, tone(band, 0.6))
      g.addColorStop(0.5, tone(band, 1.5))
      g.addColorStop(1, tone(band, 0.6))
      p.ctx.fillStyle = g
      p.ctx.fillRect(F[0] + 0.6, F[1] + 2.9, 6.8, 1.2)
      for (const face of [R.head.left, R.head.right]) p.block(face, 0, 3, 8, 4, tone(band, 0.7))
      p.block(F, 2, 6, 6, 6.6, tone(look.skin, 0.55))
      for (let c = 2.4; c < 6; c += 0.8) p.block(F, c, 6, c + 0.15, 6.6, tone(look.skin, 0.35))
      return true
    }
    case 'ironMask':
      p.fill(F, tone(look.skin, 1.08))
      p.poly(F, [[0.9, 3.1], [3.3, 3.4], [3.1, 4.0], [1.0, 3.7]], '#0c0c10')
      p.poly(F, [[7.1, 3.1], [4.7, 3.4], [4.9, 4.0], [7.0, 3.7]], '#0c0c10')
      p.oval(F, 2.2, 3.55, 0.45, 0.22, glow)
      p.oval(F, 5.8, 3.55, 0.45, 0.22, glow)
      for (const [c, r] of [[0.6, 1], [7.4, 1], [0.6, 6.6], [7.4, 6.6]]) p.oval(F, c, r, 0.22, 0.22, tone(look.skin, 0.55))
      for (let c = 2.6; c < 5.6; c += 0.7) p.block(F, c, 5.3, c + 0.3, 6.9, '#2a2a2a')
      p.block(F, 3.6, 1, 4.4, 3, tone(look.skin, 0.8))
      return true
    case 'stitch':
      // Burlap sack: hollow eyes with a burning dot, a stitched-up grin.
      p.oval(F, 2.1, 3.1, 1.0, 0.85, '#2a1a0a')
      p.oval(F, 5.9, 3.1, 1.0, 0.85, '#2a1a0a')
      p.oval(F, 2.1, 3.2, 0.32, 0.32, glow)
      p.oval(F, 5.9, 3.2, 0.32, 0.32, glow)
      p.line(F, [[1.4, 5.6], [4, 6.4], [6.6, 5.6]], 0.3, '#3a2410')
      for (let c = 1.8; c < 6.4; c += 0.8) p.line(F, [[c, 5.4], [c + 0.3, 6.6]], 0.16, '#3a2410')
      return true
    default:
      return false
  }
}

function paintFace(p, look) {
  const F = R.head.front
  if (paintVillainFace(p, look)) return

  // A soft shadow under the fringe and a hint of a nose.
  p.block(F, 0.8, 2.3, 7.2, 2.6, alpha('#3a1020', 0.12))
  p.block(F, 3.85, 4.9, 4.15, 5.1, tone(look.skin, 0.8))

  if (look.face === 'jester') {
    // Clown make-up: diamonds over the eyes, a huge red grin.
    for (const c of [2.2, 5.8]) p.poly(F, [[c, 1.6], [c + 1.1, 3.5], [c, 5.0], [c - 1.1, 3.5]], '#6b2fa8')
  }
  if (look.face === 'mask') {
    const m = look.maskColor || '#141414'
    p.poly(F, [[0, 2.6], [8, 2.6], [8, 3.9], [5.2, 4.6], [4, 4.0], [2.8, 4.6], [0, 3.9]], m)
    for (const face of [R.head.left, R.head.right]) p.rows(face, 2.8, 3.8, m)
  }
  if (look.face === 'doll') {
    // Marionette lines on the chin.
    p.line(F, [[2.6, 6.6], [2.6, 8]], 0.14, alpha('#7a3a2a', 0.6))
    p.line(F, [[5.4, 6.6], [5.4, 8]], 0.14, alpha('#7a3a2a', 0.6))
  }
  if (look.face === 'titan') {
    const ridge = tone(look.skin, 0.68)
    for (let c = 1.4; c < 7; c += 1.1) p.line(F, [[c, 6.9], [c + 0.3, 7.8]], 0.2, ridge)
  }

  paintBrows(p, F, look)
  const doll = look.face === 'doll'
  if (doll) {
    // Big glassy doll eyes.
    for (const [c, m] of [[2.2, false], [5.8, true]]) {
      p.oval(F, c, 3.5, 1.15, 1.15, '#ffffff')
      p.oval(F, c, 3.6, 0.85, 0.9, look.eyeColor)
      p.oval(F, c, 3.65, 0.4, 0.45, '#101018')
      p.oval(F, c + (m ? -0.35 : 0.35), 3.15, 0.25, 0.25, '#ffffff')
      p.oval(F, c - (m ? -0.3 : 0.3), 4.0, 0.12, 0.12, '#ffffff')
      p.line(F, [[c - 1.2, 2.6], [c, 2.2], [c + 1.2, 2.6]], 0.28, '#1a1020')
    }
  } else {
    paintEye(p, F, 2.2, 3.55, look, false)
    paintEye(p, F, 5.8, 3.55, look, true)
  }
  if (look.makeup === 'ringed') {
    p.oval(F, 2.2, 3.6, 1.4, 1.1, alpha('#3a1a4a', 0.35))
    p.oval(F, 5.8, 3.6, 1.4, 1.1, alpha('#3a1a4a', 0.35))
  }

  if (look.blush) {
    p.oval(F, 1.3, 5.1, 0.75, 0.38, 'rgba(255,90,130,0.38)')
    p.oval(F, 6.7, 5.1, 0.75, 0.38, 'rgba(255,90,130,0.38)')
  }
  if (look.beautyMark) p.oval(F, 6.0, 5.6, 0.14, 0.14, '#2a1010')
  if (look.scar) p.line(F, [[5.3, 1.2], [6.4, 2.6], [5.8, 5.0]], 0.2, tone(look.skin, 0.6))
  if (look.mustache) p.poly(F, [[2.4, 5.6], [4, 5.3], [5.6, 5.6], [5.2, 6.0], [4, 5.7], [2.8, 6.0]], look.mustache)
  if (look.beard) {
    p.rows(F, 6.4, 8, look.beard)
    for (const side of [R.head.left, R.head.right]) p.rows(side, 5.5, 8, look.beard)
  }

  if (look.face === 'jester') {
    const red = '#d21f2a'
    p.poly(F, [[0.8, 5.0], [7.2, 5.0], [6.2, 6.8], [1.8, 6.8]], red)
    p.poly(F, [[1.5, 5.3], [6.5, 5.3], [5.8, 6.1], [2.2, 6.1]], '#ffffff')
    for (let c = 2.4; c < 6; c += 0.7) p.block(F, c, 5.3, c + 0.1, 6.1, '#e8d8d8')
    p.line(F, [[0.6, 4.6], [0.9, 5.2]], 0.2, red)
    p.line(F, [[7.4, 4.6], [7.1, 5.2]], 0.2, red)
    return
  }
  if (doll) {
    p.poly(F, [[3.5, 6.0], [4, 5.75], [4.5, 6.0], [4, 6.5]], look.lips || '#ff6f91')
    return
  }
  paintMouth(p, F, look)
}

/* --- Body -------------------------------------------------------------------- */

function paintTorso(p, look, rng) {
  const T = R.torso
  const shirt = look.shirt || look.skin
  for (const face of ['front', 'back', 'left', 'right', 'top']) p.fill(T[face], look.shell ? look.skin : shirt)
  p.fill(T.bottom, look.skirt || look.pants || shirt)

  if (look.stripes) {
    for (const face of SIDE_FACES.torso) for (let r = 1; r < 12; r += 3) p.rows(T[face], r, r + 0.6, look.stripes)
  }
  if (look.diamonds) {
    // Harlequin checker in diamonds.
    for (const face of SIDE_FACES.torso) {
      const [, , w, h] = T[face]
      for (let r = 0; r < h; r += 2) {
        for (let c = (r / 2) % 2 ? 1 : -1; c < w; c += 4) {
          p.poly(T[face], [[c + 1, r], [c + 2, r + 1], [c + 1, r + 2], [c, r + 1]], look.diamonds)
        }
      }
    }
  }
  if (look.stars || look.sparkle) {
    const color = look.stars || look.sparkle
    for (const face of SIDE_FACES.torso) {
      const [, , w, h] = T[face]
      for (let k = 0; k < 9; k += 1) {
        const c = rng() * w
        const r = rng() * h
        p.block(T[face], c, r, c + 0.25, r + 0.25, color)
        if (k % 3 === 0) {
          p.block(T[face], c - 0.25, r, c + 0.5, r + 0.25, alpha('#ffffff', 0.5))
          p.block(T[face], c, r - 0.25, c + 0.25, r + 0.5, alpha('#ffffff', 0.5))
        }
      }
    }
  }
  if (look.patches) {
    p.block(T.front, 1, 6, 4, 9, look.patches)
    p.block(T.back, 8, 2, 12, 5, look.patches)
    p.block(T.right, 2, 3, 5, 6, look.patches)
    for (const [f, c, r] of [['front', 1, 6], ['back', 8, 2]]) p.line(T[f], [[c, r], [c + 3, r]], 0.12, '#3a2410')
  }
  if (look.veins) {
    for (const face of SIDE_FACES.torso) {
      const [, , w, h] = T[face]
      for (let k = 0; k < 3; k += 1) {
        const c = rng() * w
        p.line(T[face], [[c, 0], [c + rng() * 2 - 1, h * 0.5], [c + rng() * 2 - 1, h]], 0.15, look.veins)
      }
    }
  }
  if (look.shell) {
    // Seashell top.
    for (const c of [4.2, 9.8]) {
      p.oval(T.front, c, 3.2, 2.0, 1.6, look.shirt)
      for (let k = -1; k <= 1; k += 1) p.line(T.front, [[c, 4.6], [c + k * 1.3, 2.0]], 0.15, tone(look.shirt, 0.75))
    }
    p.rows(T.back, 2, 3, look.shirt)
  }
  if (look.corset) {
    p.block(T.front, 3.5, 3, 10.5, 12, look.corset)
    for (let r = 4; r < 11.5; r += 1.4) {
      p.line(T.front, [[5.6, r], [8.4, r + 1.1]], 0.16, tone(look.corset, 1.5))
      p.line(T.front, [[8.4, r], [5.6, r + 1.1]], 0.16, tone(look.corset, 1.5))
    }
    for (const face of ['left', 'right']) p.rows(T[face], 6, 12, tone(look.corset, 0.85))
  }
  if (look.collar) {
    p.rows(T.front, 0, 1, look.collar)
    p.poly(T.front, [[0, 1], [5, 1], [7, 3], [9, 1], [14, 1], [14, 2], [9, 2], [7, 4], [5, 2], [0, 2]], look.collar)
    p.rows(T.back, 0, 3, look.collar)
    p.fill(T.top, look.collar)
  }
  if (look.trim) {
    p.block(T.front, 6.5, 0, 7.5, 12, look.trim)
    p.rows(T.front, 11.4, 12, look.trim)
    for (const face of ['left', 'right', 'back']) p.rows(T[face], 11.4, 12, look.trim)
  }
  if (look.sash) {
    for (let r = 0; r < 12; r += 0.5) p.block(T.front, 1 + r, r, 3 + r, r + 0.5, look.sash)
  }
  if (look.buttons) {
    for (const r of [2, 5, 8]) {
      p.oval(T.front, 5.5, r + 0.5, 0.35, 0.35, look.buttons)
      p.oval(T.front, 8.5, r + 0.5, 0.35, 0.35, look.buttons)
    }
  }
  if (look.sleeves === 'none' && !look.shell && !look.corset) {
    // Tank top: shoulders show skin.
    p.block(T.front, 0, 0, 2, 3, look.skin)
    p.block(T.front, 12, 0, 14, 3, look.skin)
  }
  if (look.necklace) {
    p.line(T.front, [[3.2, 0], [7, 2.6], [10.8, 0]], 0.25, look.necklace)
    p.oval(T.front, 7, 2.9, 0.5, 0.6, look.necklace)
    p.oval(T.front, 6.85, 2.75, 0.18, 0.18, '#ffffff')
  }
  if (look.belt) {
    for (const face of SIDE_FACES.torso) p.rows(T[face], 10.2, 11.6, look.belt)
    p.block(T.front, 6, 10, 8, 11.8, '#ffd166')
    p.block(T.front, 6.5, 10.5, 7.5, 11.3, look.belt)
  }
  if (look.skirt) {
    // The waistband of the dress or skirt.
    for (const face of SIDE_FACES.torso) p.rows(T[face], 10.6, 12, look.skirt)
    if (look.skirtTrim) for (const face of SIDE_FACES.torso) p.rows(T[face], 10.6, 11, look.skirtTrim)
  }
  if (look.emblem) paintEmblem(p, T.front, look.emblem)
}

/** A chest symbol, centred on the torso front (14 x 12). */
function paintEmblem(p, F, { shape, color }) {
  const dark = tone(color, 0.6)
  switch (shape) {
    case 'spider':
      p.oval(F, 7, 4.2, 0.9, 1.4, color)
      p.oval(F, 7, 2.6, 0.6, 0.6, color)
      for (const s of [-1, 1]) {
        p.line(F, [[7, 3.6], [7 + s * 2, 2.4], [7 + s * 3.1, 3.3]], 0.3, color)
        p.line(F, [[7, 4.0], [7 + s * 2.4, 3.6], [7 + s * 3.4, 4.9]], 0.3, color)
        p.line(F, [[7, 4.6], [7 + s * 2.2, 5.0], [7 + s * 3.0, 6.6]], 0.3, color)
        p.line(F, [[7, 5.0], [7 + s * 1.6, 6.2], [7 + s * 2.0, 7.6]], 0.3, color)
      }
      break
    case 'diamond':
      p.poly(F, [[7, 1.8], [9.3, 4.4], [7, 7.0], [4.7, 4.4]], dark)
      p.poly(F, [[7, 2.5], [8.6, 4.4], [7, 6.3], [5.4, 4.4]], color)
      p.poly(F, [[7, 2.5], [8.0, 3.6], [7, 4.4], [6.0, 3.6]], tone(color, 1.5))
      break
    case 'circle':
    default:
      p.oval(F, 7, 4.5, 2.4, 2.4, dark)
      p.oval(F, 7, 4.5, 1.8, 1.8, color)
      p.oval(F, 6.4, 3.9, 0.6, 0.5, tone(color, 1.6))
  }
}

function paintArm(p, A, look) {
  const shirt = look.shell || look.corset ? look.skin : look.shirt || look.skin
  const sleeveRows = look.sleeves === 'long' ? 10 : look.sleeves === 'short' ? 4 : 0
  for (const face of SIDE_FACES.arm) {
    p.fill(A[face], look.skin)
    if (sleeveRows) p.rows(A[face], 0, sleeveRows, shirt)
    if (look.stripes && sleeveRows) for (let r = 1; r < sleeveRows; r += 3) p.rows(A[face], r, r + 0.6, look.stripes)
    if (look.cuffs && sleeveRows) p.rows(A[face], sleeveRows - 1, sleeveRows, look.cuffs)
    if (look.gloves) {
      p.rows(A[face], 8.6, 12, look.gloves)
      p.rows(A[face], 8.6, 9.1, tone(look.gloves, 1.3))
    }
    if ((look.stars || look.sparkle) && sleeveRows) {
      p.block(A[face], 2, 3, 2.3, 3.3, look.stars || look.sparkle)
      p.block(A[face], 4, 7, 4.3, 7.3, look.stars || look.sparkle)
    }
    if (look.lava && !sleeveRows) {
      p.line(A[face], [[1, 1], [2.5, 4], [1.5, 7], [3, 10]], 0.25, look.lava)
      p.line(A[face], [[4.5, 2], [3.6, 5.5], [5, 8.5]], 0.2, tone(look.lava, 1.3))
    }
  }
  p.fill(A.top, sleeveRows ? shirt : look.skin)
  p.fill(A.bottom, look.gloves || look.skin)
  // Infinity-style gems set into the gauntlet's knuckles.
  if (look.gems && A === R.armR) {
    const gems = ['#ff2a2a', '#3f8cff', '#41e05a', '#ffe066', '#b84dff', '#ff8a1f']
    gems.forEach((g, i) => p.oval(A.front, 0.6 + i * 0.95, 9.6 + (i % 2) * 0.9, 0.38, 0.38, g))
  }
}

function paintLeg(p, L, look) {
  const pants = look.pants || look.skin
  const boots = look.boots || look.shoes || tone(pants, 0.6)
  const pantsRows = look.pantsStyle === 'shorts' ? 6 : 10
  const bootTop = look.boots ? 6.5 : 10
  for (const face of SIDE_FACES.leg) {
    p.fill(L[face], look.skin)
    p.rows(L[face], 0, pantsRows, pants)
    if (look.scales) {
      // Mermaid scales: rows of little arcs.
      for (let r = 0.5; r < bootTop; r += 1) {
        for (let c = (r % 2) * 0.5; c < L[face][2]; c += 1) p.oval(L[face], c + 0.5, r, 0.45, 0.35, look.scales)
        for (let c = (r % 2) * 0.5; c < L[face][2]; c += 1) p.oval(L[face], c + 0.5, r - 0.12, 0.35, 0.22, pants)
      }
    }
    if (look.skirt) {
      p.rows(L[face], 0, 3.6, look.skirt)
      if (look.skirtTrim) p.rows(L[face], 3.2, 3.6, look.skirtTrim)
    }
    p.rows(L[face], bootTop, 12, boots)
    if (look.boots) p.rows(L[face], bootTop, bootTop + 0.5, tone(boots, 1.35))
    p.rows(L[face], 11.4, 12, tone(boots, 0.6))
  }
  p.fill(L.top, look.skirt || pants)
  p.fill(L.bottom, tone(boots, 0.6))
}

/** Paints a villain's full skin (SKIN_PX square). */
export function paintSkin(ctx, look, seedKey = 'skin') {
  const rng = mulberry32(hashString(seedKey))
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, SKIN_PX, SKIN_PX)
  ctx.setTransform(SKIN_SCALE, 0, 0, SKIN_SCALE, 0, 0)
  ctx.imageSmoothingEnabled = false
  const p = makePainter(ctx)

  for (const face of Object.values(R.head)) p.fill(face, look.skin)
  paintTorso(p, look, rng)
  paintArm(p, R.armL, look)
  paintArm(p, R.armR, look)
  paintLeg(p, R.legL, look)
  paintLeg(p, R.legR, look)

  // Volume on the body, then fabric grain (the grain works in real texels).
  for (const face of SIDE_FACES.torso) shadeFace(p, R.torso[face], 0.8)
  // Arms and legs share the same side-face names.
  for (const part of ['armL', 'armR', 'legL', 'legR']) {
    for (const face of SIDE_FACES.arm) shadeFace(p, R[part][face])
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  for (const part of ['torso', 'armL', 'armR', 'legL', 'legR']) {
    for (const rect of Object.values(R[part])) addGrain(ctx, rect, rng)
  }
  ctx.setTransform(SKIN_SCALE, 0, 0, SKIN_SCALE, 0, 0)

  paintHair(p, look)
  for (const face of ['left', 'right', 'back']) shadeFace(p, R.head[face], 0.5)
  paintFace(p, look)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/* --- Caches -------------------------------------------------------------------- */

const canvases = new Map()
const textures = new Map()

function createCanvas(width, height = width) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** The painted skin of a villain (not for 'bloxity', which uses the SDK skin). */
export function getVillainCanvas(id) {
  if (!canvases.has(id)) {
    const morph = VILLAIN_BY_ID[id]
    const canvas = createCanvas(SKIN_PX)
    // Painting reads pixels back for the fabric grain.
    if (morph?.look) paintSkin(canvas.getContext('2d', { willReadFrequently: true }), { ...morph.look, gender: morph.gender }, id)
    canvases.set(id, canvas)
  }
  return canvases.get(id)
}

/** Configures a texture the way the Bloxity rig expects: unflipped, pixel-art filtered. */
function configurePixelTexture(texture) {
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** Shared skin texture for wearing a villain. Lives for the session (256 KB). */
export function getVillainTexture(id) {
  if (!textures.has(id)) textures.set(id, configurePixelTexture(new CanvasTexture(getVillainCanvas(id))))
  return textures.get(id)
}

const portraits = new Map()

/**
 * A villain's face for the HUD: the front of its painted head, with its hair framing
 * it. A cached PNG data URL; null for your own avatar.
 */
export function villainPortrait(id) {
  if (portraits.has(id)) return portraits.get(id)
  const villain = VILLAIN_BY_ID[id]
  if (!villain?.look) {
    portraits.set(id, null)
    return null
  }
  const src = getVillainCanvas(id)
  const S = SKIN_SCALE
  const canvas = createCanvas(80)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const [x, y, w, h] = R.head.front
  // Hair on top (the head's top face), then the face itself.
  ctx.drawImage(src, R.head.top[0] * S, (R.head.top[1] + 6) * S, 8 * S, 2 * S, 8, 0, 64, 12)
  ctx.drawImage(src, x * S, y * S, w * S, h * S, 8, 12, 64, 64)
  const url = canvas.toDataURL('image/png')
  portraits.set(id, url)
  return url
}

/* --- Statue atlas --------------------------------------------------------------- */

/**
 * Every villain's skin in one texture, so every pedestal statue (and its gear)
 * renders as a single draw call. `cell` is each skin's size in it: 64 px gives a
 * 512 px atlas (LOW), 128 px a 1024 px one. The last cell holds a white block that
 * accessory vertices sample, letting their vertex colours show through untouched.
 */
export function buildStatueAtlas(cell = 128) {
  const perRow = 8
  // Only as many rows as the roster (plus the white cell) needs, rounded to a power of two.
  const rows = 2 ** Math.ceil(Math.log2(Math.ceil((VILLAINS.length + 1) / perRow)))
  const width = cell * perRow
  const height = cell * rows
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const cellOf = new Map()
  VILLAINS.forEach((morph, i) => {
    const cx = (i % perRow) * cell
    const cy = Math.floor(i / perRow) * cell
    cellOf.set(morph.id, [cx, cy])
    if (morph.look) ctx.drawImage(getVillainCanvas(morph.id), cx, cy, cell, cell)
  })

  const whiteCell = perRow * rows - 1
  const wx = (whiteCell % perRow) * cell
  const wy = Math.floor(whiteCell / perRow) * cell
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(wx, wy, cell, cell)

  const texture = configurePixelTexture(new CanvasTexture(canvas))

  // The Bloxity statue shows the default Bloxity skin, fetched like the player's own.
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const at = cellOf.get('bloxity')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, at[0], at[1], cell, cell)
    texture.needsUpdate = true
  }
  img.src = assetUrls.skinTexture('0')

  return {
    texture,
    /** UV transform for a body part UV in 0..1 of a skin. */
    remap(id, u, v) {
      const [cx, cy] = cellOf.get(id) || [0, 0]
      return [(cx + u * cell) / width, (cy + v * cell) / height]
    },
    whiteUv: [(wx + cell / 2) / width, (wy + cell / 2) / height],
  }
}
