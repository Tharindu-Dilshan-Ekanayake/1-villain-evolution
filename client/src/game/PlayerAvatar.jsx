import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Box3, Mesh, MeshLambertMaterial, Vector3 } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import {
  assetUrls,
  isRealId,
  PART_SLOTS,
  skinCompositeUrl,
  skinIdOrDefault,
} from '../bloxity/avatarAssets'
import { loadOBJ, loadPartGLB, loadTexture } from '../bloxity/avatarLoader'
import { useBloxity } from '../bloxity/BloxityContext'
import { preloadBaseBody, useBaseBody } from '../bloxity/useBaseBody'
import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import { GEAR_BONES, getGear } from '../characters/accessories'
import { getVillainTexture } from '../characters/skins'
import { softModeFor } from '../characters/softBody'
import { VILLAIN_BY_ID } from '../state/content'
import { useGameStore } from '../state/gameStore'
import { events, player, playerFx, trainer } from '../state/runtime'
import {
  animateRig,
  applyPart,
  applyProportions,
  applySkin,
  attachAccessory,
  collectRig,
  createAnimState,
  DEFAULT_STYLE,
  isPosing,
  triggerPowerUp,
  triggerSlam,
  triggerTaunt,
} from './avatarRig'
import { usePreset } from './quality'

/** Seconds standing still before a villain taunts (plus up to 5 more at random). */
const IDLE_TAUNT_S = 6

/** One material for all villain gear: it's vertex-coloured, so one fits all. */
const GEAR_MATERIAL = new MeshLambertMaterial({ vertexColors: true })

/** Every asset URL an equipped payload resolves to, as one comparable string. */
function assetKey(equipped) {
  const urls = [skinCompositeUrl(equipped) || assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId))]
  for (const [slot, cfg] of Object.entries(PART_SLOTS)) {
    const id = equipped?.[cfg.idKey]
    if (isRealId(id)) urls.push(assetUrls.part(slot, id))
  }
  for (const [idKey, meshUrl] of [
    ['hatId', assetUrls.hatMesh],
    ['backId', assetUrls.backMesh],
  ]) {
    const id = equipped?.[idKey]
    if (isRealId(id)) urls.push(meshUrl(id))
  }
  return urls.join('|')
}

/**
 * Keeps the avatar breathing when it is rendered outside the game (a menu preview,
 * say) with no physics body feeding it motion.
 */
const _idleMotion = { time: 0, speed: 0, grounded: true, maxSpeed: 6, vy: 0 }
function fallbackMotion(delta) {
  _idleMotion.time += delta
  return _idleMotion
}

/**
 * The player's character, assembled at runtime.
 *
 * It starts as the player's own Bloxity avatar: `player.glb` is the base rig (six
 * skinned meshes sharing one skeleton) and every equipped cosmetic is applied per
 * slot - body parts swap geometry, hats / back items hang off bones, the skin is one
 * texture. Becoming a villain swaps in that villain's painted skin and gear on the
 * very same rig, so every villain shares the player's animations.
 *
 * @param {{ onReady?: () => void, targetHeight?: number, motionRef?: object }} props
 *   `targetHeight` is the world-space height to fit the avatar into. Bloxity authors
 *   the rig ~6.4 units tall, so the model is measured and rescaled.
 */
export const PlayerAvatar = forwardRef(function PlayerAvatar(
  { onReady, targetHeight = 1.8, motionRef, ...props },
  ref,
) {
  const { avatar: equipped, proportions, game } = useBloxity()
  const morphId = useGameStore((s) => s.villain)
  const { scene: baseScene } = useBaseBody()
  const [assembled, setAssembled] = useState(false)

  // The GLTF cache hands back one shared scene. Clone via SkeletonUtils so this
  // instance gets an independent, still-working skeleton.
  const character = useMemo(() => cloneSkeleton(baseScene), [baseScene])

  // Rig lookup tables (bones, part meshes, pristine geometries) built once per clone,
  // with the body rounded off: fully round on MEDIUM / HIGH, bevelled on LOW.
  const softMode = softModeFor(usePreset().name)
  const rig = useMemo(() => {
    const collected = collectRig(character, softMode)

    // The base body ships with an empty texture; give every skinned mesh its own
    // material instance so a skin swap here can't leak into another avatar.
    for (const mesh of collected.skinnedMeshes) {
      mesh.material = new MeshLambertMaterial({ color: 0xffffff })
    }

    if (!collected.skeleton) {
      console.warn('[bloxity] player.glb has no skeleton - avatar will not deform')
    }
    return collected
  }, [character, softMode])

  // Dispose the per-instance materials when the avatar goes away.
  useEffect(
    () => () => {
      for (const mesh of rig.skinnedMeshes) mesh.material?.dispose()
    },
    [rig],
  )

  // Measured once, from the bind pose, before proportions touch the root scale.
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(character)
    const size = box.getSize(new Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return { scale: 1, footOffset: 0 }
    const scale = targetHeight / size.y
    // The rig's feet sit at its bbox minimum; drop the group so they land on y=0
    // of the parent (which Player positions at the bottom of the capsule).
    return { scale, footOffset: -box.min.y * scale }
  }, [character, targetHeight])

  // --- Assemble: Bloxity cosmetics, or a villain -------------------------------
  // Keyed on the asset URLs the payload resolves to, not the payload object: the SDK
  // re-emits an identical (or, for a guest, equivalent default) payload once it loads,
  // and rebuilding the same avatar again would stall the first seconds of play.
  const equippedKey = useMemo(() => assetKey(equipped), [equipped])
  const equippedRef = useRef(equipped)
  equippedRef.current = equipped

  useEffect(() => {
    const equipped = equippedRef.current
    performance.mark('villain:avatar-assembly-start')
    let cancelled = false
    // Accessories are re-attached on every rebuild; track them so the previous
    // hat/back can be removed rather than stacking up.
    const attached = []
    const isVillain = morphId && morphId !== 'bloxity'

    if (isVillain) {
      applySkin(rig, getVillainTexture(morphId))
      for (const slot of Object.keys(PART_SLOTS)) applyPart(rig, slot, null)
      const gear = getGear(morphId)
      for (const [slot, boneName] of Object.entries(GEAR_BONES)) {
        const bone = rig.bones[boneName]?.bone
        if (!gear[slot] || !bone) continue
        const mesh = new Mesh(gear[slot], GEAR_MATERIAL)
        mesh.castShadow = true
        bone.add(mesh)
        attached.push(mesh)
      }
      // Villains are local and instant; no network wait.
      queueMicrotask(() => !cancelled && setAssembled(true))
      return () => {
        cancelled = true
        // Gear geometry is cached and shared; only detach it.
        for (const object of attached) object.parent?.remove(object)
      }
    }

    game.loadingStep('Loading avatar…')

    const jobs = []

    // Skin always loads - "0" is the fallback, since the base body has no baked map.
    // With a face, shirt or pants worn it's the server-composited version; if that
    // can't be fetched, the bare skin is better than an untextured body.
    const compositeUrl = skinCompositeUrl(equipped)
    const plainSkinUrl = assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId))
    jobs.push(
      (compositeUrl ? loadTexture(compositeUrl) : Promise.resolve(null))
        .then((texture) => texture || loadTexture(plainSkinUrl))
        .then((texture) => ({ kind: 'skin', texture })),
    )

    // Body parts: fetch only real ids; a missing slot resets to the base geometry.
    for (const [slot, cfg] of Object.entries(PART_SLOTS)) {
      const id = equipped?.[cfg.idKey]
      if (!isRealId(id)) {
        jobs.push(Promise.resolve({ kind: 'part', slot, scene: null }))
        continue
      }
      jobs.push(
        loadPartGLB(assetUrls.part(slot, id)).then((scene) => ({
          kind: 'part',
          slot,
          scene,
        })),
      )
    }

    // Accessories.
    for (const [kind, idKey, meshUrl, texUrl] of [
      ['hat', 'hatId', assetUrls.hatMesh, assetUrls.hatTexture],
      ['back', 'backId', assetUrls.backMesh, assetUrls.backTexture],
    ]) {
      const id = equipped?.[idKey]
      if (!isRealId(id)) continue
      jobs.push(
        Promise.all([loadOBJ(meshUrl(id)), loadTexture(texUrl(id))]).then(
          ([object, texture]) => ({ kind: 'accessory', accessory: kind, object, texture }),
        ),
      )
    }

    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return

        for (const result of results) {
          // One bad slot must not take the rest of the character down.
          try {
            if (result.kind === 'skin') {
              applySkin(rig, result.texture)
            } else if (result.kind === 'part') {
              applyPart(rig, result.slot, result.scene)
            } else if (result.kind === 'accessory' && result.object) {
              if (result.texture) {
                result.object.traverse((child) => {
                  if (child.isMesh) {
                    child.material = new MeshLambertMaterial({ map: result.texture })
                  }
                })
              }
              const added = attachAccessory(rig, result.accessory, result.object)
              if (added) attached.push(added)
            }
          } catch (err) {
            console.warn(`[bloxity] failed to apply ${result.kind}`, err)
          }
        }

        setAssembled(true)
      })
      .catch((err) => {
        console.warn('[bloxity] avatar assembly failed; showing base body', err)
        if (!cancelled) setAssembled(true)
      })

    return () => {
      cancelled = true
      for (const object of attached) {
        object.parent?.remove(object)
        object.traverse((child) => {
          child.geometry?.dispose()
          child.material?.dispose?.()
        })
      }
    }
  }, [rig, equippedKey, game, morphId])

  // --- Proportions + animation --------------------------------------------------
  // Applied per frame: every bone is reset to its rest pose and re-scaled each pass,
  // which keeps it idempotent; the pose layers are then rotated on top.
  const proportionsRef = useRef(proportions)
  proportionsRef.current = morphId && morphId !== 'bloxity' ? DEFAULT_PROPORTIONS : proportions

  const anim = useMemo(() => createAnimState(), [])
  // How this villain moves: stance, run and taunt.
  const styleRef = useRef(DEFAULT_STYLE)
  styleRef.current = VILLAIN_BY_ID[morphId]?.anim || DEFAULT_STYLE
  /** Seconds standing still; a villain taunts after a while. */
  const idle = useRef({ for: 0, next: IDLE_TAUNT_S })
  /** Set by the 'transform' event, played on the next frame. */
  const powerUp = useRef(false)
  useEffect(() => {
    if (!motionRef) return undefined
    return events.on('transform', () => {
      powerUp.current = true
    })
  }, [motionRef])
  const seen = useRef({ slam: playerFx.slamSerial, victory: playerFx.victorySerial, flex: playerFx.flexSerial })

  useFrame((_state, delta) => {
    const motion = motionRef?.current ?? fallbackMotion(delta)
    motion.style = styleRef.current
    const s = seen.current
    if (motionRef) {
      if (powerUp.current) {
        powerUp.current = false
        triggerPowerUp(anim, motion.time, styleRef.current)
        idle.current.for = 0
      }
      // Standing around: taunt now and then.
      const resting = motion.speed < 0.3 && motion.grounded && !player.training
      idle.current.for = resting ? idle.current.for + Math.min(delta, 0.1) : 0
      if (idle.current.for > idle.current.next && !isPosing(anim, motion.time)) {
        idle.current.for = 0
        idle.current.next = IDLE_TAUNT_S + Math.random() * 5
        const kind = styleRef.current.taunt
        triggerTaunt(anim, motion.time, kind)
        events.emit('taunt', { kind, gender: VILLAIN_BY_ID[useGameStore.getState().villain]?.gender || 'm' })
      }
      if (playerFx.slamSerial !== s.slam) {
        s.slam = playerFx.slamSerial
        triggerSlam(anim, motion.time, playerFx.slamBroke)
      }
      if (playerFx.victorySerial !== s.victory) {
        s.victory = playerFx.victorySerial
        anim.victoryStart = motion.time
      }
      if (playerFx.flexSerial !== s.flex) {
        s.flex = playerFx.flexSerial
        anim.flexStart = motion.time
      }
    }
    try {
      applyProportions(rig, proportionsRef.current)
      const stepped = animateRig(rig, motion, anim, Math.min(delta, 0.1))
      if (stepped && motionRef) {
        // Counted here, paid out as Speed by the 10 Hz gameplay tick.
        trainer.steps += 1
        events.emit('step')
      }
    } catch {
      // A malformed payload must not kill the render loop.
    }
  })

  // Signal readiness only once the model is actually standing there.
  useEffect(() => {
    if (assembled) onReady?.()
  }, [assembled, onReady])

  return (
    <group ref={ref} {...props}>
      {/* Fit scale lives on this wrapper, not on `character` - applyProportions
          overwrites the character's own scale every frame. */}
      {/* Hidden until assembled: drawing the bare rig first would compile a shader
          variant without the skin texture, stalling a frame for nothing. */}
      <group scale={fit.scale} position={[0, fit.footOffset, 0]} visible={assembled}>
        <primitive object={character} />
      </group>
    </group>
  )
})

preloadBaseBody()

export default PlayerAvatar
