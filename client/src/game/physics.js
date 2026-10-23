import { useEffect } from 'react'

/**
 * A minimal collision world, in place of a physics engine.
 *
 * Every walkable surface in the game is flat ground at y = 0, and every obstacle is
 * taller than a jump: walls, rock faces, posts, statues, bags, trees. So collision is
 * a 2D problem on the ground plane - the player is a circle, obstacles are
 * axis-aligned boxes and circles - plus simple gravity for jumping. That replaces a
 * ~1.5 MB WebAssembly physics engine with a few dozen lines, and costs a handful of
 * arithmetic checks per frame.
 *
 * Obstacles live in flat arrays (no per-frame iterator allocation); components add
 * and remove them with `useColliders`.
 */

const boxes = []
const circles = []
/** Bumped on every add / remove, so cached maps of the obstacles know to rebuild. */
let version = 0

/** Axis-aligned box centred at (x, z) with half extents hx, hz. Returns a remover. */
export function addBox(x, z, hx, hz) {
  const box = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz }
  boxes.push(box)
  version += 1
  return () => {
    const i = boxes.indexOf(box)
    if (i >= 0) boxes.splice(i, 1)
    version += 1
  }
}

/** Vertical cylinder at (x, z) with radius r. Returns a remover. */
export function addCircle(x, z, r) {
  const circle = { x, z, r }
  circles.push(circle)
  version += 1
  return () => {
    const i = circles.indexOf(circle)
    if (i >= 0) circles.splice(i, 1)
    version += 1
  }
}

/**
 * Registers colliders for as long as the calling component is mounted.
 * Each def is { box: [x, z, hx, hz] } or { circle: [x, z, r] }.
 *
 * @param {() => Array<{box?: number[], circle?: number[]}>} build
 * @param {unknown[]} deps re-registers when these change
 */
export function useColliders(build, deps) {
  useEffect(() => {
    const removers = build().map((def) => (def.box ? addBox(...def.box) : addCircle(...def.circle)))
    return () => removers.forEach((remove) => remove())
    // The caller owns the dependency list, exactly like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Pushes a circle at `pos` ({x, z}, mutated) out of every obstacle it overlaps. */
function resolve(pos, radius) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i]
      // Quick reject before the exact test.
      if (pos.x < b.minX - radius || pos.x > b.maxX + radius || pos.z < b.minZ - radius || pos.z > b.maxZ + radius) {
        continue
      }
      const cx = clamp(pos.x, b.minX, b.maxX)
      const cz = clamp(pos.z, b.minZ, b.maxZ)
      const dx = pos.x - cx
      const dz = pos.z - cz
      const d2 = dx * dx + dz * dz
      if (d2 >= radius * radius) continue
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2)
        pos.x += (dx / d) * (radius - d)
        pos.z += (dz / d) * (radius - d)
      } else {
        // Centre inside the box: leave by the nearest face.
        const left = pos.x - b.minX
        const right = b.maxX - pos.x
        const near = pos.z - b.minZ
        const far = b.maxZ - pos.z
        const m = Math.min(left, right, near, far)
        if (m === left) pos.x = b.minX - radius
        else if (m === right) pos.x = b.maxX + radius
        else if (m === near) pos.z = b.minZ - radius
        else pos.z = b.maxZ + radius
      }
    }
    for (let i = 0; i < circles.length; i += 1) {
      const c = circles[i]
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const min = radius + c.r
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min) continue
      const d = Math.sqrt(d2) || 1e-5
      pos.x = c.x + (dx / d) * min
      pos.z = c.z + (dz / d) * min
    }
  }
}

/** Longest horizontal step before collisions are re-checked; thinner than any wall. */
const MAX_STEP = 0.2

/**
 * Moves a circle of `radius` at `pos` by (dx, dz), sliding along obstacles. Long
 * moves are split into short steps so a fast player can't pass through a wall.
 */
export function moveAndCollide(pos, dx, dz, radius) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_STEP))
  for (let s = 0; s < steps; s += 1) {
    pos.x += dx / steps
    pos.z += dz / steps
    resolve(pos, radius)
  }
}

/** For tests / tooling: how many obstacles are registered. */
export const colliderCount = () => boxes.length + circles.length

/** Changes whenever an obstacle is added or removed. */
export const colliderVersion = () => version

/** Calls onBox(minX, minZ, maxX, maxZ) and onCircle(x, z, r) for every obstacle. */
export function forEachObstacle(onBox, onCircle) {
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i]
    onBox(b.minX, b.minZ, b.maxX, b.maxZ)
  }
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i]
    onCircle(c.x, c.z, c.r)
  }
}
