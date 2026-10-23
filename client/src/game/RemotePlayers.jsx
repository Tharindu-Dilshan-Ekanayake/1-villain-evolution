import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Box3, Mesh, MeshLambertMaterial, SkinnedMesh, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { assetUrls } from '../bloxity/avatarAssets'
import { loadTexture } from '../bloxity/avatarLoader'
import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import { useBaseBody } from '../bloxity/useBaseBody'
import { GEAR_BONES, getGear } from '../characters/accessories'
import { getVillainTexture } from '../characters/skins'
import { softModeFor } from '../characters/softBody'
import { remotes, useNetStore } from '../net/netStore'
import { VILLAIN_BY_ID } from '../state/content'
import {
  animateRig,
  applyProportions,
  collectRig,
  createAnimState,
  DEFAULT_STYLE,
  isPosing,
  triggerPowerUp,
  triggerSlam,
  triggerTaunt,
} from './avatarRig'
import { spawnImpact, spawnSlam } from './fx/impactPool'
import { createTrailEmitter, stepTrail } from './fx/trailPool'
import VillainAura from './fx/VillainAura'
import { createLabel, escapeHtml } from './labels'
import { remoteHandles } from './remoteHandles'
import { getPreset, usePreset } from './quality'

const HEIGHT = 1.8
/** Shared by every remote player's gear: it is vertex-coloured. */
const GEAR_MATERIAL = new MeshLambertMaterial({ vertexColors: true })
const DEFAULT_SKIN = assetUrls.skinTexture('0')

/** Further than this a remote player is far enough to animate at half rate. */
const NEAR = 25
/** A jump this large is a teleport (respawn): snap instead of sliding across the map. */
const SNAP_DISTANCE = 8

/**
 * Builds a remote player's body: the Bloxity rig with its six skinned parts merged
 * into ONE skinned mesh sharing the skeleton, so each remote costs a single draw call
 * (plus one for their villain's gear).
 */
function buildBody(baseScene, softMode) {
  const character = cloneSkeleton(baseScene)
  const rig = collectRig(character, softMode)
  const parts = rig.skinnedMeshes
  const material = new MeshLambertMaterial({ color: 0xffffff })
  let body = null
  // Rounded parts are non-indexed; any part left as it was is flattened to match.
  const geometry =
    parts.length > 0 && rig.skeleton
      ? mergeGeometries(
          parts.map((m) => (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry)),
          false,
        )
      : null
  if (geometry) {
    body = new SkinnedMesh(geometry, material)
    body.name = 'remote-body'
    body.bind(rig.skeleton, parts[0].bindMatrix)
    for (const part of parts) part.parent?.remove(part)
    character.add(body)
  }
  const box = new Box3().setFromObject(character)
  const size = box.getSize(new Vector3())
  const scale = size.y > 0 ? HEIGHT / size.y : 1
  return { character, rig, body, material, scale, footOffset: -box.min.y * scale }
}

/** Puts a skin texture on a remote body's material. */
function setSkin(material, texture) {
  material.map = texture
  material.needsUpdate = true
}

/** The name tag over another player: just their name. */
const nameplateHtml = (name) => `<div class="np-name">@${escapeHtml(name || 'Guest')}</div>`

/** Handles the shared frame loop needs, by session id (shared with the pets renderer). */
const handles = remoteHandles
/** Other players leave trail marks only this close to the camera (LOW: closer). */
const TRAIL_DISTANCE = 35
const TRAIL_DISTANCE_LOW = 20

function RemotePlayer({ id }) {
  const profile = useNetStore((s) => s.players[id])
  const preset = usePreset()
  const { scene: baseScene } = useBaseBody()
  const rootRef = useRef(null)

  // Rounded on MEDIUM / HIGH, bevelled on LOW (as the preset stood when they joined).
  const built = useMemo(() => buildBody(baseScene, softModeFor(getPreset().name)), [baseScene])
  useEffect(
    () => () => {
      built.body?.geometry.dispose()
      built.material.dispose()
    },
    [built],
  )

  // Skin: a villain's painted skin, or the player's own Bloxity skin.
  const morph = profile?.morph || 'bloxity'
  const skinUrl = profile?.skin || DEFAULT_SKIN
  useEffect(() => {
    let cancelled = false
    const apply = (texture) => {
      if (!cancelled && texture) setSkin(built.material, texture)
    }
    if (morph !== 'bloxity') apply(getVillainTexture(morph))
    else loadTexture(skinUrl).then((t) => (t ? apply(t) : loadTexture(DEFAULT_SKIN).then(apply)))
    return () => {
      cancelled = true
    }
  }, [built, morph, skinUrl])

  // Villain gear on the bones.
  useEffect(() => {
    if (morph === 'bloxity') return undefined
    const gear = getGear(morph)
    const attached = []
    for (const [slot, boneName] of Object.entries(GEAR_BONES)) {
      const bone = built.rig.bones[boneName]?.bone
      if (!gear[slot] || !bone) continue
      const mesh = new Mesh(gear[slot], GEAR_MATERIAL)
      bone.add(mesh)
      attached.push(mesh)
    }
    return () => attached.forEach((m) => m.parent?.remove(m))
  }, [built, morph])

  // Nameplate.
  const labelRef = useRef(null)
  useEffect(() => {
    const label = createLabel({
      className: 'nameplate',
      maxDistance: 45,
      refDistance: 9,
      minScale: 0.5,
      maxScale: 1,
      follow: () => {
        const h = handles.get(id)
        return h ? [h.x, h.y + HEIGHT + 0.6, h.z] : null
      },
    })
    labelRef.current = label
    return () => {
      label.remove()
      labelRef.current = null
    }
  }, [id])
  const name = profile?.name
  useEffect(() => {
    labelRef.current?.setHtml(nameplateHtml(name))
  }, [name])

  // Register for the shared frame loop.
  useEffect(() => {
    const r = remotes.get(id)
    handles.set(id, {
      root: rootRef.current,
      rig: built.rig,
      anim: createAnimState(),
      motion: { time: 0, speed: 0, grounded: true, maxSpeed: 12, vy: 0 },
      x: r?.x ?? 0,
      z: r?.z ?? 0,
      y: r?.y ?? 0,
      yaw: r?.yaw ?? 0,
      speed: 0,
      slamSeen: r?.slam ?? 0,
      frame: 0,
      trail: createTrailEmitter(),
      morph: null,
      pets: [],
      idleFor: 0,
      idleNext: 6 + Math.random() * 6,
      spin: 10,
    })
    return () => {
      handles.delete(id)
    }
  }, [id, built])
  // The villain decides the trail style; the frame loop reads it from the handle.
  const morphId = profile?.morph || 'bloxity'
  const petList = profile?.pets || ''
  useEffect(() => {
    const h = handles.get(id)
    if (h) {
      // A new villain (not the first look we hear about): power up, with a burst.
      if (h.morph && h.morph !== morphId) {
        triggerPowerUp(h.anim, h.motion.time, VILLAIN_BY_ID[morphId]?.anim)
        h.spin = 0
        const v = VILLAIN_BY_ID[morphId]
        const color = v?.aura?.color || v?.fx?.color || '#ffffff'
        spawnImpact(h.x, 0.06, h.z, 7, color, true)
        spawnImpact(h.x, 1.1, h.z, 4, color, true)
      }
      h.morph = morphId
      h.motion.style = VILLAIN_BY_ID[morphId]?.anim || DEFAULT_STYLE
      h.pets = petList ? petList.split(',').slice(0, 3) : []
    }
  }, [id, built, morphId, petList])

  return (
    <group ref={rootRef}>
      <group scale={built.scale} position={[0, built.footOffset, 0]}>
        <primitive object={built.character} />
      </group>
      {preset.name !== 'LOW' && <VillainAura height={HEIGHT} villainId={morph} remote />}
    </group>
  )
}

const angleLerp = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Everyone else in the lobby. One frame loop smooths and animates all of them:
 * positions ease towards the latest network update (no stutter between the 20 Hz
 * patches), far players animate at half rate, and anyone past the view distance
 * isn't drawn or animated at all.
 */
export function RemotePlayers() {
  // The players object only changes identity when someone joins, leaves or restyles.
  const players = useNetStore((s) => s.players)
  const ids = Object.keys(players)
  const preset = usePreset()
  const cullDistance = preset.viewDistance * 0.5
  const trailDistance = preset.name === 'LOW' ? TRAIL_DISTANCE_LOW : TRAIL_DISTANCE

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const k = 1 - Math.exp(-dt * 12)
    const cam = state.camera.position
    for (const [id, h] of handles) {
      const r = remotes.get(id)
      if (!r || !h.root) continue
      if (Math.hypot(r.x - h.x, r.z - h.z) > SNAP_DISTANCE) {
        h.x = r.x
        h.z = r.z
      } else {
        h.x += (r.x - h.x) * k
        h.z += (r.z - h.z) * k
      }
      const vy = (r.y - h.y) / Math.max(dt, 1e-3)
      h.y += (r.y - h.y) * k
      h.yaw = angleLerp(h.yaw, r.yaw, k)
      h.speed += (r.speed - h.speed) * k

      const dist = Math.hypot(h.x - cam.x, h.z - cam.z)
      const visible = dist < cullDistance
      if (h.root.visible !== visible) h.root.visible = visible
      if (!visible) continue
      if (dist < trailDistance) stepTrail(h.trail, h.x, h.z, h.speed, h.y < 0.05, h.morph)
      h.root.position.set(h.x, h.y, h.z)
      if (h.spin < 0.85) h.spin += dt
      h.root.rotation.y = h.yaw + (h.spin < 0.85 ? (1 - (1 - h.spin / 0.85) ** 3) * Math.PI * 4 : 0)

      const motion = h.motion
      motion.time += dt
      motion.speed = h.speed
      motion.grounded = h.y < 0.05
      motion.vy = vy
      if (r.slam !== h.slamSeen) {
        h.slamSeen = r.slam
        const broke = r.slamKind === 1
        triggerSlam(h.anim, motion.time, broke)
        // Everyone sees the shockwave of their slam, in their villain's colour.
        const v = VILLAIN_BY_ID[h.morph]
        spawnSlam(h.x, h.z, broke, v?.aura?.color || v?.fx?.color || '#ffffff')
      }
      // Standing around: they taunt now and then too.
      h.idleFor = h.speed < 0.3 && motion.grounded ? h.idleFor + dt : 0
      if (h.idleFor > h.idleNext && !isPosing(h.anim, motion.time)) {
        h.idleFor = 0
        h.idleNext = 7 + Math.random() * 6
        triggerTaunt(h.anim, motion.time, (motion.style || DEFAULT_STYLE).taunt)
      }
      h.frame += 1
      if (dist > NEAR && h.frame % 2 === 1) continue
      applyProportions(h.rig, DEFAULT_PROPORTIONS)
      animateRig(h.rig, motion, h.anim, dist > NEAR ? dt * 2 : dt)
    }
  })

  return (
    <Suspense fallback={null}>
      {ids.map((id) => (
        <RemotePlayer key={id} id={id} />
      ))}
    </Suspense>
  )
}

export default RemotePlayers
