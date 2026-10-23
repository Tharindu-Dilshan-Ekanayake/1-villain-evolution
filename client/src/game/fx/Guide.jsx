import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Shape,
  ShapeGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { TUTORIAL_DONE, useGameStore } from '../../state/gameStore'
import { events, player } from '../../state/runtime'
import { TUTORIAL_STEPS } from '../../state/tutorial'
import { colliderVersion } from '../physics'
import { planRoute, pointAlong, progressAlong, route } from '../guidePath'
import { createLabel } from '../labels'
import { createBeamMaterial } from '../world/materials'

/** Chevrons on the ground: how many, how far apart, and how fast they flow (m/s). */
const ARROWS = 60
const SPACING = 1.5
const FLOW = 2.4
/** Trail starts this far ahead of the player and stops this short of the goal. */
const START_GAP = 1.1
const END_GAP = 1.4
/** Height above the floor (over the path, under pad tops). */
const TRAIL_Y = 0.07
/** Close enough: the trail, arrow and label step aside. */
const NEAR = 2.6

/** Re-planning: how often to check, and when the player has wandered off the route. */
const PLAN_MS = 250
const OFF_ROUTE = 1.8
const TARGET_MOVED = 0.5

const _dummy = new Object3D()
const _hidden = new Matrix4().makeScale(0, 0, 0)
const _at = { x: 0, z: 0, yaw: 0 }
const _progress = { s: 0, off: 0 }

/** A flat chevron pointing +Z, bright yellow over a dark outline, in vertex colours. */
function buildChevron() {
  const layer = (scale, y, color) => {
    const s = new Shape()
    const pts = [
      [0, 0.45],
      [0.62, -0.17],
      [0.62, -0.47],
      [0, 0.15],
      [-0.62, -0.47],
      [-0.62, -0.17],
    ]
    pts.forEach(([x, z], i) => (i === 0 ? s.moveTo(x * scale, z * scale) : s.lineTo(x * scale, z * scale)))
    s.closePath()
    const g = new ShapeGeometry(s)
    // Shape space +Y becomes world +Z; the material is double-sided.
    g.rotateX(Math.PI / 2)
    g.translate(0, y, 0)
    const count = g.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) colors.set(color, i * 3)
    g.setAttribute('color', new BufferAttribute(colors, 3))
    return g
  }
  const outline = layer(1.28, 0, [0.106, 0.067, 0.188])
  const fill = layer(1, 0.012, [1, 0.82, 0.25])
  const merged = mergeGeometries([outline, fill], false)
  outline.dispose()
  fill.dispose()
  return merged.scale(1.3, 1, 1.3)
}

function labelHtml(text, metres) {
  return `<div class="guide-bob"><div class="guide-text">${text}</div><div class="guide-dist">${metres} m</div></div>`
}

/**
 * Tutorial wayfinding, so a new player can't miss the way:
 *  - a trail of glowing chevrons on the ground, flowing from the player to the goal
 *    along a real walking route (around treadmills, fences, statues - guidePath.js);
 *  - a golden light column, a pulsing ring and a big bouncing arrow on the goal,
 *    with its name and the distance left;
 *  - an arrow over the player's head pointing the way.
 * Gameplay-critical, so it renders on every quality preset: five small draw calls.
 */
export function Guide() {
  const step = useGameStore((s) => s.tutorial)
  const groupRef = useRef(null)
  const beamRef = useRef(null)
  const ringRef = useRef(null)
  const arrowRef = useRef(null)
  const markerRef = useRef(null)
  const trailRef = useRef(null)
  /** Distance left along the route, refreshed with each plan check. */
  const remaining = useRef(Infinity)

  const geo = useMemo(
    () => ({
      beam: new CylinderGeometry(0.9, 0.9, 1, 16, 1, true),
      ring: new RingGeometry(1.1, 1.45, 32).rotateX(-Math.PI / 2),
      arrow: new ConeGeometry(0.42, 1.1, 4).rotateX(Math.PI / 2),
      marker: new ConeGeometry(0.85, 1.6, 4).rotateX(Math.PI),
      chevron: buildChevron(),
    }),
    [],
  )
  const mat = useMemo(
    () => ({
      beam: createBeamMaterial('#ffd23f', 0.55),
      ring: new MeshBasicMaterial({ color: '#ffd23f', transparent: true, depthWrite: false }),
      arrow: new MeshBasicMaterial({ color: '#ffd23f' }),
      trail: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    }),
    [],
  )
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
      Object.values(mat).forEach((m) => m.dispose())
    },
    [geo, mat],
  )

  const active = step !== TUTORIAL_DONE && Boolean(TUTORIAL_STEPS[step])

  // Route planning and the goal label, off the frame loop.
  useEffect(() => {
    if (!active) return undefined
    const current = TUTORIAL_STEPS[step]
    const label = createLabel({
      position: [0, 0, 0],
      className: 'guide-label',
      far: true,
      maxDistance: 400,
      refDistance: 16,
      minScale: 0.55,
      maxScale: 1.15,
    })
    let planned = { x: NaN, z: NaN, version: -1 }
    let replan = true
    let lastHtml = ''
    const offTeleport = events.on('teleport', () => {
      replan = true
    })
    const check = () => {
      const target = current.target()
      if (!target || !player.ready) {
        route.count = 0
        label.setHidden(true)
        return
      }
      const [tx, tz] = target
      progressAlong(player.x, player.z, _progress)
      if (
        replan ||
        route.count < 2 ||
        _progress.off > OFF_ROUTE ||
        Math.hypot(tx - planned.x, tz - planned.z) > TARGET_MOVED ||
        colliderVersion() !== planned.version
      ) {
        planRoute(player.x, player.z, tx, tz)
        planned = { x: tx, z: tz, version: colliderVersion() }
        replan = false
        progressAlong(player.x, player.z, _progress)
      }
      remaining.current = route.length - _progress.s
      const near = remaining.current < NEAR
      label.setHidden(near)
      label.setPosition(tx, 6.9, tz)
      const html = labelHtml(current.label || 'GO', Math.max(1, Math.round(remaining.current)))
      if (html !== lastHtml) {
        lastHtml = html
        label.setHtml(html)
      }
    }
    check()
    const id = setInterval(check, PLAN_MS)
    return () => {
      clearInterval(id)
      offTeleport()
      label.remove()
      route.count = 0
      remaining.current = Infinity
    }
  }, [active, step])

  useFrame((state) => {
    const target = active ? TUTORIAL_STEPS[step].target() : null
    const show = Boolean(target)
    const group = groupRef.current
    if (!group) return
    group.visible = show
    if (!target) return
    const t = state.clock.elapsedTime
    const [tx, tz] = target
    const near = remaining.current < NEAR

    beamRef.current.position.set(tx, 10, tz)
    beamRef.current.scale.set(1, 20, 1)
    const pulse = 1 + (t % 1.2) / 1.2
    ringRef.current.position.set(tx, 0.12, tz)
    ringRef.current.scale.set(pulse, 1, pulse)
    ringRef.current.material.opacity = 1 - (t % 1.2) / 1.2

    // The bouncing marker over the goal.
    const marker = markerRef.current
    marker.position.set(tx, 4.6 + Math.abs(Math.sin(t * 3.2)) * 0.9, tz)
    marker.rotation.set(0, t * 1.6, 0)

    // The trail: chevrons flowing along the route, from just ahead of the player.
    const trail = trailRef.current
    const ready = route.count >= 2 && !near
    const start = ready ? progressAlong(player.x, player.z, _progress).s + START_GAP : 0
    const end = route.length - END_GAP
    const offset = (t * FLOW) % SPACING
    for (let i = 0; i < ARROWS; i += 1) {
      const s = start + offset + i * SPACING
      if (!ready || s > end) {
        trail.setMatrixAt(i, _hidden)
        continue
      }
      pointAlong(s, _at)
      // Grow in at the start, shrink away at the goal.
      const grow = Math.min(1, (s - start) / SPACING, (end - s) / SPACING)
      const size = 0.35 + 0.65 * Math.max(0, grow)
      _dummy.position.set(_at.x, TRAIL_Y, _at.z)
      _dummy.rotation.set(0, _at.yaw, 0)
      _dummy.scale.set(size, 1, size)
      _dummy.updateMatrix()
      trail.setMatrixAt(i, _dummy.matrix)
    }
    trail.instanceMatrix.needsUpdate = true

    // The arrow over the player points a few metres down the route.
    const arrow = arrowRef.current
    arrow.visible = ready
    if (ready) {
      pointAlong(Math.min(route.length, start + 2.5), _at)
      arrow.position.set(player.x, player.y + 2.1 + Math.sin(t * 4) * 0.14, player.z)
      arrow.rotation.set(0, Math.atan2(_at.x - player.x, _at.z - player.z), 0)
    }
  })

  if (!active) return null
  return (
    <group ref={groupRef}>
      <mesh ref={beamRef} geometry={geo.beam} material={mat.beam} renderOrder={2} />
      <mesh ref={ringRef} geometry={geo.ring} material={mat.ring} renderOrder={2} />
      <mesh ref={arrowRef} geometry={geo.arrow} material={mat.arrow} />
      <mesh ref={markerRef} geometry={geo.marker} material={mat.arrow} />
      <instancedMesh ref={trailRef} args={[geo.chevron, mat.trail, ARROWS]} frustumCulled={false} />
    </group>
  )
}

export default Guide
