import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BufferAttribute, Color, CylinderGeometry, IcosahedronGeometry, MeshBasicMaterial, MeshLambertMaterial, Object3D } from 'three'

import { EGG_BY_ID } from '../../state/content'
import { formatNumber } from '../../state/economy'
import { useGameStore } from '../../state/gameStore'
import { createEffectColumnGeometry, createEffectColumnMaterial, setEffectInstance } from '../fx/effectColumn'
import { createLabel, escapeHtml } from '../labels'
import { EGG_SPOTS } from '../layout'
import { useColliders } from '../physics'
import { usePreset } from '../quality'
import { icon } from '../../ui/icons'
import { cyl, merge, place } from './kit'
import { setUniform } from './materials'

const EGG_Y = 2.55
const N = EGG_SPOTS.length

const _dummy = new Object3D()
const _color = new Color()
const _a = new Color()
const _b = new Color()

/** Cheap 3D value noise for the egg spots. */
function spotNoise(x, y, z, seed) {
  const s = Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.7) * Math.sin(z * 3.3 + seed * 0.6)
  return s + 0.35 * Math.sin(x * 7.3 + y * 5.1 + seed)
}

/** An egg (about 2.4 m tall) with its colour and spots baked into vertex colours. */
function buildEgg(egg, seed) {
  const g = new IcosahedronGeometry(1, 3).toNonIndexed()
  const pos = g.getAttribute('position')
  // Egg-shaped: narrower at the top.
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i)
    const k = y > 0 ? 1 - y * 0.18 : 1
    pos.setXYZ(i, pos.getX(i) * 1.15 * k, y * 1.45, pos.getZ(i) * 1.15 * k)
  }
  g.computeVertexNormals()
  const colors = new Float32Array(pos.count * 3)
  _a.set(egg.color)
  _b.set(egg.spots)
  for (let i = 0; i < pos.count; i += 3) {
    // One colour per face, decided at the face centre: crisp low-poly spots.
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3
    if (egg.rainbow) {
      _color.setHSL((cy * 0.18 + 0.5 + Math.atan2(cz, cx) / (Math.PI * 2)) % 1, 0.85, 0.55)
      if (spotNoise(cx, cy, cz, seed) > 0.45) _color.copy(_b)
    } else {
      _color.copy(spotNoise(cx, cy, cz, seed) > 0.42 ? _b : _a)
    }
    for (let v = 0; v < 3; v += 1) {
      colors[(i + v) * 3] = _color.r
      colors[(i + v) * 3 + 1] = _color.g
      colors[(i + v) * 3 + 2] = _color.b
    }
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

/** Every egg and its stand, as one merged vertex-coloured geometry. */
function buildEggStands() {
  const parts = []
  EGG_SPOTS.forEach((spot, i) => {
    const egg = EGG_BY_ID[spot.id]
    parts.push(cyl(1.75, 1.95, 0.5, 20, '#ffffff', { pos: [spot.x, 0.25, spot.z] }))
    parts.push(cyl(1.45, 1.6, 0.35, 20, egg.spots, { pos: [spot.x, 0.67, spot.z] }))
    parts.push(cyl(0.7, 1.0, 0.6, 14, '#ffffff', { pos: [spot.x, 1.1, spot.z] }))
    parts.push(place(buildEgg(egg, 11 + i * 7), { pos: [spot.x, EGG_Y, spot.z] }))
  })
  return merge(parts)
}

function labelHtml(egg, wins) {
  const can = wins >= egg.cost
  return `<div class="lbl-name">${escapeHtml(egg.name)}</div><div class="lbl-top ${can ? 'affordable' : 'locked'}">${icon('trophy')} ${formatNumber(
    egg.cost,
  )}</div>`
}

/**
 * The egg stands in an arc behind spawn. Stand on the glowing pad in front of
 * an egg to hatch it (the prompt shows its pets and chances). Eggs and stands are one
 * mesh; the pads and their light columns are one instanced mesh each.
 */
export function Eggs() {
  const preset = usePreset()
  const padsRef = useRef(null)
  const fxRef = useRef(null)

  const geo = useMemo(
    () => ({
      stands: buildEggStands(),
      pad: new CylinderGeometry(1.25, 1.25, 0.1, 24),
      fx: createEffectColumnGeometry(N, 1.15),
    }),
    [],
  )
  const mat = useMemo(
    () => ({
      stands: new MeshLambertMaterial({ vertexColors: true }),
      pad: new MeshBasicMaterial({ color: '#ffffff' }),
      fx: createEffectColumnMaterial(),
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

  useLayoutEffect(() => {
    EGG_SPOTS.forEach((spot, i) => {
      const egg = EGG_BY_ID[spot.id]
      _dummy.position.set(spot.padX, 0.06, spot.padZ)
      _dummy.scale.set(1, 1, 1)
      _dummy.updateMatrix()
      padsRef.current?.setMatrixAt(i, _dummy.matrix)
      padsRef.current?.setColorAt(i, _color.set(egg.rainbow ? '#ffd23f' : egg.spots))
      _dummy.position.set(spot.padX, 1.5, spot.padZ)
      _dummy.scale.set(1, 3, 1)
      _dummy.updateMatrix()
      fxRef.current?.setMatrixAt(i, _dummy.matrix)
      setEffectInstance(geo.fx, i, { color: egg.rainbow ? '#ffd23f' : egg.spots, type: 'swirl', strength: 0.8 })
    })
    for (const ref of [padsRef, fxRef]) {
      const m = ref.current
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [geo, preset.name])

  useEffect(() => {
    const labels = EGG_SPOTS.map((spot) =>
      createLabel({
        position: [spot.x, EGG_Y + 2.1, spot.z],
        className: 'pedestal-label egg-label',
        lobby: true,
        maxDistance: 45,
        refDistance: 13,
        minScale: 0.42,
        maxScale: 1,
      }),
    )
    let lastKey = ''
    const update = (s) => {
      const key = EGG_SPOTS.map((spot) => s.wins >= EGG_BY_ID[spot.id].cost).join('|')
      if (key === lastKey) return
      lastKey = key
      EGG_SPOTS.forEach((spot, i) => labels[i].setHtml(labelHtml(EGG_BY_ID[spot.id], s.wins)))
    }
    update(useGameStore.getState())
    const unsubscribe = useGameStore.subscribe(update)
    return () => {
      unsubscribe()
      labels.forEach((l) => l.remove())
    }
  }, [])

  useFrame((state) => {
    setUniform(fxRef.current?.material, 'uSimple', preset.name === 'LOW' ? 1 : 0)
    setUniform(fxRef.current?.material, 'uTime', state.clock.elapsedTime)
  })

  useColliders(() => EGG_SPOTS.map((spot) => ({ circle: [spot.x, spot.z, 1.9] })), [])

  return (
    <>
      <mesh geometry={geo.stands} material={mat.stands} castShadow receiveShadow />
      <instancedMesh ref={padsRef} args={[geo.pad, mat.pad, N]} />
      <instancedMesh ref={fxRef} args={[geo.fx, mat.fx, N]} renderOrder={2} />
    </>
  )
}

export default Eggs
