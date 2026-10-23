import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { VILLAIN_BY_ID } from '../state/content'

/**
 * Low-poly villain gear, built from primitives with baked vertex colours.
 *
 * Coordinates are in Bloxity rig units (the body is 6.4 tall) and in the local frame
 * of the bone each piece hangs off. All three bones are character-aligned at rest
 * (the character faces +Z):
 *   head  -> Neck1:  origin at the base of the head; head spans y 0..1.6, x/z +-0.8
 *   back  -> Spine2: torso spans y -1.8..0.6, x +-1.4, z +-0.8 (back face at z -0.8)
 *   hips  -> Spine1: origin at the waist; torso above (y 0..2.4), legs below
 *
 * Every piece of one bone merges into a single geometry, so a villain's gear costs at
 * most three draw calls on the player and nothing extra on the merged statues.
 */

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _s = new Vector3()
const _p = new Vector3()

function colorize(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const c = new Color(hex)
  const count = g.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
  return g
}

function place(geometry, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  _e.set(rot[0], rot[1], rot[2])
  _q.setFromEuler(_e)
  _m.compose(_p.set(...pos), _q, _s.set(...scale))
  geometry.applyMatrix4(_m)
  return geometry
}

/** Boxes at least this thick get softened edges; thinner trims and bands stay crisp. */
const SOFT_MIN = 0.2
/** Edge chamfer, as a share of the box's thinnest side. */
const SOFT_SHARE = 0.3

/**
 * A box with chamfered edges and corners (44 triangles): six inset faces, a bevel
 * strip along each edge and a facet at each corner. Normals bend smoothly across the
 * bevels, so it shades like a rounded box at a fraction of the cost.
 */
function chamferBox(w, h, d, r) {
  const inner = [w / 2 - r, h / 2 - r, d / 2 - r]
  // The vertex of corner (sx, sy, sz) that sits on the face across `axis`.
  const vertex = (sx, sy, sz, axis) => {
    const sign = [sx, sy, sz]
    const p = [sx * inner[0], sy * inner[1], sz * inner[2]]
    p[axis] += sign[axis] * r
    const n = [0, 0, 0]
    n[axis] = sign[axis]
    return { p, n }
  }
  const positions = []
  const normals = []
  const tri = (a, b, c) => {
    // Face outward whatever order the corners came in.
    const ab = [0, 1, 2].map((k) => b.p[k] - a.p[k])
    const ac = [0, 1, 2].map((k) => c.p[k] - a.p[k])
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    const out = [0, 1, 2].map((k) => a.n[k] + b.n[k] + c.n[k])
    const list = cross[0] * out[0] + cross[1] * out[1] + cross[2] * out[2] < 0 ? [a, c, b] : [a, b, c]
    for (const v of list) {
      positions.push(...v.p)
      normals.push(...v.n)
    }
  }
  const quad = (a, b, c, e) => {
    tri(a, b, c)
    tri(a, c, e)
  }
  const signs = [-1, 1]
  for (let axis = 0; axis < 3; axis += 1) {
    const [b, c] = [0, 1, 2].filter((k) => k !== axis)
    for (const s of signs) {
      // Face: its four corners, in order round the face.
      const at = (sb, sc) => {
        const sign = [0, 0, 0]
        sign[axis] = s
        sign[b] = sb
        sign[c] = sc
        return vertex(sign[0], sign[1], sign[2], axis)
      }
      quad(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1))
    }
    // Edges running along `axis`: a strip between the two faces that meet there.
    for (const sb of signs) {
      for (const sc of signs) {
        const end = (sa, faceAxis) => {
          const sign = [0, 0, 0]
          sign[axis] = sa
          sign[b] = sb
          sign[c] = sc
          return vertex(sign[0], sign[1], sign[2], faceAxis)
        }
        quad(end(-1, b), end(1, b), end(1, c), end(-1, c))
      }
    }
  }
  for (const sx of signs) for (const sy of signs) for (const sz of signs) tri(vertex(sx, sy, sz, 0), vertex(sx, sy, sz, 1), vertex(sx, sy, sz, 2))

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  return g
}

/** A gear block: chamfered when it's chunky enough to look like a box. */
function block(w, h, d) {
  const thin = Math.min(w, h, d)
  return thin >= SOFT_MIN ? chamferBox(w, h, d, thin * SOFT_SHARE) : new BoxGeometry(w, h, d)
}

const box = (w, h, d, color, t) => place(colorize(block(w, h, d), color), t)
const cyl = (rt, rb, h, seg, color, t) => place(colorize(new CylinderGeometry(rt, rb, h, seg), color), t)
const cone = (r, h, seg, color, t) => place(colorize(new ConeGeometry(r, h, seg), color), t)
const blob = (r, color, t) => place(colorize(new IcosahedronGeometry(r, 1), color), t)
const ring = (r, tube, color, t) => place(colorize(new TorusGeometry(r, tube, 6, 28), color), t)

/** A flat polygon in the XY plane, extruded along Z - wings, blades, fins. */
function plate(points, thickness, color, t) {
  const positions = []
  const half = thickness / 2
  const n = points.length
  for (let i = 1; i < n - 1; i += 1) {
    for (const side of [half, -half]) {
      const tri = side > 0 ? [0, i, i + 1] : [0, i + 1, i]
      for (const k of tri) positions.push(points[k][0], points[k][1], side)
    }
  }
  for (let i = 0; i < n; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % n]
    positions.push(a[0], a[1], half, a[0], a[1], -half, b[0], b[1], half)
    positions.push(b[0], b[1], half, a[0], a[1], -half, b[0], b[1], -half)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.computeVertexNormals()
  return place(colorize(g, color), t)
}

/** '#rrggbb' darkened by `k`. */
function shade(hex, k = 0.75) {
  const c = new Color(hex)
  c.multiplyScalar(k)
  return `#${c.getHexString()}`
}

/** A long cape from the shoulders, flaring towards the hem; back slot. */
function cape(outer, lining, trim, length = 3.8) {
  const flare = (w0, w1, h, d, color, z) => {
    const g = new BoxGeometry(1, h, d)
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i += 1) {
      const k = (pos.getY(i) + h / 2) / h // 0 at the hem, 1 at the shoulders
      pos.setX(i, pos.getX(i) * (w1 + (w0 - w1) * k))
      // The hem swings out behind the legs.
      pos.setZ(i, pos.getZ(i) - (1 - k) * 0.55)
    }
    g.computeVertexNormals()
    return place(colorize(g, color), { pos: [0, 0.62 - h / 2, z] })
  }
  return [
    flare(2.9, 3.6, length, 0.12, lining, -0.9),
    flare(3.0, 3.75, length + 0.05, 0.1, outer, -1.0),
    box(3.8, 0.18, 0.16, trim, { pos: [0, 0.62 - length + 0.1, -1.57] }),
    // Over the shoulders.
    box(1.2, 0.3, 1.7, outer, { pos: [1.95, 0.68, 0] }),
    box(1.2, 0.3, 1.7, outer, { pos: [-1.95, 0.68, 0] }),
  ]
}

/** Hood covering the top, back and sides of the head; head slot. */
function hood(color) {
  const dark = shade(color, 0.8)
  return [
    box(1.86, 0.32, 1.86, color, { pos: [0, 1.74, -0.04] }),
    box(1.86, 1.55, 0.24, color, { pos: [0, 0.92, -0.96] }),
    box(0.22, 1.3, 1.5, color, { pos: [0.98, 1.02, -0.16] }),
    box(0.22, 1.3, 1.5, color, { pos: [-0.98, 1.02, -0.16] }),
    cone(0.42, 1.1, 6, dark, { pos: [0, 1.72, -1.25], rot: [-1.15, 0, 0] }),
  ]
}

/** A pair of bat / feather wings off the upper back; back slot. */
function wings(color, edge, { span = 1, lift = 0.15 } = {}) {
  const main = [
    [0, 0],
    [1.1, 0.75],
    [2.4, 1.55],
    [3.2, 1.0],
    [2.9, 0.25],
    [2.4, -0.45],
    [1.6, -0.75],
    [0.5, -0.55],
  ].map(([x, y]) => [x * span, y * span])
  const inner = main.map(([x, y]) => [x * 0.78, y * 0.78 + 0.05])
  const out = []
  for (const side of [-1, 1]) {
    const mirror = (pts) => pts.map(([x, y]) => [side * x, y])
    out.push(plate(mirror(main), 0.1, edge, { pos: [side * 0.45, lift, -1.05], rot: [0, side * 0.45, 0] }))
    out.push(plate(mirror(inner), 0.12, color, { pos: [side * 0.45, lift, -1.02], rot: [0, side * 0.45, 0] }))
  }
  return out
}

/** Two horns curving up and out of the head; head slot. */
function horns(color, tip, size = 1) {
  const out = []
  for (const side of [-1, 1]) {
    out.push(cone(0.3 * size, 1.25 * size, 7, color, { pos: [side * 0.78, 1.85, 0.1], rot: [0.2, 0, -side * 0.6] }))
    out.push(cone(0.14 * size, 0.5 * size, 6, tip, { pos: [side * (0.78 + 0.62 * size), 1.85 + 0.62 * size, 0.18], rot: [0.2, 0, -side * 0.95] }))
  }
  return out
}

/**
 * Long hair falling from the head down the back, with locks framing the face and the
 * tips dyed when `tips` is set; head slot.
 */
function longHair(hair, tips) {
  const end = tips || shade(hair, 0.85)
  return [
    box(1.84, 0.26, 1.84, hair, { pos: [0, 1.7, -0.02] }),
    box(1.9, 2.2, 0.42, hair, { pos: [0, 0.65, -0.98] }),
    box(1.78, 0.62, 0.4, end, { pos: [0, -0.73, -1.0] }),
    box(1.94, 0.12, 0.05, shade(hair, 1.45), { pos: [0, 1.25, -1.2] }),
    ...[-1, 1].flatMap((side) => [
      box(0.24, 1.75, 0.7, hair, { pos: [side * 0.94, 0.85, 0.32] }),
      box(0.22, 0.45, 0.6, end, { pos: [side * 0.95, -0.2, 0.3] }),
      box(0.24, 1.9, 0.9, hair, { pos: [side * 0.94, 0.75, -0.48] }),
    ]),
  ]
}

/**
 * A flared skirt from the waist, gathered narrower at the back and front than the
 * sides like the body; `length` 1.3 is short, 2.6 a gown; hips slot.
 */
function skirtParts(color, trim, length, flare) {
  const g = colorize(new CylinderGeometry(1.5, 1.5 + flare, length, 12, 1, true), color)
  place(g, { pos: [0, 0.1 - length / 2, 0], scale: [1, 1, 0.68] })
  const hem = colorize(new CylinderGeometry(1.52 + flare, 1.58 + flare, 0.22, 12, 1, true), trim || shade(color, 0.7))
  place(hem, { pos: [0, 0.1 - length + 0.1, 0], scale: [1, 1, 0.7] })
  const band = colorize(new CylinderGeometry(1.48, 1.5, 0.3, 12), trim || shade(color, 0.7))
  place(band, { pos: [0, 0.05, 0], scale: [1, 1, 0.66] })
  return [g, hem, band]
}

/** Each builder returns { head?: [], back?: [], hips?: [] } of positioned geometries. */
const GEAR = {
  jesterTufts: (look) => ({
    head: [
      box(1.7, 0.22, 1.7, look.hair, { pos: [0, 1.68, 0] }),
      cone(0.34, 0.95, 6, look.hair, { pos: [0.95, 1.3, -0.1], rot: [0, 0, -1.1] }),
      cone(0.34, 0.95, 6, look.hair, { pos: [-0.95, 1.3, -0.1], rot: [0, 0, 1.1] }),
      cone(0.3, 0.75, 6, shade(look.hair), { pos: [0.5, 1.95, -0.35], rot: [-0.4, 0, -0.5] }),
      cone(0.3, 0.75, 6, shade(look.hair), { pos: [-0.5, 1.95, -0.35], rot: [-0.4, 0, 0.5] }),
    ],
  }),

  bowTie: () => ({
    back: [
      box(0.6, 0.42, 0.14, '#2ecc40', { pos: [0.34, 0.38, 0.86], rot: [0, 0, 0.32] }),
      box(0.6, 0.42, 0.14, '#2ecc40', { pos: [-0.34, 0.38, 0.86], rot: [0, 0, -0.32] }),
      box(0.24, 0.24, 0.2, '#ffd23f', { pos: [0, 0.38, 0.9] }),
    ],
  }),

  pigtails: (look) => ({
    // Bunches high on the head, dyed pink on one side and blue on the other.
    head: [-1, 1].flatMap((side) => {
      const dye = side > 0 ? '#ff4fa3' : '#3f8cff'
      return [
        blob(0.26, dye, { pos: [side * 0.92, 1.45, -0.25] }),
        box(0.5, 1.15, 0.5, look.hair, { pos: [side * 1.22, 0.82, -0.32], rot: [0, 0, side * 0.42] }),
        box(0.55, 0.75, 0.55, dye, { pos: [side * 1.55, 0.02, -0.32], rot: [0, 0, side * 0.42] }),
        cone(0.3, 0.45, 5, dye, { pos: [side * 1.72, -0.5, -0.32], rot: [Math.PI, 0, -side * 0.42] }),
      ]
    }),
  }),

  bat: () => ({
    back: [
      cyl(0.11, 0.22, 3.2, 8, '#c8a26a', { pos: [0, -0.5, -1.02], rot: [0, 0, 0.75] }),
      cyl(0.12, 0.12, 0.7, 8, '#151515', { pos: [-0.95, 0.55, -1.02], rot: [0, 0, 0.75] }),
    ],
  }),

  goblinEars: (look) => ({
    head: [-1, 1].map((side) =>
      cone(0.26, 0.9, 5, look.skin, { pos: [side * 1.15, 0.95, 0], rot: [0, 0, -side * (Math.PI / 2 - 0.35)] }),
    ),
  }),

  goblinHood: () => ({ head: hood('#5b2a86') }),

  bombBelt: () => ({
    hips: [-1, 1].flatMap((side) => [
      blob(0.32, '#ff8a1f', { pos: [side * 1.55, 0.25, 0.35] }),
      cyl(0.06, 0.06, 0.22, 5, '#3e8a2a', { pos: [side * 1.55, 0.6, 0.35] }),
      blob(0.26, '#ff8a1f', { pos: [side * 1.5, 0.2, -0.45] }),
    ]),
  }),

  shoulderPlates: () => ({
    back: [-1, 1].flatMap((side) => [
      box(1.45, 0.55, 1.95, '#6a707c', { pos: [side * 2.0, 0.66, 0] }),
      box(1.5, 0.14, 2.0, '#c0392b', { pos: [side * 2.0, 0.98, 0] }),
      cone(0.22, 0.6, 5, '#3a3d44', { pos: [side * 2.25, 1.28, 0] }),
    ]),
  }),

  antenna: () => ({
    head: [
      cyl(0.05, 0.05, 0.9, 6, '#3a3d44', { pos: [0.52, 2.02, 0] }),
      blob(0.15, '#ff3b30', { pos: [0.52, 2.52, 0] }),
    ],
  }),

  tendrils: () => ({
    back: [
      [-0.75, 0.2, 0.75],
      [0.75, 0.2, -0.75],
      [-0.55, -0.7, 0.45],
      [0.55, -0.7, -0.45],
      [0, 0.35, 0],
      [0, -1.1, 0],
    ].map(([x, y, tilt]) =>
      cone(0.2, 1.9, 6, '#141420', { pos: [x * 1.5, y + 0.4, -1.65], rot: [-1.15, 0, tilt] }),
    ),
  }),

  iceCrown: () => ({
    head: [
      cyl(0.87, 0.87, 0.22, 14, '#e8fbff', { pos: [0, 1.62, 0] }),
      ...Array.from({ length: 7 }, (_, k) => {
        const a = (k / 7) * Math.PI * 2
        const tall = k % 2 === 0
        return cone(0.2, tall ? 1.0 : 0.6, 5, tall ? '#7fe3ff' : '#bff2ff', {
          pos: [Math.sin(a) * 0.72, tall ? 2.2 : 2.0, Math.cos(a) * 0.72],
        })
      }),
    ],
  }),

  iceCape: () => ({ back: cape('#7fd3ff', '#e8fbff', '#ffffff') }),

  hornsBig: () => ({ head: horns('#2a0a0a', '#ffd23f', 1.05) }),

  flameHair: () => ({
    head: [
      [0, 0, 1.4, '#ff5a1f'],
      [0.45, 0.25, 1.0, '#ff8c1a'],
      [-0.45, 0.25, 1.0, '#ff8c1a'],
      [0.3, -0.4, 1.15, '#ffd23f'],
      [-0.3, -0.4, 1.15, '#ffd23f'],
      [0, 0.5, 0.8, '#ffd23f'],
    ].map(([x, z, h, c]) => cone(0.32, h, 6, c, { pos: [x, 1.6 + h / 2, z], rot: [-z * 0.4, 0, -x * 0.4] })),
  }),

  witchHat: () => ({
    head: [
      cyl(1.7, 1.7, 0.1, 18, '#4a3a26', { pos: [0, 1.52, 0] }),
      cyl(0.98, 0.98, 0.22, 14, '#8a6a3a', { pos: [0, 1.64, 0] }),
      cone(0.96, 2.2, 10, '#5a4630', { pos: [0, 2.6, -0.2], rot: [-0.28, 0, 0.12] }),
    ],
  }),

  strawTufts: () => ({
    head: [-1, 1].flatMap((side) => [
      box(0.12, 0.55, 0.3, '#e8c35a', { pos: [side * 0.9, 0.85, 0.3], rot: [0, 0, side * 0.7] }),
      box(0.12, 0.5, 0.3, '#d9b04a', { pos: [side * 0.92, 0.7, -0.2], rot: [0, 0, side * 0.9] }),
    ]),
  }),

  scythe: () => ({
    back: [
      cyl(0.08, 0.08, 4.3, 6, '#5a3a1a', { pos: [0.3, -0.4, -1.08], rot: [0, 0, -0.35] }),
      plate(
        [
          [0, 0],
          [-1.9, 0.35],
          [-2.3, -0.05],
          [-1.7, 0.05],
        ],
        0.08,
        '#c9d1dc',
        { pos: [1.05, 1.62, -1.08] },
      ),
    ],
  }),

  hoodGreen: () => ({ head: hood('#2f7d32') }),

  capeGreen: () => ({ back: cape('#2f7d32', '#1f5a22', '#c9a227') }),

  ravenWings: () => ({ back: wings('#1d1d2b', '#5ad8ff', { span: 1.05, lift: 0.2 }) }),

  featherCollar: () => ({
    back: Array.from({ length: 9 }, (_, k) => {
      const a = Math.PI * 0.55 + (k / 8) * Math.PI * 0.9
      return cone(0.2, 0.75, 5, k % 2 ? '#1d1d2b' : '#2a2a40', {
        pos: [Math.cos(a) * 1.0, 0.95, -Math.abs(Math.sin(a)) * 0.85],
        rot: [-0.4, 0, -Math.cos(a) * 0.5],
      })
    }),
  }),

  mechaHelmet: () => ({
    head: [
      box(1.8, 0.45, 1.8, '#c7d0db', { pos: [0, 1.52, 0] }),
      box(0.22, 0.55, 1.45, '#38f0ff', { pos: [0, 1.95, -0.1] }),
      ...[-1, 1].map((side) => cyl(0.34, 0.34, 0.3, 10, '#38f0ff', { pos: [side * 0.94, 0.85, 0], rot: [0, 0, Math.PI / 2] })),
    ],
  }),

  jetpack: () => ({
    back: [
      box(1.2, 1.3, 0.4, '#3a4a5a', { pos: [0, -0.35, -1.05] }),
      ...[-1, 1].flatMap((side) => [
        cyl(0.38, 0.38, 1.6, 10, '#5a6a7a', { pos: [side * 0.62, -0.45, -1.3] }),
        cyl(0.3, 0.42, 0.3, 10, '#1f2833', { pos: [side * 0.62, -1.4, -1.3] }),
        cyl(0.26, 0.1, 0.5, 8, '#38f0ff', { pos: [side * 0.62, -1.8, -1.3] }),
      ]),
    ],
  }),

  vampireCape: () => ({
    back: [
      ...cape('#111111', '#b3001b', '#b3001b', 4.2),
      ...[-1, 1].flatMap((side) => [
        box(1.05, 1.45, 0.1, '#111111', { pos: [side * 0.66, 1.3, -0.86], rot: [-0.22, side * 0.55, 0] }),
        box(0.95, 1.35, 0.06, '#b3001b', { pos: [side * 0.62, 1.28, -0.8], rot: [-0.22, side * 0.55, 0] }),
      ]),
    ],
  }),

  tentacleBeard: () => ({
    head: [-0.5, -0.25, 0, 0.25, 0.5].map((x, i) =>
      cone(0.17, 1.05 + (i % 2) * 0.3, 6, '#1d7a71', { pos: [x, -0.35, 0.62], rot: [Math.PI + 0.18, 0, x * 0.35] }),
    ),
  }),

  finCrown: () => ({
    head: [
      plate(
        [
          [-0.75, 0],
          [0.75, 0],
          [0.25, 0.75],
          [0, 1.15],
          [-0.25, 0.75],
        ],
        0.1,
        '#ffd166',
        { pos: [0, 1.6, 0.1], rot: [0, Math.PI / 2, 0] },
      ),
      ...[-1, 1].map((side) =>
        plate(
          [
            [0, 0],
            [0.7, 0.2],
            [0.35, 0.8],
          ],
          0.08,
          '#ffd166',
          { pos: [side * 0.82, 1.2, 0], rot: [0, side > 0 ? 0 : Math.PI, 0] },
        ),
      ),
    ],
  }),

  trident: () => ({
    back: [
      cyl(0.07, 0.07, 4.4, 6, '#ffd166', { pos: [-0.2, -0.3, -1.08], rot: [0, 0, 0.3] }),
      ...[-0.3, 0, 0.3].map((dx, i) =>
        cone(0.12, i === 1 ? 0.8 : 0.6, 5, '#ffe9a6', { pos: [-0.86 + dx, 2.0 + (i === 1 ? 0.12 : 0), -1.08], rot: [0, 0, 0.3] }),
      ),
      box(0.8, 0.12, 0.12, '#ffd166', { pos: [-0.86, 1.68, -1.08], rot: [0, 0, 0.3] }),
    ],
  }),

  titanHelm: () => ({
    head: [
      box(1.8, 0.5, 1.8, '#ffcc33', { pos: [0, 1.5, 0] }),
      box(1.82, 0.25, 0.1, '#e0a820', { pos: [0, 1.32, 0.87] }),
      ...[-1, 1].map((side) => box(0.32, 1.15, 0.55, '#e0a820', { pos: [side * 1.0, 1.6, -0.1], rot: [0, 0, -side * 0.38] })),
    ],
  }),

  titanShoulders: () => ({
    back: [-1, 1].flatMap((side) => [
      box(1.4, 0.55, 1.95, '#ffcc33', { pos: [side * 2.0, 0.66, 0] }),
      box(1.0, 0.3, 1.5, '#e0a820', { pos: [side * 2.0, 1.05, 0] }),
    ]),
  }),

  voidCrown: () => ({
    head: [
      cyl(0.88, 0.88, 0.26, 12, '#2a1252', { pos: [0, 1.62, 0] }),
      ...[-0.9, -0.45, 0, 0.45, 0.9].map((a, i) =>
        cone(0.17, i === 2 ? 1.1 : 0.7, 5, '#b84dff', { pos: [Math.sin(a) * 0.78, 2.1 + (i === 2 ? 0.18 : 0), Math.cos(a) * 0.78] }),
      ),
      blob(0.2, '#e2a6ff', { pos: [0, 2.95, 0.4] }),
    ],
  }),

  voidCape: () => ({ back: cape('#1b0f33', '#b84dff', '#e2a6ff', 4.2) }),

  gearTopHat: () => ({
    head: [
      cyl(1.22, 1.22, 0.1, 16, '#1a1a1a', { pos: [0, 1.62, 0] }),
      cyl(0.84, 0.84, 1.3, 16, '#1a1a1a', { pos: [0, 2.3, 0] }),
      cyl(0.86, 0.86, 0.24, 16, '#c58b3a', { pos: [0, 1.82, 0] }),
      cyl(0.42, 0.42, 0.12, 12, '#ffd23f', { pos: [0, 2.1, 0.86], rot: [Math.PI / 2, 0, 0] }),
      ...Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2
        return box(0.16, 0.16, 0.1, '#ffd23f', { pos: [Math.cos(a) * 0.5, 2.1 + Math.sin(a) * 0.5, 0.86], rot: [0, 0, a] })
      }),
    ],
  }),

  windupKey: () => ({
    back: [
      cyl(0.1, 0.1, 0.8, 6, '#ffd23f', { pos: [0, -0.3, -1.2], rot: [Math.PI / 2, 0, 0] }),
      box(0.55, 0.85, 0.12, '#ffd23f', { pos: [0.42, -0.3, -1.65] }),
      box(0.55, 0.85, 0.12, '#ffd23f', { pos: [-0.42, -0.3, -1.65] }),
    ],
  }),

  plagueBeak: () => ({
    head: [
      cone(0.4, 1.6, 8, '#d8c8a4', { pos: [0, 0.5, 1.55], rot: [Math.PI / 2, 0, 0] }),
      ...[-1, 1].flatMap((side) => [
        cyl(0.24, 0.24, 0.12, 10, '#2a2a2a', { pos: [side * 0.38, 0.98, 0.86], rot: [Math.PI / 2, 0, 0] }),
        cyl(0.17, 0.17, 0.14, 10, '#7dff2a', { pos: [side * 0.38, 0.98, 0.9], rot: [Math.PI / 2, 0, 0] }),
      ]),
    ],
  }),

  wideHat: () => ({
    head: [
      cyl(1.95, 1.95, 0.1, 20, '#111111', { pos: [0, 1.62, 0] }),
      cyl(0.92, 0.97, 0.75, 16, '#111111', { pos: [0, 2.02, 0] }),
      cyl(0.99, 0.99, 0.2, 16, '#5a3a1a', { pos: [0, 1.75, 0] }),
    ],
  }),

  demonHorns: () => ({ head: horns('#1a0505', '#ff6a1f', 1.25) }),

  demonWings: () => ({ back: wings('#8a1010', '#3a0505', { span: 1.2, lift: 0.3 }) }),

  planetHalo: () => ({
    head: [
      ring(1.35, 0.07, '#ff4fd8', { pos: [0, 1.25, -0.2], rot: [Math.PI / 2 - 0.35, 0, 0] }),
      blob(0.22, '#ffd6fb', { pos: [1.32, 1.3, -0.4] }),
      blob(0.16, '#38f0ff', { pos: [-1.2, 1.55, 0.2] }),
      blob(0.13, '#ffd23f', { pos: [0.2, 1.75, -1.45] }),
    ],
  }),

  cosmicCape: () => ({ back: cape('#120a3a', '#ff4fd8', '#ffd6fb', 4.3) }),

  omniCrown: () => ({
    head: [
      cyl(0.9, 0.9, 0.3, 12, '#ffd23f', { pos: [0, 1.65, 0] }),
      ...Array.from({ length: 6 }, (_, k) => {
        const a = (k / 6) * Math.PI * 2
        return cone(0.18, k === 0 ? 1.2 : 0.85, 5, '#ffd23f', { pos: [Math.sin(a) * 0.78, 2.2 + (k === 0 ? 0.18 : 0), Math.cos(a) * 0.78] })
      }),
      blob(0.18, '#ff2a2a', { pos: [0, 1.68, 0.9] }),
    ],
  }),

  omniWings: () => ({ back: wings('#0c0c12', '#ffd23f', { span: 1.35, lift: 0.35 }) }),

  longHair: (look) => ({ head: longHair(look.hair, look.hairTips) }),

  twinBuns: (look) => ({
    head: [-1, 1].flatMap((side) => [
      blob(0.46, look.hair, { pos: [side * 0.66, 1.78, -0.22] }),
      box(0.5, 0.12, 0.5, '#ff6f91', { pos: [side * 0.66, 1.45, -0.22] }),
    ]),
  }),

  bowBig: () => ({
    head: [
      plate([[0, 0], [-0.9, 0.5], [-0.95, -0.5]], 0.14, '#ff6f91', { pos: [0, 1.15, -0.98] }),
      plate([[0, 0], [0.9, 0.5], [0.95, -0.5]], 0.14, '#ff6f91', { pos: [0, 1.15, -0.98] }),
      box(0.3, 0.3, 0.2, '#ff3d6e', { pos: [0, 1.15, -1.0] }),
    ],
  }),

  tiara: () => ({
    head: [
      cyl(0.9, 0.9, 0.1, 16, '#ffd23f', { pos: [0, 1.66, 0] }),
      cone(0.2, 0.62, 4, '#ffd23f', { pos: [0, 2.0, 0.78] }),
      cone(0.13, 0.4, 4, '#ffd23f', { pos: [0.42, 1.9, 0.72], rot: [0, 0, -0.25] }),
      cone(0.13, 0.4, 4, '#ffd23f', { pos: [-0.42, 1.9, 0.72], rot: [0, 0, 0.25] }),
      blob(0.13, '#ff1f3a', { pos: [0, 1.82, 0.9] }),
    ],
  }),

  skirt: (look) => ({ hips: skirtParts(look.skirt || look.shirt, look.skirtTrim, 1.25, 0.5) }),

  skirtLong: (look) => ({ hips: skirtParts(look.skirt || look.shirt, look.skirtTrim, 2.7, 0.85) }),

  finSkirt: (look) => ({
    hips: [
      ...skirtParts(look.pants, look.scales, 2.4, 0.55),
      // Fins round the hem, like a mermaid's tail.
      ...Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2
        return cone(0.34, 0.8, 4, look.scales || '#2fd6c0', {
          pos: [Math.sin(a) * 1.95, -2.45, Math.cos(a) * 1.35],
          rot: [Math.PI + Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5],
        })
      }),
    ],
  }),

  spiderLegs: () => ({
    back: [-1, 1].flatMap((side) =>
      [0.35, -0.1, -0.55, -1.0].flatMap((y, k) => {
        const reach = 1.5 - Math.abs(k - 1.5) * 0.25
        return [
          box(reach, 0.16, 0.16, '#16161f', { pos: [side * (0.5 + reach / 2), y + 0.45, -1.0], rot: [0, side * 0.35, side * 0.55] }),
          box(0.16, 1.3, 0.16, '#16161f', { pos: [side * (0.6 + reach), y + 0.35, -1.25], rot: [0.2, 0, side * 0.35] }),
          cone(0.1, 0.35, 4, '#e8e8ff', { pos: [side * (0.82 + reach), y - 0.45, -1.32], rot: [Math.PI, 0, -side * 0.35] }),
        ]
      }),
    ),
  }),

  ruff: () => ({
    back: Array.from({ length: 12 }, (_, k) => {
      const a = (k / 12) * Math.PI * 2
      return cone(0.3, 0.7, 4, k % 2 ? '#2ecc40' : '#6b2fa8', {
        pos: [Math.sin(a) * 1.0, 0.72, Math.cos(a) * 0.62],
        rot: [Math.cos(a) * 1.3, 0, -Math.sin(a) * 1.3],
      })
    }),
  }),

  capeDark: () => ({ back: cape('#1e1e1e', '#3a3a3a', '#7dff2a', 4.0) }),
}

/** Bones each gear slot attaches to, by rig bone name. */
export const GEAR_BONES = { head: 'Neck1', back: 'Spine2', hips: 'Spine1' }

const cache = new Map()

/**
 * Merged gear geometries for a villain: { head, back, hips }, each a BufferGeometry
 * (position, normal, uv, color) or null. Cached; shared by every user.
 */
export function getGear(villainId) {
  if (cache.has(villainId)) return cache.get(villainId)
  const villain = VILLAIN_BY_ID[villainId]
  const slots = { head: [], back: [], hips: [] }
  for (const name of villain?.gear || []) {
    const built = GEAR[name]?.(villain.look)
    if (!built) continue
    for (const slot of Object.keys(slots)) if (built[slot]) slots[slot].push(...built[slot])
  }
  const merged = {}
  for (const [slot, list] of Object.entries(slots)) {
    if (list.length === 0) {
      merged[slot] = null
      continue
    }
    // Strip to the attributes every part shares so they merge.
    for (const g of list) {
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
      if (!g.getAttribute('normal')) g.computeVertexNormals()
    }
    const geometry = mergeGeometries(list, false)
    list.forEach((g) => g.dispose())
    geometry.computeBoundingSphere()
    merged[slot] = geometry
  }
  cache.set(villainId, merged)
  return merged
}
