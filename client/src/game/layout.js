import { EGGS, TREADMILLS, VILLAINS } from '../state/content'
import { STAGE_COUNT } from '../state/economy'

/**
 * World layout, in metres (the player is 1.8 tall). Rendering, colliders and the
 * gameplay tick all read positions from here, so moving something is a one-line edit.
 *
 *   -Z (north)  the stage line: one long walled track, 50 stages in a row (~2 km)
 *               STAGES gate in the lobby's north wall, record boards either side
 *     west      TRAINING: treadmills  |  path  |  VILLAINS: the statue gallery   east
 *               spawn                                                  <- (0, 0, 22)
 *   +Z (south)  EGGS: an arc of egg stands behind spawn, facing it
 *               lobby wall
 */

export const SPAWN = [0, 1.5, 22]

/** The lobby: a lime baseplate fenced in by the template's tan brick walls. */
export const LOBBY = { x0: -44, x1: 44, z0: -40, z1: 54 }
export const LOBBY_WALL_HEIGHT = 12
export const LOBBY_WALL_THICKNESS = 2

/** The red running path (yellow borders) from spawn to the gate and down every stage. */
export const PATH_HALF = 4

/* --- Stage line ---------------------------------------------------------- */

/** The gate in the lobby's north wall; the stage track runs north from it. */
export const GATE_Z = LOBBY.z0
/** Half width of the stage track (inner face of its brick walls). */
export const TRACK_HALF = 12
export const TRACK_WALL_HEIGHT = 10

/** Run-up from the gate to Stage 1's wall. */
const FIRST_WALL_OFFSET = 14
/** Distance from one stage's wall to the next. */
export const STAGE_LENGTH = 40

export const WALL_WIDTH = TRACK_HALF * 2
export const WALL_HEIGHT = 9
export const WALL_THICKNESS = 1.6

/** Z of stage `s`'s wall (centre of its thickness). Breaking it opens stage s + 1. */
export const wallZ = (s) => GATE_Z - FIRST_WALL_OFFSET - s * STAGE_LENGTH

/** The far end of the line: a solid wall behind the last stage. */
export const STAGE_END_Z = wallZ(STAGE_COUNT - 1) - STAGE_LENGTH

/** Stage `s` is the stretch between its wall and the next one. */
export function stageSpan(s) {
  const z0 = wallZ(s) - WALL_THICKNESS / 2
  const z1 = s === STAGE_COUNT - 1 ? STAGE_END_Z : wallZ(s + 1) + WALL_THICKNESS / 2
  return { z0, z1 }
}

/** Each stage's WINS pad: in the left corner (facing up the track), by the next wall. */
export const PAD_SIZE = 3.4
export const padX = () => -(TRACK_HALF - PAD_SIZE / 2 - 0.6)
export const padZ = (s) => stageSpan(s).z1 + PAD_SIZE / 2 + 1.2

/** Stage whose stretch contains `z` (0-based), or -1 before Stage 1's wall. */
export function stageAtZ(z) {
  if (z > wallZ(0) - WALL_THICKNESS / 2) return -1
  return Math.min(STAGE_COUNT - 1, Math.floor((wallZ(0) - WALL_THICKNESS / 2 - z) / STAGE_LENGTH))
}

/** Past the gate, on the stage track. */
export const inStageArea = (x, z) => z < GATE_Z - 0.5 && Math.abs(x) < TRACK_HALF + 1

/* --- Villain gallery ------------------------------------------------------- */

/** Three straight lines on the right of the path, running from spawn towards the gate. */
const GALLERY_X = [11, 19, 27]
const GALLERY_Z0 = 22
const GALLERY_STEP = 7.2
/** Win villains per line; the rest of them continue on the second line. */
const GALLERY_LINE = 8

const byWins = VILLAINS.filter((v) => !v.cost.rp).sort((a, b) => (a.cost.wins || 0) - (b.cost.wins || 0))
const byRebirths = VILLAINS.filter((v) => v.cost.rp).sort((a, b) => a.cost.rp - b.cost.rp)

/**
 * Every villain on a pedestal on the right side of the lobby, cheapest first. The line
 * by the path starts at spawn with your own avatar and the 3-Win tutorial villain and
 * climbs in Wins towards the gate; the second line carries on from the most expensive
 * of those (set half a step back so it shows between them); the third line is the
 * Rebirth villains, by Rebirth Points. Statues face the path (-X).
 */
export const PEDESTALS = [
  ...byWins.map((v, i) => {
    const line = Math.floor(i / GALLERY_LINE)
    const k = i % GALLERY_LINE
    return { id: v.id, x: GALLERY_X[line], z: GALLERY_Z0 - k * GALLERY_STEP - line * (GALLERY_STEP / 2), facing: -Math.PI / 2 }
  }),
  ...byRebirths.map((v, i) => ({ id: v.id, x: GALLERY_X[2], z: GALLERY_Z0 - i * GALLERY_STEP, facing: -Math.PI / 2 })),
]

/** Round glowing pad in front of each statue that the player steps on. */
export const PEDESTAL_PAD = 2.6

/* --- Training treadmills -------------------------------------------------- */

/** Belt size: runners face +X (towards the path), the belt runs along X. */
export const BELT_LENGTH = 4.2
export const BELT_WIDTH = 2.4

/**
 * Two columns of treadmills on the left of the path, the free one nearest spawn.
 * Runners face east, so the camera behind them looks across the lobby.
 */
export const PAD_SPOTS = TREADMILLS.map((pad, i) => {
  const col = i < 6 ? 0 : 1
  const row = i < 6 ? i : i - 6
  const x = col === 0 ? -20 : -32
  const z = col === 0 ? 20 - row * 9 : 15.5 - row * 9
  return { id: pad.id, x, z, yaw: Math.PI / 2 }
})

export const PAD_SPOT_BY_ID = Object.fromEntries(PAD_SPOTS.map((s) => [s.id, s]))

/* --- Eggs ------------------------------------------------------------------ */

/** The egg arc behind spawn: centre, radius and the angle between stands. */
const EGG_ARC = { x: 0, z: 30, r: 14, step: 0.5 }
/** How far in front of its egg (towards spawn) a hatch pad sits. */
const EGG_PAD_OFFSET = 4.2

/** Egg stands in an arc behind spawn, facing it; you hatch from the pad in front. */
export const EGG_SPOTS = EGGS.map((egg, i) => {
  const a = (i - (EGGS.length - 1) / 2) * EGG_ARC.step
  const x = EGG_ARC.x + Math.sin(a) * EGG_ARC.r
  const z = EGG_ARC.z + Math.cos(a) * EGG_ARC.r
  return { id: egg.id, x, z, padX: x - Math.sin(a) * EGG_PAD_OFFSET, padZ: z - Math.cos(a) * EGG_PAD_OFFSET }
})

/** Big signs over each area of the lobby. */
export const AREA_SIGNS = [
  { title: 'TRAINING', color: '#41e05a', x: -26, y: 7.5, z: 0 },
  { title: 'VILLAINS', color: '#c27bff', x: 15, y: 8.5, z: -6 },
  { title: 'REBIRTH VILLAINS', color: '#ff5bd8', x: 27, y: 7, z: 8, small: true },
  { title: 'EGGS', color: '#ffd23f', x: 0, y: 7.5, z: 46 },
]

/* --- Leaderboards ------------------------------------------------------------ */

/** Record boards on the north wall either side of the gate, facing spawn. */
export const BOARDS = [
  { id: 'speed', title: 'TOP SPEED', color: '#ff3b5c', x: -32, z: GATE_Z + 1.15 },
  { id: 'wins', title: 'TOP WINS', color: '#f2c200', x: -20, z: GATE_Z + 1.15 },
  { id: 'rebirths', title: 'REBIRTHS', color: '#22c55e', x: 20, z: GATE_Z + 1.15 },
  { id: 'time', title: 'PLAY TIME', color: '#14c8e6', x: 32, z: GATE_Z + 1.15 },
]

/* --- Bounds ---------------------------------------------------------------- */

/** Keeps a point inside the lobby or on the stage track (colliders do the fine work). */
export function clampToWorld(pos, radius) {
  if (pos.z < GATE_Z && Math.abs(pos.x) < TRACK_HALF + 2) {
    pos.x = Math.max(-TRACK_HALF + radius, Math.min(TRACK_HALF - radius, pos.x))
    pos.z = Math.max(STAGE_END_Z + radius, pos.z)
    return
  }
  pos.x = Math.max(LOBBY.x0 + LOBBY_WALL_THICKNESS / 2 + radius, Math.min(LOBBY.x1 - LOBBY_WALL_THICKNESS / 2 - radius, pos.x))
  pos.z = Math.max(LOBBY.z0 - 2, Math.min(LOBBY.z1 - LOBBY_WALL_THICKNESS / 2 - radius, pos.z))
}
