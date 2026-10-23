import { STAGE_COUNT, wallHp } from './economy'

/**
 * Mutable, non-React runtime state shared between the render loop, the gameplay tick
 * and the audio/FX systems.
 *
 * None of this goes through zustand: it changes many times per second, and the frame
 * loop is forbidden from calling store.set. Writers mutate these objects in place;
 * readers poll them.
 */

/* --- Event bus ------------------------------------------------------------ */

function createEmitter() {
  const listeners = new Map()
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
      return () => listeners.get(type)?.delete(fn)
    },
    emit(type, payload) {
      const set = listeners.get(type)
      if (!set) return
      for (const fn of set) {
        try {
          fn(payload)
        } catch (err) {
          console.warn(`[events] ${type} listener failed`, err)
        }
      }
    },
  }
}

/**
 * Gameplay events: gain, slam, knockback, wallHit, wallCrack, wallBreak, padClaim,
 * winsHome, levelUp, rebirth, purchase, hatch, equip, error, teleport, runReset, jump,
 * land, step, ui, zone, feed, remoteBreak.
 */
export const events = createEmitter()

/* --- Player --------------------------------------------------------------- */

/** Written by Player's frame loop every frame; read by the tick, camera and labels. */
export const player = {
  x: 0,
  y: 0,
  z: 0,
  /** Facing angle about Y; 0 faces +Z. */
  yaw: Math.PI,
  speed: 0,
  grounded: true,
  ready: false,
  /** True while running in place on a treadmill (for the network and the camera). */
  training: false,
}

/**
 * Animation requests for the avatar. Gameplay bumps serial counters; the avatar's
 * frame loop notices the change and plays the move.
 */
export const playerFx = {
  /** Bumped on every wall slam; `slamBroke` says whether the wall gave way. */
  slamSerial: 0,
  slamBroke: false,
  victorySerial: 0,
  flexSerial: 0,
  /** 0..1, raised on slams so the aura flares; decays in the aura's frame loop. */
  auraPulse: 0,
}

export const requestVictory = () => {
  playerFx.victorySerial += 1
}
export const requestFlex = () => {
  playerFx.flexSerial += 1
}

/**
 * The local villain slammed into a wall (called from Player's frame loop, so it only
 * touches runtime state and emits an event). `broke`: the wall gave way.
 */
export function requestSlam(broke) {
  playerFx.slamBroke = broke
  playerFx.slamSerial += 1
  playerFx.auraPulse = 1
  shakeCamera(broke ? 0.85 : 0.4)
  events.emit('slam', { broke })
}

export const nowSeconds = () => performance.now() / 1000

/* --- Training ----------------------------------------------------------------- */

/**
 * Footsteps not yet paid out. The avatar's frame loop counts every step its feet
 * take here (walking, or running in place on a treadmill); the 10 Hz gameplay tick
 * turns them into Speed with one store write.
 */
export const trainer = { steps: 0 }

/* --- Touch / virtual input -------------------------------------------------- */

/** Written by the on-screen joystick and buttons; read by Player alongside the keyboard. */
export const virtualInput = {
  x: 0,
  y: 0,
  jump: false,
}

/* --- Stage run ------------------------------------------------------------ */

const N = STAGE_COUNT

/**
 * The current trip down the stage line: one wall per stage. Reset when the player
 * cashes in Wins, respawns or rebirths, and after 10 seconds back in the lobby, so
 * every run starts again from Stage 1's wall.
 */
export const stageRun = {
  serial: 0,
  hp: new Float64Array(N),
  maxHp: new Float64Array(N),
  broken: new Uint8Array(N),
  /** 0..1 damage per wall, for the crack shader. */
  damage: new Float32Array(N),
  /** performance.now() seconds of the last hit per wall, for the shake. */
  hitAt: new Float64Array(N),
  /** Highest crack stage reached per wall (0-3), so each crack sound plays once. */
  crackStage: new Uint8Array(N),
  /** True once a pad's Wins are claimed (the run ends with the trip home). */
  claimed: false,
}

/** Rebuilds every wall. */
export function resetRun() {
  for (let s = 0; s < N; s += 1) {
    const hp = wallHp(s)
    stageRun.hp[s] = hp
    stageRun.maxHp[s] = hp
    stageRun.broken[s] = 0
    stageRun.damage[s] = 0
    stageRun.hitAt[s] = -100
    stageRun.crackStage[s] = 0
  }
  stageRun.claimed = false
  stageRun.serial += 1
  events.emit('runReset', { serial: stageRun.serial })
}

resetRun()

/** Index of the first standing wall, or STAGE_COUNT when all are down. */
export function firstStandingWall() {
  for (let s = 0; s < N; s += 1) if (!stageRun.broken[s]) return s
  return N
}

/* --- Gameplay context ------------------------------------------------------ */

/** What the player is standing near, recomputed by the gameplay tick at 10 Hz. */
export const context = {
  zone: 'lobby',
  /** Id of the unlocked treadmill being trained on, or null. */
  pad: null,
  /** Yaw a treadmill runner faces (along the belt). */
  padYaw: 0,
}

/* --- Camera handle ---------------------------------------------------------- */

/** The R3F camera, so DOM effects outside the Canvas can project world points. */
export const cameraHandle = { camera: null, width: 1, height: 1 }

/** Camera shake requests, consumed by FollowCamera. */
export const cameraShake = { amount: 0 }

export function shakeCamera(amount) {
  cameraShake.amount = Math.min(1.2, Math.max(cameraShake.amount, amount))
}
