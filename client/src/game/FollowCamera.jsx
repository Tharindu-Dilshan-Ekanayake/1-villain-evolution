import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { cameraShake, events, player } from '../state/runtime'
import { GATE_Z, LOBBY, STAGE_END_Z, TRACK_HALF } from './layout'

/** How high above the player's origin the camera aims. */
const LOOK_HEIGHT = 1.4

const MIN_DISTANCE = 4
const MAX_DISTANCE = 22
const START_DISTANCE = 11

// Pitch limits, in radians. Stops the camera flipping over the top or sinking
// under the track.
const MIN_PITCH = -0.05
const MAX_PITCH = 1.25
const START_PITCH = 0.42

const DRAG_SENSITIVITY = 0.005
const TOUCH_SENSITIVITY = 0.008
const ZOOM_SENSITIVITY = 0.01

// Higher = snappier. Framerate-independent via the pow() smoothing below.
const POSITION_SMOOTHING = 5
const LOOK_SMOOTHING = 9

/** Extra distance the camera pulls back when a wall throws you (or you smash it). */
const KICK_DISTANCE = 2.6
const KICK_HEIGHT = 0.9

const _desired = new Vector3()
const _target = new Vector3()
const _shake = new Vector3()

/**
 * Third-person orbit camera and canvas input.
 *
 * Mouse: drag (either button) orbits, wheel zooms.
 * Touch: one-finger drag orbits, pinch zooms. (The joystick and buttons are DOM
 * elements above the canvas, so their touches never land here.)
 *
 * Reads the player position from runtime state rather than React state.
 */
export function FollowCamera() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const orbit = useRef({ yaw: 0, pitch: START_PITCH, distance: START_DISTANCE })
  const lookAt = useRef(new Vector3())
  const initialised = useRef(false)
  const shakeTime = useRef(0)
  /** 0..1 pull-back after a slam, easing away. */
  const kick = useRef(0)

  useEffect(() => {
    const el = gl.domElement
    if (!el) return undefined

    /** pointerId -> { x, y, button, type } */
    const pointers = new Map()
    let pinchDistance = 0

    const onPointerDown = (e) => {
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        type: e.pointerType,
      })
      el.setPointerCapture?.(e.pointerId)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }

    const onPointerMove = (e) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      const o = orbit.current

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        o.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, o.distance - (d - pinchDistance) * 0.03))
        pinchDistance = d
        return
      }

      const rotating = p.type === 'mouse' ? p.button === 0 || p.button === 2 : true
      if (!rotating) return
      const k = p.type === 'mouse' ? DRAG_SENSITIVITY : TOUCH_SENSITIVITY
      o.yaw -= dx * k
      o.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, o.pitch + dy * k))
    }

    const endPointer = (e) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      pointers.delete(e.pointerId)
      el.releasePointerCapture?.(e.pointerId)
    }

    const onWheel = (e) => {
      e.preventDefault()
      const o = orbit.current
      o.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, o.distance + e.deltaY * ZOOM_SENSITIVITY))
    }

    const onContextMenu = (e) => e.preventDefault()

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endPointer)
    el.addEventListener('pointercancel', endPointer)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('wheel', onWheel, { passive: false })

    // A teleport (respawn, rebirth) snaps the camera instead of swooping across the map.
    // A slam that knocks you back pulls the camera out so the flight reads; smashing
    // through gives a smaller punch-out.
    const offKnock = events.on('knockback', () => {
      kick.current = 1
    })
    const offSlam = events.on('slam', ({ broke }) => {
      if (broke) kick.current = Math.max(kick.current, 0.7)
    })
    const offTeleport = events.on('teleport', () => {
      initialised.current = false
    })

    return () => {
      offTeleport()
      offKnock()
      offSlam()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endPointer)
      el.removeEventListener('pointercancel', endPointer)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame((_state, delta) => {
    if (!player.ready) return
    const dt = Math.min(delta, 0.1)
    _target.set(player.x, player.y, player.z)

    const { yaw, pitch } = orbit.current
    kick.current *= Math.pow(0.08, dt)
    const distance = orbit.current.distance + kick.current * KICK_DISTANCE
    const horizontal = Math.cos(pitch) * distance
    _desired.set(
      _target.x + Math.sin(yaw) * horizontal,
      _target.y + Math.sin(pitch) * distance + LOOK_HEIGHT + kick.current * KICK_HEIGHT,
      _target.z + Math.cos(yaw) * horizontal,
    )

    // On the stage track, keep the camera between its brick walls and short of the
    // end of the line; in the lobby, inside the lobby walls.
    const limit = TRACK_HALF - 0.6
    if (player.z < GATE_Z - 2) {
      _desired.setX(Math.min(limit, Math.max(-limit, _desired.x)))
      _desired.setZ(Math.max(_desired.z, STAGE_END_Z + 0.8))
    } else {
      _desired.setX(Math.min(LOBBY.x1 - 1.6, Math.max(LOBBY.x0 + 1.6, _desired.x)))
      _desired.setZ(Math.min(LOBBY.z1 - 1.6, _desired.z))
      if (Math.abs(_desired.x) > limit) _desired.setZ(Math.max(GATE_Z + 1.6, _desired.z))
    }

    if (!initialised.current) {
      camera.position.copy(_desired)
      lookAt.current.copy(_target).setY(_target.y + LOOK_HEIGHT)
      initialised.current = true
    }

    camera.position.lerp(_desired, 1 - Math.pow(0.001, dt * (POSITION_SMOOTHING / 10)))
    _target.y += LOOK_HEIGHT
    lookAt.current.lerp(_target, 1 - Math.pow(0.001, dt * (LOOK_SMOOTHING / 10)))

    // Shake: a decaying jitter on the camera position, after smoothing.
    if (cameraShake.amount > 0.001) {
      shakeTime.current += dt
      const a = cameraShake.amount * 0.35
      const t = shakeTime.current * 60
      camera.position.add(
        _shake.set(Math.sin(t * 1.3) * a, Math.sin(t * 1.7 + 1) * a * 0.7, Math.sin(t * 1.1 + 2) * a * 0.5),
      )
      cameraShake.amount *= Math.pow(0.0008, dt)
    }

    camera.lookAt(lookAt.current)
  })

  return null
}

export default FollowCamera
