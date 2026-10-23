import { GATE_Z, LOBBY, TRACK_HALF, wallZ } from './layout'
import { colliderVersion, forEachObstacle } from './physics'

/**
 * Walking routes for the tutorial guide: A* over a 1 m grid of the lobby and the first
 * two stages, around every obstacle (treadmill consoles, fences, statues, egg stands,
 * gate pillars, the standing wall). The grid is rasterised straight from the colliders
 * and rebuilt only when they change. Called from a timer, never in the frame loop;
 * all working memory is allocated once, here.
 */

const CELL = 1
/** Player radius (0.35) plus a margin, so routes keep clear of corners. */
const CLEARANCE = 0.8
const X0 = LOBBY.x0
const Z0 = wallZ(2)
const COLS = Math.ceil((LOBBY.x1 - LOBBY.x0) / CELL)
const ROWS = Math.ceil((LOBBY.z1 - Z0) / CELL)
const N = COLS * ROWS
const MAX_POINTS = 64
/** How far (in cells) a blocked start or goal looks for open ground. */
const SNAP_CELLS = 4

const blocked = new Uint8Array(N)
const g = new Float32Array(N)
const parent = new Int32Array(N)
const seen = new Uint32Array(N)
const closed = new Uint32Array(N)
const cells = new Int32Array(N)
// Binary heap of open cells, keyed by f; stale duplicates are skipped when popped.
const heapCell = new Int32Array(N * 4)
const heapF = new Float32Array(N * 4)
let heapSize = 0
let search = 0
let builtVersion = -1

const DC = [1, -1, 0, 0, 1, 1, -1, -1]
const DR = [0, 0, 1, -1, 1, -1, 1, -1]

/** The current route: `count` (x, z) points in `points`, segment lengths, total metres. */
export const route = {
  points: new Float32Array(MAX_POINTS * 2),
  segments: new Float32Array(MAX_POINTS),
  count: 0,
  length: 0,
}

const cellX = (c) => X0 + (c + 0.5) * CELL
const cellZ = (r) => Z0 + (r + 0.5) * CELL
const colOf = (x) => Math.floor((x - X0) / CELL)
const rowOf = (z) => Math.floor((z - Z0) / CELL)
const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS

/** Open ground before obstacles: the lobby floor, and the stage track past the gate. */
function inArea(x, z) {
  if (z >= GATE_Z) return x > LOBBY.x0 && x < LOBBY.x1 && z < LOBBY.z1
  return Math.abs(x) < TRACK_HALF - CLEARANCE
}

function markBox(minX, minZ, maxX, maxZ) {
  const c0 = Math.max(0, colOf(minX - CLEARANCE))
  const c1 = Math.min(COLS - 1, colOf(maxX + CLEARANCE))
  const r0 = Math.max(0, rowOf(minZ - CLEARANCE))
  const r1 = Math.min(ROWS - 1, rowOf(maxZ + CLEARANCE))
  for (let r = r0; r <= r1; r += 1) {
    const z = cellZ(r)
    const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0
    for (let c = c0; c <= c1; c += 1) {
      const x = cellX(c)
      const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0
      if (dx * dx + dz * dz < CLEARANCE * CLEARANCE) blocked[r * COLS + c] = 1
    }
  }
}

function markCircle(x, z, radius) {
  const reach = radius + CLEARANCE
  const c0 = Math.max(0, colOf(x - reach))
  const c1 = Math.min(COLS - 1, colOf(x + reach))
  const r0 = Math.max(0, rowOf(z - reach))
  const r1 = Math.min(ROWS - 1, rowOf(z + reach))
  for (let r = r0; r <= r1; r += 1) {
    const dz = cellZ(r) - z
    for (let c = c0; c <= c1; c += 1) {
      const dx = cellX(c) - x
      if (dx * dx + dz * dz < reach * reach) blocked[r * COLS + c] = 1
    }
  }
}

function buildGrid() {
  const version = colliderVersion()
  if (version === builtVersion) return
  builtVersion = version
  for (let r = 0; r < ROWS; r += 1) {
    const z = cellZ(r)
    for (let c = 0; c < COLS; c += 1) blocked[r * COLS + c] = inArea(cellX(c), z) ? 0 : 1
  }
  forEachObstacle(markBox, markCircle)
}

/** The open cell nearest to (c, r), searching outwards ring by ring; -1 if none. */
function nearestOpen(c, r) {
  for (let ring = 0; ring <= SNAP_CELLS; ring += 1) {
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue
        const cc = c + dc
        const rr = r + dr
        if (inside(cc, rr) && !blocked[rr * COLS + cc]) return rr * COLS + cc
      }
    }
  }
  return -1
}

function push(cell, f) {
  if (heapSize >= heapCell.length) return
  let i = heapSize
  heapSize += 1
  while (i > 0) {
    const up = (i - 1) >> 1
    if (heapF[up] <= f) break
    heapCell[i] = heapCell[up]
    heapF[i] = heapF[up]
    i = up
  }
  heapCell[i] = cell
  heapF[i] = f
}

function pop() {
  const top = heapCell[0]
  heapSize -= 1
  const lastCell = heapCell[heapSize]
  const lastF = heapF[heapSize]
  let i = 0
  for (;;) {
    let child = i * 2 + 1
    if (child >= heapSize) break
    if (child + 1 < heapSize && heapF[child + 1] < heapF[child]) child += 1
    if (heapF[child] >= lastF) break
    heapCell[i] = heapCell[child]
    heapF[i] = heapF[child]
    i = child
  }
  heapCell[i] = lastCell
  heapF[i] = lastF
  return top
}

/** Octile distance between cells: exact for 8-way moves on an open grid. */
function octile(a, goalC, goalR) {
  const dc = Math.abs((a % COLS) - goalC)
  const dr = Math.abs(((a / COLS) | 0) - goalR)
  return dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr)
}

function astar(start, goal) {
  search += 1
  heapSize = 0
  const goalC = goal % COLS
  const goalR = (goal / COLS) | 0
  g[start] = 0
  parent[start] = -1
  seen[start] = search
  push(start, octile(start, goalC, goalR))
  while (heapSize > 0) {
    const i = pop()
    if (i === goal) return true
    if (closed[i] === search) continue
    closed[i] = search
    const c = i % COLS
    const r = (i / COLS) | 0
    for (let k = 0; k < 8; k += 1) {
      const nc = c + DC[k]
      const nr = r + DR[k]
      if (!inside(nc, nr)) continue
      const n = nr * COLS + nc
      if (blocked[n] || closed[n] === search) continue
      const diagonal = k >= 4
      // No cutting across the corner of an obstacle.
      if (diagonal && (blocked[r * COLS + nc] || blocked[nr * COLS + c])) continue
      const cost = g[i] + (diagonal ? Math.SQRT2 : 1)
      if (seen[n] === search && cost >= g[n]) continue
      seen[n] = search
      g[n] = cost
      parent[n] = i
      push(n, cost + octile(n, goalC, goalR))
    }
  }
  return false
}

/** True when the straight line between two points crosses no blocked cell. */
function lineClear(x0, z0, x1, z1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.4))
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps
    const c = colOf(x0 + (x1 - x0) * t)
    const r = rowOf(z0 + (z1 - z0) * t)
    if (!inside(c, r) || blocked[r * COLS + c]) return false
  }
  return true
}

function addPoint(x, z) {
  if (route.count >= MAX_POINTS) return
  route.points[route.count * 2] = x
  route.points[route.count * 2 + 1] = z
  route.count += 1
}

function measure() {
  route.length = 0
  for (let k = 0; k < route.count - 1; k += 1) {
    const p = route.points
    const len = Math.hypot(p[k * 2 + 2] - p[k * 2], p[k * 2 + 3] - p[k * 2 + 1])
    route.segments[k] = len
    route.length += len
  }
}

/**
 * Plans a walk from (sx, sz) to (tx, tz) into `route`: the cell path, pulled taut
 * into straight runs between corners. Falls back to a straight line when either end
 * is off the grid or no way through exists.
 */
export function planRoute(sx, sz, tx, tz) {
  buildGrid()
  route.count = 0
  addPoint(sx, sz)
  const sc = colOf(sx)
  const sr = rowOf(sz)
  const gc = colOf(tx)
  const gr = rowOf(tz)
  const start = inside(sc, sr) ? nearestOpen(sc, sr) : -1
  const goal = inside(gc, gr) ? nearestOpen(gc, gr) : -1
  if (start >= 0 && goal >= 0 && start !== goal && astar(start, goal)) {
    let length = 0
    for (let i = goal; i !== -1; i = parent[i]) {
      cells[length] = i
      length += 1
    }
    // Walk it start -> goal (cells is goal -> start), keeping only the corners.
    let from = length - 1
    let ax = cellX(cells[from] % COLS)
    let az = cellZ((cells[from] / COLS) | 0)
    while (from > 0) {
      let to = from - 1
      while (to > 0 && lineClear(ax, az, cellX(cells[to - 1] % COLS), cellZ((cells[to - 1] / COLS) | 0))) to -= 1
      ax = cellX(cells[to] % COLS)
      az = cellZ((cells[to] / COLS) | 0)
      if (to > 0) addPoint(ax, az)
      from = to
    }
  }
  addPoint(tx, tz)
  measure()
}

/**
 * Writes the point `s` metres along the route into `out` ({x, z, yaw}); `yaw` faces
 * along the route there.
 */
export function pointAlong(s, out) {
  const p = route.points
  let k = 0
  let at = 0
  while (k < route.count - 2 && at + route.segments[k] < s) {
    at += route.segments[k]
    k += 1
  }
  const len = route.segments[k] || 1
  const u = Math.min(1, Math.max(0, (s - at) / len))
  const ax = p[k * 2]
  const az = p[k * 2 + 1]
  const bx = p[k * 2 + 2]
  const bz = p[k * 2 + 3]
  out.x = ax + (bx - ax) * u
  out.z = az + (bz - az) * u
  out.yaw = Math.atan2(bx - ax, bz - az)
  return out
}

/**
 * Writes into `out` ({s, off}) how far along the route the point nearest to (x, z)
 * is, and how far (x, z) is from the route.
 */
export function progressAlong(x, z, out) {
  const p = route.points
  let best = Infinity
  let bestS = 0
  let at = 0
  for (let k = 0; k < route.count - 1; k += 1) {
    const ax = p[k * 2]
    const az = p[k * 2 + 1]
    const dx = p[k * 2 + 2] - ax
    const dz = p[k * 2 + 3] - az
    const len2 = dx * dx + dz * dz || 1
    const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
    const ex = ax + dx * u - x
    const ez = az + dz * u - z
    const d2 = ex * ex + ez * ez
    if (d2 < best) {
      best = d2
      bestS = at + route.segments[k] * u
    }
    at += route.segments[k]
  }
  out.s = bestS
  out.off = Math.sqrt(best)
  return out
}
