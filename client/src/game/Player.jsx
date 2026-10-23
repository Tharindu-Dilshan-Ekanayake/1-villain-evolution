import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'

import { useBloxity } from '../bloxity/BloxityContext'
import { moveSpeed, powerRunSpeed, STAGE_COUNT } from '../state/economy'
import { hitWall, slamBreaks } from '../state/gameplay'
import { useGameStore } from '../state/gameStore'
import { context, events, firstStandingWall, player, requestSlam, virtualInput } from '../state/runtime'
import { SLAM_TIMING } from './avatarRig'
import ImpactFx from './fx/ImpactFx'
import { createTrailEmitter, stepTrail } from './fx/trailPool'
import VillainAura from './fx/VillainAura'
import { createLabel, escapeHtml } from './labels'
import { BELT_LENGTH, BELT_WIDTH, clampToWorld, GATE_Z, PAD_SPOT_BY_ID, SPAWN, TRACK_HALF, WALL_THICKNESS, wallZ } from './layout'
import { moveAndCollide } from './physics'
import PlayerAvatar from './PlayerAvatar'
import useKeyboard from './useKeyboard'

/** Where this player's walking trail left its last mark. */
const trailEmitter = createTrailEmitter()

/** Collision radius of the player on the ground plane. */
const PLAYER_RADIUS = 0.35
const PLAYER_HEIGHT = 1.8

const GRAVITY = 18
/** Take-off speed of a jump: about 1.3 m high. */
const JUMP_SPEED = 6.8
/** Stops one long Space press from re-triggering on landing. */
const JUMP_COOLDOWN_S = 0.25
/** Horizontal slow-down per frame when there's no input. */
const STOP_DAMPING = 0.8

// Scratch objects, reused each frame so the loop allocates nothing.
const _input = new Vector3()
const _move = new Vector3()
const _camForward = new Vector3()
const _camRight = new Vector3()
const _targetQuat = new Quaternion()
const _up = new Vector3(0, 1, 0)

/* --- Wall slams ----------------------------------------------------------------- */

/** How close to a wall's face counts as hitting it, and how fast you must be going. */
const CONTACT_GAP = 0.15
const MIN_SLAM_SPEED = 2
/** Bounced off a wall: launched back this fast, high enough to fly SLAM_TIMING.flight. */
const KNOCK_BACK_SPEED = 7.5
const KNOCK_UP = (GRAVITY * SLAM_TIMING.flight) / 2
/** Within this distance of the next wall the villain leans into a shoulder charge. */
const CHARGE_RANGE = 7
/** Auto-charging only continues while the wall is this close. */
const AUTO_CHARGE_RANGE = 20
/** Facing the wall: down the track, towards -Z. */
const FACE_WALL = Math.PI

/** Becoming a villain: two quick turns, easing out. */
const SPIN_TIME = 0.85
const SPIN_TURNS = 2

/** Pulls the runner onto the middle of the belt while training. */
const PAD_SNAP = 6

/** The name tag over your head: just your name. */
const nameplateHtml = (name) => `<div class="np-name">@${escapeHtml(name)}</div>`

/**
 * The player: a kinematic character on flat ground, collided against the static
 * obstacles in physics.js, with the avatar as its visual.
 *
 * Writes its position into `runtime.player` every frame for the camera, labels,
 * network and gameplay tick - a plain object write, never a store update.
 * `player.y` is the body's centre (feet + half the height).
 */
export function Player({ onAvatarReady }) {
  const rootRef = useRef(null)
  const visualRef = useRef(null)
  const spinRef = useRef(null)
  /** Seconds into the transformation spin (idle when past SPIN_TIME). */
  const spin = useRef(SPIN_TIME)
  useEffect(
    () =>
      events.on('transform', () => {
        spin.current = 0
      }),
    [],
  )
  const keys = useKeyboard()
  const { identity } = useBloxity()

  /**
   * Kinematic state. Mutable, so a ref. After a context-loss remount the player
   * resumes where they stood.
   */
  const body = useRef(null)
  if (body.current === null) {
    body.current = {
      x: player.ready ? player.x : SPAWN[0],
      z: player.ready ? player.z : SPAWN[2],
      feet: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      jumpCooldown: 0,
      /** Hit-stop against a wall that held, then the knockback launch. */
      stun: 0,
      knocked: false,
      /** Landing recovery after a knockback, before charging again. */
      recover: 0,
      /** Running back at the wall by itself (any input cancels it). */
      autoCharge: false,
      slamCooldown: 0,
    }
  }

  /** Motion state handed to the avatar so it can pose itself. */
  const motionRef = useRef({ time: 0, speed: 0, grounded: true, maxSpeed: 6, vy: 0 })

  // --- Nameplate ----------------------------------------------------------------
  const displayName = identity?.username || identity?.displayName || 'Guest'
  useEffect(() => {
    const label = createLabel({
      className: 'nameplate',
      maxDistance: 80,
      refDistance: 9,
      minScale: 0.55,
      maxScale: 1,
      follow: () => [player.x, player.y + PLAYER_HEIGHT / 2 + 0.55, player.z],
    })
    label.setHtml(nameplateHtml(displayName))
    return () => label.remove()
  }, [displayName])

  // --- Teleports (respawn, rebirth, stage complete) ------------------------------
  useEffect(
    () =>
      events.on('teleport', (target) => {
        const b = body.current
        const [x, , z] = target || SPAWN
        b.x = x
        b.z = z
        b.feet = 0
        b.vx = 0
        b.vz = 0
        b.vy = 0
        b.stun = 0
        b.knocked = false
        b.recover = 0
        b.autoCharge = false
        context.pad = null
        if (visualRef.current) visualRef.current.quaternion.setFromAxisAngle(_up, Math.PI)
      }),
    [],
  )

  useFrame((state, delta) => {
    const root = rootRef.current
    if (!root) return
    const b = body.current
    const dt = Math.min(delta, 0.1)
    b.jumpCooldown = Math.max(0, b.jumpCooldown - dt)
    b.slamCooldown = Math.max(0, b.slamCooldown - dt)
    const k = keys.current
    // Slammed into a wall: no steering until the knockback has played out.
    const locked = b.stun > 0 || b.knocked || b.recover > 0

    // --- Horizontal movement, relative to camera yaw -----------------------------
    const keyX = (k.right ? 1 : 0) - (k.left ? 1 : 0)
    const keyZ = (k.backward ? 1 : 0) - (k.forward ? 1 : 0)
    _input.set(keyX + virtualInput.x, 0, keyZ + virtualInput.y)
    const inputLength = locked ? 0 : Math.min(1, _input.length())
    const maxSpeed = moveSpeed(useGameStore.getState())

    // The next standing wall, if the player is out on the stage track in front of it.
    const wall = b.z < GATE_Z ? firstStandingWall() : STAGE_COUNT
    const wallFace = wall < STAGE_COUNT ? wallZ(wall) + WALL_THICKNESS / 2 : -Infinity
    if (inputLength > 0.05 || wall >= STAGE_COUNT || b.z - wallFace > AUTO_CHARGE_RANGE) b.autoCharge = false

    if (locked) {
      // Hit-stop, then flying back facing the wall; the landing skids to a stop.
      if (!b.knocked) {
        b.vx *= STOP_DAMPING
        b.vz *= STOP_DAMPING
      }
      if (visualRef.current) {
        _targetQuat.setFromAxisAngle(_up, FACE_WALL)
        visualRef.current.quaternion.slerp(_targetQuat, 1 - Math.pow(0.00001, dt))
      }
    } else if (b.autoCharge && inputLength <= 0.05) {
      // Back at the wall by itself, straight down the track.
      b.vx *= STOP_DAMPING
      b.vz = -maxSpeed
      if (visualRef.current) {
        _targetQuat.setFromAxisAngle(_up, FACE_WALL)
        visualRef.current.quaternion.slerp(_targetQuat, 1 - Math.pow(0.0001, dt))
      }
    } else if (inputLength > 0.05) {
      _input.normalize()
      // Flatten the camera's forward onto the ground so W always means "away from
      // the camera".
      state.camera.getWorldDirection(_camForward)
      _camForward.y = 0
      _camForward.normalize()
      _camRight.crossVectors(_camForward, _up).normalize()
      _move
        .set(0, 0, 0)
        .addScaledVector(_camForward, -_input.z)
        .addScaledVector(_camRight, _input.x)
        .normalize()
      const speed = maxSpeed * inputLength
      b.vx = _move.x * speed
      b.vz = _move.z * speed
      if (visualRef.current) {
        _targetQuat.setFromAxisAngle(_up, Math.atan2(_move.x, _move.z))
        visualRef.current.quaternion.slerp(_targetQuat, 1 - Math.pow(0.001, dt))
      }
    } else {
      b.vx *= STOP_DAMPING
      b.vz *= STOP_DAMPING
    }

    // --- Knockback: hit-stop, launch, landing, recovery ----------------------------
    if (b.stun > 0) {
      b.stun -= dt
      b.vx = 0
      b.vz = 0
      if (b.stun <= 0) {
        b.stun = 0
        b.knocked = true
        b.grounded = false
        b.vy = KNOCK_UP
        b.vz = KNOCK_BACK_SPEED
        events.emit('knockback')
      }
    } else if (b.recover > 0) {
      b.recover -= dt
      if (b.recover <= 0) {
        b.recover = 0
        // Up again: charge straight back in, unless the wall has gone meanwhile.
        b.autoCharge = wall < STAGE_COUNT
      }
    }

    // --- Treadmill: no input on an unlocked belt runs in place ------------------
    // The pad comes from the 10 Hz tick: only trust it while still standing on the belt.
    let spot = inputLength <= 0.05 && b.grounded && context.pad ? PAD_SPOT_BY_ID[context.pad] : null
    if (spot && (Math.abs(b.x - spot.x) > BELT_LENGTH / 2 || Math.abs(b.z - spot.z) > BELT_WIDTH / 2 + 0.3)) spot = null
    if (spot) {
      const pull = 1 - Math.exp(-PAD_SNAP * dt)
      b.x += (spot.x - b.x) * pull
      b.z += (spot.z - b.z) * pull
      b.vx = 0
      b.vz = 0
      if (visualRef.current) {
        _targetQuat.setFromAxisAngle(_up, spot.yaw)
        visualRef.current.quaternion.slerp(_targetQuat, 1 - Math.pow(0.0001, dt))
      }
    }

    // --- Gravity and jumping ----------------------------------------------------
    if ((k.jump || virtualInput.jump) && !locked && b.grounded && b.jumpCooldown === 0) {
      b.vy = JUMP_SPEED
      b.grounded = false
      b.jumpCooldown = JUMP_COOLDOWN_S
      events.emit('jump')
    }
    if (!b.grounded) {
      b.vy -= GRAVITY * dt
      b.feet += b.vy * dt
      if (b.feet <= 0) {
        if (b.vy < -3) events.emit('land')
        b.feet = 0
        b.vy = 0
        b.grounded = true
        if (b.knocked) {
          b.knocked = false
          b.recover = SLAM_TIMING.land
          b.vz *= 0.25
        }
      }
    }

    // --- Move, collide, and keep to the lobby / stage track -----------------------
    moveAndCollide(b, b.vx * dt, b.vz * dt, PLAYER_RADIUS)
    clampToWorld(b, PLAYER_RADIUS)
    root.position.set(b.x, b.feet, b.z)

    // --- Transformation spin ---------------------------------------------------------
    if (spinRef.current) {
      if (spin.current < SPIN_TIME) {
        spin.current += dt
        const u = Math.min(1, spin.current / SPIN_TIME)
        spinRef.current.rotation.y = (1 - (1 - u) ** 3) * Math.PI * 2 * SPIN_TURNS
      } else if (spinRef.current.rotation.y !== 0) {
        spinRef.current.rotation.y = 0
      }
    }

    // --- Slam: running into the next standing wall -------------------------------
    // Only runtime state changes here; the damage (and its store writes) is applied
    // just after this frame.
    const gap = b.z - wallFace - PLAYER_RADIUS
    if (
      !locked &&
      b.slamCooldown === 0 &&
      wall < STAGE_COUNT &&
      Math.abs(b.x) < TRACK_HALF &&
      gap < CONTACT_GAP &&
      gap > -0.6 &&
      b.vz < -MIN_SLAM_SPEED
    ) {
      const broke = slamBreaks(wall)
      requestSlam(broke)
      const hit = wall
      setTimeout(() => hitWall(hit), 0)
      b.slamCooldown = 0.3
      b.autoCharge = false
      if (!broke) {
        // The wall held: stick to it for a beat, then get thrown back.
        b.stun = SLAM_TIMING.hit
        b.vx = 0
        b.vz = 0
      }
    }

    // --- Publish -------------------------------------------------------------------
    const motion = motionRef.current
    motion.time += dt
    // On a treadmill the legs run at your full pace while the body stays put - Normal
    // Speed is for getting about, it never slows training.
    const pace = spot ? powerRunSpeed(useGameStore.getState()) : maxSpeed
    motion.speed = spot ? pace : Math.hypot(b.vx, b.vz)
    motion.grounded = b.grounded
    motion.maxSpeed = pace
    motion.vy = b.vy
    motion.charging = !locked && wall < STAGE_COUNT && gap < CHARGE_RANGE && b.vz < -MIN_SLAM_SPEED

    player.x = b.x
    player.y = b.feet + PLAYER_HEIGHT / 2
    player.z = b.z
    player.speed = motion.speed
    player.grounded = b.grounded
    player.training = Boolean(spot)
    if (!spot) stepTrail(trailEmitter, b.x, b.z, motion.speed, b.grounded, useGameStore.getState().villain)
    if (visualRef.current) {
      const q = visualRef.current.quaternion
      player.yaw = 2 * Math.atan2(q.y, q.w)
    }
    player.ready = true
  })

  return (
    <>
      <ImpactFx />
      <group ref={rootRef}>
      {/* Avatar origin is at the feet. Starts facing the gate (-Z). */}
      <group ref={visualRef} rotation={[0, Math.PI, 0]}>
        <group ref={spinRef}>
          <PlayerAvatar onReady={onAvatarReady} targetHeight={PLAYER_HEIGHT} motionRef={motionRef} />
          <VillainAura height={PLAYER_HEIGHT} />
        </group>
      </group>
      </group>
    </>
  )
}

export { PLAYER_HEIGHT }
export default Player
