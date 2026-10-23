import { Color } from 'three'

import { nowSeconds } from '../../state/runtime'

/**
 * Wall-slam shockwave rings: the shared pool behind fx/ImpactFx.jsx. The local
 * player's slams and other players' (RemotePlayers) both feed it.
 */

/** Rings alive at once: two per slam (wall + ground), a few slams deep. */
export const POOL = 8
/** Seconds a ring lasts. */
export const LIFE = 0.42

export const rings = Array.from({ length: POOL }, () => ({
  start: -10,
  x: 0,
  y: 0,
  z: 0,
  size: 1,
  flat: false,
  color: new Color(),
}))
let next = 0

/**
 * One shockwave ring at (x, y, z): upright on a wall face, or `flat` on the ground,
 * growing to `size` metres across. Allocation-free; safe from frame loops.
 */
export function spawnImpact(x, y, z, size, color, flat = false) {
  const r = rings[next]
  next = (next + 1) % POOL
  r.start = nowSeconds()
  r.x = x
  r.y = y
  r.z = z
  r.size = size
  r.flat = flat
  r.color.set(color)
}

/** A slam at (x, z): a ring across the wall face just ahead, and dust at the feet. */
export function spawnSlam(x, z, broke, color) {
  spawnImpact(x, 1.2, z - 0.5, broke ? 7 : 3.2, color)
  spawnImpact(x, 0.06, z, broke ? 5 : 2.4, color, true)
}
