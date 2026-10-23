import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Soft, rounded villains instead of hard boxes.
 *
 * Every Bloxity body part is a box (12-20 triangles). This cuts each face near its
 * edges and bends those strips onto a rounded box, so edges and corners curve like
 * a vinyl toy. Positions, UVs (the painted skin) and bone weights are carried through
 * the cuts, and normals come from the rounded shape, so lighting rolls smoothly over
 * the edges.
 *
 *   'round' - two strips per edge: properly round (live avatars on MEDIUM / HIGH)
 *   'bevel' - one strip: a soft chamfer at a third of the cost (statues, LOW)
 *
 * Only box-shaped parts are touched - every vertex on its bounding box's surface -
 * so custom account parts with other shapes pass through unchanged. Results are cached
 * per source geometry, so clones of the rig share them.
 */

/**
 * Edge radius as a share of the part's smallest half-size: long parts (arms, legs)
 * round off nearly into capsules, blocky ones (head, torso) keep flat faces to paint.
 */
const ROUNDNESS_LONG = 0.8
const ROUNDNESS_BLOCK = 0.6
const cache = new Map()

/** [x, y, z, u, v, nx, ny, nz, w0, w1, w2, w3] - weights over the part's own bones. */
const STRIDE = 12

function lerpVertex(a, b, t) {
  const out = new Float32Array(STRIDE)
  for (let k = 0; k < STRIDE; k += 1) out[k] = a[k] + (b[k] - a[k]) * t
  return out
}

/** Splits a convex polygon by the plane `axis = value` into the parts below and above. */
function split(poly, axis, value) {
  const below = []
  const above = []
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const da = a[axis] - value
    const db = b[axis] - value
    if (da <= 0) below.push(a)
    if (da >= 0) above.push(a)
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const cut = lerpVertex(a, b, da / (da - db))
      below.push(cut)
      above.push(cut)
    }
  }
  return [below, above]
}

function cutsFor(min, max, r, mode) {
  return mode === 'round' ? [min + r * 0.5, min + r, max - r, max - r * 0.5] : [min + r, max - r]
}

function build(source, mode) {
  if (source.groups.length > 1) return null
  const g = source.index ? source.toNonIndexed() : source
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  const normal = g.getAttribute('normal')
  const skinIndex = g.getAttribute('skinIndex')
  const skinWeight = g.getAttribute('skinWeight')
  if (!pos || !uv || !normal) return null
  const count = pos.count

  g.computeBoundingBox()
  const { min, max } = g.boundingBox
  const lo = [min.x, min.y, min.z]
  const hi = [max.x, max.y, max.z]
  const half = [0, 1, 2].map((a) => (hi[a] - lo[a]) / 2)
  const eps = Math.max(...half) * 1e-3
  // A box only: every vertex lies on one of its bounding box's faces.
  for (let i = 0; i < count; i += 1) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    if (!p.some((v, a) => Math.abs(v - lo[a]) < eps || Math.abs(v - hi[a]) < eps)) return null
  }

  // The bones this part follows (at most 4), so weights can be blended across cuts.
  const bones = []
  if (skinIndex && skinWeight) {
    for (let i = 0; i < count; i += 1) {
      for (let k = 0; k < 4; k += 1) {
        const b = skinIndex.getComponent(i, k)
        if (skinWeight.getComponent(i, k) > 1e-4 && !bones.includes(b)) bones.push(b)
      }
    }
    if (bones.length > 4) return null
  }

  const vertex = (i) => {
    const v = new Float32Array(STRIDE)
    v[0] = pos.getX(i)
    v[1] = pos.getY(i)
    v[2] = pos.getZ(i)
    v[3] = uv.getX(i)
    v[4] = uv.getY(i)
    v[5] = normal.getX(i)
    v[6] = normal.getY(i)
    v[7] = normal.getZ(i)
    if (skinIndex && skinWeight) {
      for (let k = 0; k < 4; k += 1) {
        const slot = bones.indexOf(skinIndex.getComponent(i, k))
        if (slot >= 0) v[8 + slot] += skinWeight.getComponent(i, k)
      }
    }
    return v
  }

  const long = Math.max(...half) > Math.min(...half) * 1.4
  const r = Math.min(...half) * (long ? ROUNDNESS_LONG : ROUNDNESS_BLOCK)
  const cuts = [0, 1, 2].map((a) => cutsFor(lo[a], hi[a], r, mode))

  const triangles = []
  for (let i = 0; i < count; i += 3) {
    let polys = [[vertex(i), vertex(i + 1), vertex(i + 2)]]
    for (let a = 0; a < 3; a += 1) {
      for (const value of cuts[a]) {
        const next = []
        for (const poly of polys) {
          for (const part of split(poly, a, value)) if (part.length >= 3) next.push(part)
        }
        polys = next
      }
    }
    for (const poly of polys) for (let k = 1; k < poly.length - 1; k += 1) triangles.push(poly[0], poly[k], poly[k + 1])
  }

  // Bend onto the rounded box: clamp into the box shrunk by r, then push out by r.
  const n = triangles.length
  const outPos = new Float32Array(n * 3)
  const outNormal = new Float32Array(n * 3)
  const outUv = new Float32Array(n * 2)
  const outIndex = skinIndex ? new skinIndex.array.constructor(n * 4) : null
  const outWeight = new Float32Array(n * 4)
  const centre = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2)
  for (let i = 0; i < n; i += 1) {
    const v = triangles[i]
    const inner = [0, 0, 0]
    for (let a = 0; a < 3; a += 1) {
      const c = centre[a]
      const h = half[a] - r
      inner[a] = Math.min(c + h, Math.max(c - h, v[a]))
    }
    const dx = v[0] - inner[0]
    const dy = v[1] - inner[1]
    const dz = v[2] - inner[2]
    const len = Math.hypot(dx, dy, dz)
    if (len > 1e-6) {
      outNormal[i * 3] = dx / len
      outNormal[i * 3 + 1] = dy / len
      outNormal[i * 3 + 2] = dz / len
      outPos[i * 3] = inner[0] + (dx / len) * r
      outPos[i * 3 + 1] = inner[1] + (dy / len) * r
      outPos[i * 3 + 2] = inner[2] + (dz / len) * r
    } else {
      outNormal.set([v[5], v[6], v[7]], i * 3)
      outPos.set([v[0], v[1], v[2]], i * 3)
    }
    outUv[i * 2] = v[3]
    outUv[i * 2 + 1] = v[4]
    let sum = 0
    for (let k = 0; k < bones.length; k += 1) sum += v[8 + k]
    if (outIndex) {
      for (let k = 0; k < 4; k += 1) {
        outIndex[i * 4 + k] = bones[k] ?? 0
        outWeight[i * 4 + k] = k < bones.length && sum > 0 ? v[8 + k] / sum : 0
      }
    }
  }

  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(outPos, 3))
  out.setAttribute('normal', new BufferAttribute(outNormal, 3))
  out.setAttribute('uv', new BufferAttribute(outUv, 2))
  if (outIndex && skinWeight) {
    out.setAttribute('skinIndex', new BufferAttribute(outIndex, 4))
    out.setAttribute('skinWeight', new BufferAttribute(outWeight, 4))
  }
  out.computeBoundingBox()
  out.computeBoundingSphere()
  if (g !== source) g.dispose()
  return out
}

/**
 * The rounded version of a box-shaped body part (or the part itself if it isn't a
 * box, or `mode` is 'none'). Cached under `key` (the geometry's own id by default):
 * never dispose the result.
 *
 * @param {BufferGeometry} geometry
 * @param {'round' | 'bevel' | 'none'} mode
 * @param {string} [key]
 */
export function softenPart(geometry, mode, key = geometry?.uuid) {
  if (!geometry || mode === 'none') return geometry
  key = `${key}:${mode}`
  if (!cache.has(key)) cache.set(key, build(geometry, mode) || geometry)
  return cache.get(key)
}

/** Which rounding the live avatars get on a quality preset. */
export const softModeFor = (presetName) => (presetName === 'LOW' ? 'bevel' : 'round')
