import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Helpers for building static props as merged, vertex-coloured geometry. A prop made
 * of twenty boxes and cylinders is still one mesh and one draw call.
 */

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _s = new Vector3()
const _p = new Vector3()
const _c = new Color()

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Non-indexed, with a flat `color` attribute and a uv attribute, ready to merge. */
export function colorize(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  if (geometry !== g) geometry.dispose()
  _c.set(hex)
  const count = g.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = _c.r
    colors[i * 3 + 1] = _c.g
    colors[i * 3 + 2] = _c.b
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
  return g
}

export function place(geometry, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  _e.set(rot[0], rot[1], rot[2])
  _q.setFromEuler(_e)
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]))
  geometry.applyMatrix4(_m)
  return geometry
}

export const box = (w, h, d, color, t) => place(colorize(new BoxGeometry(w, h, d), color), t)
export const cyl = (rt, rb, h, seg, color, t) =>
  place(colorize(new CylinderGeometry(rt, rb, h, seg), color), t)
export const cone = (r, h, seg, color, t) => place(colorize(new ConeGeometry(r, h, seg), color), t)

/** Merges and disposes the parts. Returns null for an empty list. */
export function merge(parts) {
  const list = parts.filter(Boolean)
  if (list.length === 0) return null
  const merged = mergeGeometries(list, false)
  list.forEach((g) => g.dispose())
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/**
 * A faceted low-poly rock: a jittered icosahedron with per-face colours - lighter on
 * top, darker underneath, and optionally a grassy cap on upward faces.
 */
/**
 * The unit icosahedron every rock starts from, and for each of its vertices the
 * shared corner it sits on (vertices are duplicated per face), numbered in order of
 * first appearance. Worked out once; rocks then only clone it.
 */
let rockTemplate = null
function getRockTemplate() {
  if (rockTemplate) return rockTemplate
  const geometry = new IcosahedronGeometry(1, 1)
  const p = geometry.getAttribute('position')
  const ids = new Map()
  const corner = new Uint16Array(p.count)
  for (let i = 0; i < p.count; i += 1) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`
    if (!ids.has(key)) ids.set(key, ids.size)
    corner[i] = ids.get(key)
  }
  rockTemplate = { geometry, corner, corners: ids.size }
  return rockTemplate
}

export function rock({ radius, scale = [1, 1, 1], pos, rot = [0, 0, 0], palette, grass, seed }) {
  const rand = mulberry32(seed)
  const template = getRockTemplate()
  const g = template.geometry.clone()
  const pos3 = g.getAttribute('position')
  // Jitter shared corners consistently, drawn in first-appearance order so every
  // seed gives the same rock it always has.
  const jitter = new Float32Array(template.corners)
  for (let c = 0; c < template.corners; c += 1) jitter[c] = 0.78 + rand() * 0.42
  for (let i = 0; i < pos3.count; i += 1) {
    const k = jitter[template.corner[i]]
    pos3.setXYZ(i, pos3.getX(i) * k, pos3.getY(i) * k, pos3.getZ(i) * k)
  }
  g.scale(radius * scale[0], radius * scale[1], radius * scale[2])
  place(g, { pos, rot })
  g.computeVertexNormals()

  const normal = g.getAttribute('normal')
  const colors = new Float32Array(pos3.count * 3)
  const light = new Color(palette.light)
  const mid = new Color(palette.mid)
  const dark = new Color(palette.dark)
  const grassColor = grass ? new Color(grass) : null
  const face = new Color()
  for (let i = 0; i < pos3.count; i += 3) {
    const ny = (normal.getY(i) + normal.getY(i + 1) + normal.getY(i + 2)) / 3
    if (grassColor && ny > 0.72) face.copy(grassColor).multiplyScalar(0.92 + rand() * 0.12)
    else if (ny > 0.25) face.copy(light).lerp(mid, rand() * 0.5)
    else if (ny > -0.3) face.copy(mid).lerp(dark, rand() * 0.5)
    else face.copy(dark)
    for (let v = 0; v < 3; v += 1) {
      colors[(i + v) * 3] = face.r
      colors[(i + v) * 3 + 1] = face.g
      colors[(i + v) * 3 + 2] = face.b
    }
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

/** Ellipse membership test used by placement code. */
export function insideEllipse(x, z, e, margin = 1) {
  const dx = (x - e.cx) / (e.rx * margin)
  const dz = (z - e.cz) / (e.rz * margin)
  return dx * dx + dz * dz <= 1
}
