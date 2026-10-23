import { IcosahedronGeometry } from 'three'

import { PET_BY_ID } from '../../state/content'
import { box, colorize, cone, cyl, merge, place } from '../world/kit'

/**
 * Voxel pets in the blocky toy style: a chunky body with big glossy eyes on the
 * front, plus a few blocks of species detail (ears, horns, wings, fins, tails).
 *
 * Every model faces +Z, stands on y = 0 and is about one unit across. Each species is
 * merged into one vertex-coloured geometry, built on first use and shared by every
 * copy of that pet in the game (one instanced mesh per species).
 */

const WHITE = '#ffffff'
const PUPIL = '#16161c'

function eyes(parts, { y = 0.6, spread = 0.21, size = 0.27, z = 0.5, color = PUPIL } = {}) {
  for (const x of [-spread, spread]) {
    parts.push(box(size, size * 1.15, 0.05, WHITE, { pos: [x, y, z + 0.01] }))
    parts.push(box(size * 0.62, size * 0.78, 0.05, color, { pos: [x, y - size * 0.08, z + 0.03] }))
    parts.push(box(size * 0.22, size * 0.22, 0.04, WHITE, { pos: [x - size * 0.15, y + size * 0.18, z + 0.05] }))
  }
}

function feet(parts, color, y = 0.07, s = 0.95) {
  for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) parts.push(box(0.22, 0.14, 0.22, color, { pos: [x * s, y, z * s] }))
}

function wings(parts, color, { y = 0.7, span = 0.6, x0 = 0.45 } = {}) {
  for (const side of [-1, 1]) {
    parts.push(box(span, 0.36, 0.08, color, { pos: [side * (x0 + span / 2), y, -0.08], rot: [0, 0, side * 0.35] }))
    parts.push(box(span * 0.55, 0.24, 0.08, color, { pos: [side * (x0 + span * 0.9), y + 0.22, -0.08], rot: [0, 0, side * 0.7] }))
  }
}

function horns(parts, color, y = 1.05, x = 0.26) {
  for (const side of [-1, 1]) parts.push(cone(0.09, 0.34, 5, color, { pos: [side * x, y, 0.05], rot: [0, 0, -side * 0.3] }))
}

function crown(parts, color, y = 1.0) {
  parts.push(box(0.5, 0.1, 0.5, color, { pos: [0, y, 0] }))
  for (const x of [-0.18, 0, 0.18]) parts.push(cone(0.07, 0.22, 4, color, { pos: [x, y + 0.15, 0] }))
}

const KINDS = {
  blob: (m) => {
    const parts = [
      box(1.0, 0.72, 1.0, m.body, { pos: [0, 0.36, 0] }),
      box(0.82, 0.22, 0.82, m.body, { pos: [0, 0.83, 0] }),
      box(0.6, 0.3, 0.04, m.belly, { pos: [0, 0.3, 0.51] }),
    ]
    eyes(parts, { y: 0.55 })
    if (m.crown) crown(parts, m.crown, 0.95)
    if (m.horns) horns(parts, m.horns, 1.0)
    return parts
  },
  quad: (m) => {
    const parts = [box(0.95, 0.85, 0.95, m.body, { pos: [0, 0.55, 0] }), box(0.55, 0.36, 0.04, m.belly, { pos: [0, 0.38, 0.48] })]
    feet(parts, m.body)
    eyes(parts, { y: 0.68, color: m.eye || PUPIL })
    parts.push(box(0.12, 0.08, 0.04, '#ff7a9a', { pos: [0, 0.48, 0.5] }))
    if (m.ears === 'pointy') for (const x of [-0.3, 0.3]) parts.push(cone(0.13, 0.32, 4, m.body, { pos: [x, 1.12, 0] }))
    if (m.ears === 'flop') for (const side of [-1, 1]) parts.push(box(0.14, 0.4, 0.3, m.belly, { pos: [side * 0.54, 0.82, 0] }))
    if (m.ears === 'long') for (const x of [-0.2, 0.2]) parts.push(box(0.16, 0.6, 0.14, m.body, { pos: [x, 1.25, 0] }))
    if (m.tail) parts.push(box(0.14, 0.14, 0.42, m.tail, { pos: [0, 0.65, -0.68], rot: [0.5, 0, 0] }))
    if (m.antenna) {
      parts.push(cyl(0.03, 0.03, 0.4, 5, '#3a3d44', { pos: [0, 1.17, 0] }))
      parts.push(box(0.14, 0.14, 0.14, m.antenna, { pos: [0, 1.4, 0] }))
    }
    return parts
  },
  winged: (m) => {
    // Fliers hover: the body sits up off the ground.
    const parts = [box(0.8, 0.78, 0.8, m.body, { pos: [0, 0.8, 0] }), box(0.48, 0.32, 0.04, m.belly, { pos: [0, 0.68, 0.41] })]
    eyes(parts, { y: 0.9, z: 0.4, size: 0.24, color: m.eye || PUPIL })
    wings(parts, m.wing, { y: 0.92, x0: 0.38 })
    if (m.ears) for (const x of [-0.24, 0.24]) parts.push(cone(0.11, 0.26, 4, m.body, { pos: [x, 1.3, 0] }))
    if (m.horns) horns(parts, m.horns, 1.3, 0.22)
    if (m.crest) for (const z of [-0.15, 0.1]) parts.push(cone(0.1, 0.38, 4, m.crest, { pos: [0, 1.36, z], rot: [z * 2, 0, 0] }))
    if (m.halo) parts.push(cyl(0.34, 0.34, 0.05, 14, m.halo, { pos: [0, 1.48, 0] }))
    if (m.tail) parts.push(cone(0.08, 0.4, 4, m.tail, { pos: [0, 0.6, -0.55], rot: [-1.9, 0, 0] }))
    parts.push(box(0.08, 0.1, 0.1, '#ffb347', { pos: [0, 0.78, 0.43] }))
    return parts
  },
  dragon: (m) => {
    const parts = [box(0.95, 0.85, 1.05, m.body, { pos: [0, 0.55, 0] }), box(0.55, 0.38, 0.04, m.belly, { pos: [0, 0.4, 0.53] })]
    feet(parts, m.body)
    eyes(parts, { y: 0.7, z: 0.53 })
    wings(parts, m.wing, { y: 0.9, x0: 0.48, span: 0.7 })
    horns(parts, m.horns || '#ffffff', 1.1)
    parts.push(box(0.16, 0.16, 0.5, m.body, { pos: [0, 0.5, -0.72], rot: [0.4, 0, 0] }))
    parts.push(cone(0.12, 0.25, 4, m.wing, { pos: [0, 0.4, -1.0], rot: [-1.7, 0, 0] }))
    for (const z of [-0.3, 0, 0.3]) parts.push(cone(0.07, 0.2, 4, m.wing, { pos: [0, 1.05, z] }))
    if (m.crown) crown(parts, m.crown, 1.0)
    return parts
  },
  eye: (m) => {
    const ball = place(colorize(new IcosahedronGeometry(0.5, 1), m.body), { pos: [0, 0.85, 0] })
    const parts = [
      ball,
      cyl(0.34, 0.34, 0.06, 16, WHITE, { pos: [0, 0.88, 0.47], rot: [Math.PI / 2, 0, 0] }),
      cyl(0.2, 0.2, 0.07, 14, m.iris, { pos: [0, 0.88, 0.5], rot: [Math.PI / 2, 0, 0] }),
      cyl(0.09, 0.09, 0.08, 10, PUPIL, { pos: [0, 0.88, 0.53], rot: [Math.PI / 2, 0, 0] }),
    ]
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * Math.PI * 2
      parts.push(cone(0.08, 0.28, 4, m.iris, { pos: [Math.cos(a) * 0.52, 0.85 + Math.sin(a) * 0.52, -0.12], rot: [0, 0, a - Math.PI / 2] }))
    }
    return parts
  },
  cube: (m) => {
    const parts = [
      box(0.9, 0.9, 0.9, m.body, { pos: [0, 0.95, 0], rot: [0.2, 0.3, 0.1] }),
      cyl(0.26, 0.26, 0.06, 14, WHITE, { pos: [0.05, 0.98, 0.5], rot: [Math.PI / 2 - 0.2, 0.3, 0] }),
      cyl(0.14, 0.14, 0.07, 12, m.iris, { pos: [0.06, 0.98, 0.53], rot: [Math.PI / 2 - 0.2, 0.3, 0] }),
    ]
    for (const [x, y, z] of [[-1, 1, 1], [1, 1, -1], [-1, -1, -1], [1, -1, 1]]) {
      parts.push(box(0.16, 0.16, 0.16, m.iris, { pos: [x * 0.5, 0.95 + y * 0.5, z * 0.5] }))
    }
    return parts
  },
  whale: (m) => {
    const parts = [
      box(0.9, 0.72, 1.3, m.body, { pos: [0, 0.85, 0] }),
      box(0.7, 0.3, 1.0, m.belly, { pos: [0, 0.55, 0.12] }),
      box(0.7, 0.12, 0.35, m.fin, { pos: [0, 0.98, -0.9] }),
      box(0.16, 0.3, 0.12, m.fin, { pos: [0, 0.95, -0.72] }),
    ]
    for (const side of [-1, 1]) parts.push(box(0.4, 0.08, 0.3, m.fin, { pos: [side * 0.6, 0.72, 0.15], rot: [0, 0, side * -0.4] }))
    eyes(parts, { y: 0.92, z: 0.65, size: 0.22, spread: 0.24 })
    if (m.tentacles) for (const x of [-0.28, 0, 0.28]) parts.push(cone(0.08, 0.5, 5, m.fin, { pos: [x, 0.3, 0.3], rot: [Math.PI, 0, x] }))
    return parts
  },
}

const cache = new Map()

/** The merged geometry of a pet species (cached, shared). */
export function petGeometry(id) {
  if (!cache.has(id)) {
    const model = PET_BY_ID[id]?.model
    const build = KINDS[model?.kind] || KINDS.blob
    cache.set(id, merge(build(model || { body: '#cccccc', belly: '#ffffff' })))
  }
  return cache.get(id)
}

/* --- 2D icons ------------------------------------------------------------------ */

const icons = new Map()

/**
 * A pet's portrait for the HUD, drawn flat from the same model description (front
 * view of the voxel body, eyes and details). A cached PNG data URL.
 */
export function petIcon(id) {
  if (icons.has(id)) return icons.get(id)
  const m = PET_BY_ID[id]?.model || { kind: 'blob', body: '#cccccc', belly: '#ffffff' }
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  const rect = (x, y, w, h, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, w, h)
  }
  const outline = (x, y, w, h) => {
    ctx.lineWidth = 4
    ctx.strokeStyle = '#1b1130'
    ctx.strokeRect(x, y, w, h)
  }
  const kind = m.kind
  // Wings and ears behind the body.
  if (m.wing && (kind === 'winged' || kind === 'dragon')) {
    rect(4, 34, 24, 18, m.wing)
    rect(68, 34, 24, 18, m.wing)
    outline(4, 34, 24, 18)
    outline(68, 34, 24, 18)
  }
  if (m.ears === 'pointy' || (kind === 'winged' && m.ears)) {
    rect(24, 12, 12, 14, m.body)
    rect(60, 12, 12, 14, m.body)
  }
  if (m.ears === 'long') {
    rect(28, 2, 12, 26, m.body)
    rect(56, 2, 12, 26, m.body)
  }
  if (m.horns) {
    rect(24, 10, 9, 16, m.horns)
    rect(63, 10, 9, 16, m.horns)
  }
  if (kind === 'eye') {
    ctx.beginPath()
    ctx.arc(48, 52, 36, 0, Math.PI * 2)
    ctx.fillStyle = m.body
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = '#1b1130'
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(48, 52, 22, 0, Math.PI * 2)
    ctx.fillStyle = WHITE
    ctx.fill()
    ctx.beginPath()
    ctx.arc(48, 52, 13, 0, Math.PI * 2)
    ctx.fillStyle = m.iris
    ctx.fill()
    ctx.beginPath()
    ctx.arc(48, 52, 6, 0, Math.PI * 2)
    ctx.fillStyle = PUPIL
    ctx.fill()
  } else {
    const top = kind === 'winged' ? 22 : 24
    rect(16, top, 64, 62, m.body)
    outline(16, top, 64, 62)
    rect(30, top + 40, 36, 18, m.belly || m.body)
    if (kind === 'cube') {
      ctx.beginPath()
      ctx.arc(48, top + 28, 14, 0, Math.PI * 2)
      ctx.fillStyle = WHITE
      ctx.fill()
      ctx.beginPath()
      ctx.arc(48, top + 28, 7, 0, Math.PI * 2)
      ctx.fillStyle = m.iris
      ctx.fill()
    } else {
      for (const x of [30, 56]) {
        rect(x, top + 16, 12, 16, WHITE)
        rect(x + 2, top + 20, 8, 11, m.eye || PUPIL)
        rect(x + 2, top + 18, 4, 4, WHITE)
      }
    }
    if (m.ears === 'flop') {
      rect(6, top + 10, 12, 22, m.belly)
      rect(78, top + 10, 12, 22, m.belly)
    }
    if (m.crown) {
      rect(30, top - 10, 36, 8, m.crown)
      for (const x of [30, 44, 58]) rect(x, top - 18, 8, 8, m.crown)
    }
    if (m.halo) rect(28, top - 14, 40, 6, m.halo)
    if (m.crest) rect(42, top - 14, 12, 14, m.crest)
    if (m.antenna) rect(44, top - 16, 8, 14, m.antenna)
  }
  const url = canvas.toDataURL('image/png')
  icons.set(id, url)
  return url
}
