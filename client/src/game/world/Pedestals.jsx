import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, MeshBasicMaterial, MeshLambertMaterial, Object3D } from 'three'

import { useBaseBody } from '../../bloxity/useBaseBody'
import { buildStatueGeometry } from '../../characters/statues'
import { buildStatueAtlas } from '../../characters/skins'
import { VILLAIN_BY_ID } from '../../state/content'
import { canAffordVillain, formatNumber } from '../../state/economy'
import { useGameStore } from '../../state/gameStore'
import { createEffectColumnGeometry, createEffectColumnMaterial, setEffectInstance } from '../fx/effectColumn'
import { createLabel, escapeHtml } from '../labels'
import { PEDESTAL_PAD, PEDESTALS } from '../layout'
import { useColliders } from '../physics'
import { usePreset } from '../quality'
import { icon } from '../../ui/icons'
import { cyl, merge } from './kit'
import { setUniform } from './materials'

const STATUE_HEIGHT = 2.6
/** Statues stand on a podium on the back half of their pad, away from the path. */
const STATUE_INSET = 0.55
const PODIUM_RADIUS = 0.7
const PODIUM_HEIGHT = 0.42
const PAD_TOP = 0.14

const PAD_COLORS = {
  equipped: new Color('#ffd23f'),
  owned: new Color('#41e05a'),
  affordable: new Color('#3fd0f2'),
  locked: new Color('#ff4d6d'),
}

/** Idle life: each statue turns a little either way and breathes (radians, share). */
const SWAY_ANGLE = 0.16
const SWAY_RATE = 0.7
const BREATH = 0.014
const BREATH_RATE = 2.1

/**
 * Statue material: the atlas skins, plus a soft rim of light in each villain's own
 * colour (per-vertex `aRim`), so the statues stand out like highlighted models. The
 * vertex shader keeps them alive: a slow look either way and a breath, each statue
 * on its own phase (`aStatue`), all in the one draw call. Drive `uTime`.
 */
function createStatueMaterial(map) {
  const material = new MeshLambertMaterial({ map, vertexColors: true })
  const uniforms = { uTime: { value: 0 } }
  material.userData.uniforms = uniforms
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRim;
        attribute vec3 aStatue;
        uniform float uTime;
        varying vec3 vRim;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float swayA = sin(uTime * ${SWAY_RATE.toFixed(2)} + aStatue.z) * ${SWAY_ANGLE.toFixed(3)};
        float swayC = cos(swayA);
        float swayS = sin(swayA);
        objectNormal.xz = vec2(swayC * objectNormal.x + swayS * objectNormal.z, -swayS * objectNormal.x + swayC * objectNormal.z);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRim = aRim;
        vec2 fromCentre = transformed.xz - aStatue.xy;
        transformed.xz = aStatue.xy + vec2(swayC * fromCentre.x + swayS * fromCentre.y, -swayS * fromCentre.x + swayC * fromCentre.y);
        transformed.y *= 1.0 + sin(uTime * ${BREATH_RATE.toFixed(2)} + aStatue.z) * ${BREATH.toFixed(3)};`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        totalEmissiveRadiance += vRim * pow(rim, 2.6) * 0.75;`,
      )
  }
  material.customProgramCacheKey = () => 'villain-statue-rim'
  return material
}

/**
 * A round plinth with the statue's podium on its back half (local +X): darker rims,
 * bright tops, all tinted by the pad's state colour.
 */
function buildPadGeometry() {
  const r = PEDESTAL_PAD / 2
  const y = PAD_TOP + PODIUM_HEIGHT / 2 - 0.07
  return merge([
    cyl(r, r + 0.08, 0.14, 28, '#7a7a86', { pos: [0, 0, 0] }),
    cyl(r - 0.22, r - 0.22, 0.03, 28, '#ffffff', { pos: [0, 0.08, 0] }),
    cyl(PODIUM_RADIUS, PODIUM_RADIUS + 0.06, PODIUM_HEIGHT, 24, '#5d5872', { pos: [STATUE_INSET, y, 0] }),
    cyl(PODIUM_RADIUS - 0.12, PODIUM_RADIUS - 0.12, 0.03, 24, '#ffffff', { pos: [STATUE_INSET, y + PODIUM_HEIGHT / 2, 0] }),
  ])
}

/** Where the statue stands: the back of its pad, behind the way it faces. */
function statueSpot(ped) {
  return { x: ped.x - Math.sin(ped.facing) * STATUE_INSET, z: ped.z - Math.cos(ped.facing) * STATUE_INSET }
}

function padState(id, s) {
  if (s.villain === id) return 'equipped'
  if (s.ownedVillains.includes(id)) return 'owned'
  return canAffordVillain(s, id) ? 'affordable' : 'locked'
}

function priceText(villain) {
  if (villain.cost.rp) return `${icon('rebirth')} ${villain.cost.rp} Rebirth Point${villain.cost.rp === 1 ? '' : 's'}`
  return `${icon('trophy')} ${formatNumber(villain.cost.wins || 0)} Win${villain.cost.wins === 1 ? '' : 's'}`
}

/**
 * Price (or Owned / Equipped) over the name over the bonus, like a shop shelf; the
 * label sits right above its statue and shrinks with distance.
 */
function labelHtml(villain, state) {
  let top
  if (state === 'equipped') top = `<div class="lbl-top equipped">${icon('star')} Equipped</div>`
  else if (state === 'owned') top = `<div class="lbl-top owned">${icon('check')} Owned</div>`
  else top = `<div class="lbl-top ${state}">${priceText(villain)}</div>`
  return `${top}<div class="lbl-name">${escapeHtml(villain.name)}</div><div class="lbl-gain">+${formatNumber(
    villain.perStep,
  )} Speed / Step</div>`
}

const _dummy = new Object3D()

/**
 * The villain gallery on the right of the lobby. Statues of all the villains are one merged
 * mesh; pads and the villains' effect columns (each villain's own colour and style:
 * fire, electric, swirl or glow) are one instanced mesh each.
 */
export function Pedestals() {
  const preset = usePreset()
  const { scene: baseScene } = useBaseBody()
  const statuesRef = useRef(null)
  const padsRef = useRef(null)
  const fxRef = useRef(null)

  // 64 px cells on LOW keep the atlas at 512 px (the mobile texture budget).
  const atlasCell = preset.name === 'LOW' ? 64 : 128
  const atlas = useMemo(() => buildStatueAtlas(atlasCell), [atlasCell])
  const statues = useMemo(
    () =>
      buildStatueGeometry({
        baseScene,
        statues: PEDESTALS.map((p) => ({ id: p.id, ...statueSpot(p), y: PAD_TOP + PODIUM_HEIGHT - 0.04, facing: p.facing })),
        atlas,
        height: STATUE_HEIGHT,
      }),
    [baseScene, atlas],
  )
  const statueMaterial = useMemo(() => createStatueMaterial(atlas.texture), [atlas])

  const padGeometry = useMemo(() => buildPadGeometry(), [])
  const padMaterial = useMemo(() => new MeshBasicMaterial({ vertexColors: true }), [])
  const fxGeometry = useMemo(() => createEffectColumnGeometry(PEDESTALS.length, PEDESTAL_PAD * 0.55), [])
  const fxMaterial = useMemo(() => createEffectColumnMaterial(), [])

  useEffect(
    () => () => {
      statues.dispose()
      atlas.texture.dispose()
      statueMaterial.dispose()
      padGeometry.dispose()
      padMaterial.dispose()
      fxGeometry.dispose()
      fxMaterial.dispose()
    },
    [statues, atlas, statueMaterial, padGeometry, padMaterial, fxGeometry, fxMaterial],
  )

  // Static instance transforms.
  useLayoutEffect(() => {
    PEDESTALS.forEach((ped, i) => {
      _dummy.position.set(ped.x, 0.07, ped.z)
      // The podium is on the pad's local +X: turn it to sit behind the statue.
      _dummy.rotation.set(0, ped.facing + Math.PI / 2, 0)
      _dummy.scale.set(1, 1, 1)
      _dummy.updateMatrix()
      padsRef.current?.setMatrixAt(i, _dummy.matrix)
      _dummy.position.set(ped.x, 2.1, ped.z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(1, 4.2, 1)
      _dummy.updateMatrix()
      fxRef.current?.setMatrixAt(i, _dummy.matrix)
    })
    if (padsRef.current) {
      padsRef.current.instanceMatrix.needsUpdate = true
      padsRef.current.computeBoundingSphere()
    }
    if (fxRef.current) {
      fxRef.current.instanceMatrix.needsUpdate = true
      fxRef.current.computeBoundingSphere()
    }
  }, [preset.name])

  // Pad colours and labels follow ownership / affordability, updated on store change.
  useEffect(() => {
    const labels = PEDESTALS.map((ped) =>
      createLabel({
        position: [ped.x, STATUE_HEIGHT + PODIUM_HEIGHT + 0.8, ped.z],
        className: 'pedestal-label',
        // Only the nearby ones: down a row of statues, farther labels would pile up.
        lobby: true,
        maxDistance: 24,
        refDistance: 12,
        minScale: 0.42,
        maxScale: 1,
      }),
    )
    let lastKey = ''
    const update = (s) => {
      const states = PEDESTALS.map((ped) => padState(ped.id, s))
      const key = states.join('|')
      if (key === lastKey) return
      lastKey = key
      PEDESTALS.forEach((ped, i) => {
        labels[i].setHtml(labelHtml(VILLAIN_BY_ID[ped.id], states[i]))
        padsRef.current?.setColorAt(i, PAD_COLORS[states[i]])
        // Each villain's own effect: full strength when equipped, softer when owned or
        // affordable, faint while locked.
        const fx = VILLAIN_BY_ID[ped.id].fx
        const strength = { equipped: 1.25, owned: 0.85, affordable: 0.8, locked: 0.4 }[states[i]]
        setEffectInstance(fxGeometry, i, { ...fx, strength })
      })
      if (padsRef.current?.instanceColor) padsRef.current.instanceColor.needsUpdate = true
    }
    update(useGameStore.getState())
    const unsubscribe = useGameStore.subscribe(update)
    return () => {
      unsubscribe()
      labels.forEach((l) => l.remove())
    }
  }, [fxGeometry])

  useFrame((state) => {
    // LOW: a plain glow column; the fire / electric / swirl shading is skipped.
    const material = fxRef.current?.material
    setUniform(material, 'uSimple', preset.name === 'LOW' ? 1 : 0)
    setUniform(material, 'uTime', state.clock.elapsedTime)
    const statueUniforms = statuesRef.current?.material.userData.uniforms
    if (statueUniforms) statueUniforms.uTime.value = state.clock.elapsedTime
  })

  useColliders(
    () =>
      PEDESTALS.map((ped) => {
        const s = statueSpot(ped)
        return { circle: [s.x, s.z, PODIUM_RADIUS] }
      }),
    [],
  )

  return (
    <>
      <mesh ref={statuesRef} geometry={statues} material={statueMaterial} castShadow receiveShadow />
      <instancedMesh ref={padsRef} args={[padGeometry, padMaterial, PEDESTALS.length]} />
      <instancedMesh ref={fxRef} args={[fxGeometry, fxMaterial, PEDESTALS.length]} renderOrder={2} />
    </>
  )
}

export default Pedestals
