import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Color, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry } from 'three'

import { formatNumber, padWins, STAGE_COUNT } from '../../state/economy'
import { useGameStore } from '../../state/gameStore'
import { events, player, stageRun } from '../../state/runtime'
import { createEffectColumnGeometry, createEffectColumnMaterial, setEffectInstance } from '../fx/effectColumn'
import { createLabel } from '../labels'
import {
  GATE_Z,
  PAD_SIZE,
  PATH_HALF,
  padX,
  padZ,
  STAGE_END_Z,
  stageAtZ,
  TRACK_HALF,
  TRACK_WALL_HEIGHT,
  WALL_HEIGHT,
  wallZ,
} from '../layout'
import { useColliders } from '../physics'
import { usePreset } from '../quality'
import { GROUND, PADS, PATH, STAGE_COLORS, TREES, WALLS } from '../sceneStyle'
import { createStudTexture, createWorldBoxGeometry } from '../textures'
import { box, merge, mulberry32 } from '../world/kit'
import { icon } from '../../ui/icons'
import { setUniform } from '../world/materials'
import { buildTrophy } from './trophy'

const LENGTH = GATE_Z - STAGE_END_Z
const MID_Z = (GATE_Z + STAGE_END_Z) / 2
const SIDE_X = TRACK_HALF + 1
/** World size of one ground texture repeat (4 x 4 studs of 0.5 units), as the template. */
const GROUND_TILE = 2
/** World size of one brick texture repeat, as the template's boundary walls. */
const WALL_TILE = 4
/**
 * Trophies drawn at once: they spin over the WINS pads of the stage you're in, the one
 * behind and the next six (~280 m ahead). A trophy is ~550 triangles, so all fifty
 * at once would cost ~27k; the pool moves along with you instead.
 */
const TROPHY_POOL = 8
const _hidden = new Object3D()
_hidden.scale.set(0, 0, 0)
_hidden.updateMatrix()

const _dummy = new Object3D()
const _color = new Color()

/** A strip of ground with UVs in world units (u across, v along the track). */
function strip(width, x, y) {
  const g = new PlaneGeometry(width, LENGTH).toNonIndexed()
  g.rotateX(-Math.PI / 2)
  g.translate(x, y, MID_Z)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, pos.getX(i) / GROUND_TILE, pos.getZ(i) / GROUND_TILE)
  return g
}

/** Stage-coloured pillars either side of every wall, with a cap above the brick. */
function buildPillars() {
  const parts = []
  for (let s = 0; s < STAGE_COUNT; s += 1) {
    const color = s === 0 ? '#ffffff' : STAGE_COLORS[(s - 1) % STAGE_COLORS.length]
    for (const side of [-1, 1]) {
      parts.push(box(1.5, WALL_HEIGHT + 1.6, 2.2, color, { pos: [side * (TRACK_HALF - 0.1), (WALL_HEIGHT + 1.6) / 2, wallZ(s)] }))
      parts.push(box(2.1, 0.6, 2.8, '#ffffff', { pos: [side * (TRACK_HALF - 0.1), WALL_HEIGHT + 1.9, wallZ(s)] }))
    }
  }
  return merge(parts)
}

/** One voxel tree: trunk and two leafy blocks, about 6 m tall. */
function buildTree() {
  return merge([
    box(0.9, 3.2, 0.9, TREES.trunk, { pos: [0, 1.6, 0] }),
    box(3.4, 2.4, 3.4, TREES.leaves[0], { pos: [0, 3.9, 0] }),
    box(2.3, 1.6, 2.3, TREES.leaves[1], { pos: [0, 5.6, 0] }),
  ])
}

/** Seeded tree spots on the grass beyond both track walls. */
function treeSpots() {
  const rand = mulberry32(31)
  const out = []
  for (let z = GATE_Z - 10; z > STAGE_END_Z; z -= 9) {
    for (const side of [-1, 1]) {
      if (rand() < 0.25) continue
      out.push({ x: side * (TRACK_HALF + 6 + rand() * 30), z: z + (rand() - 0.5) * 6, s: 0.8 + rand() * 0.6, r: rand() * Math.PI })
    }
  }
  return out
}

function padLabelHtml(s, state, claimed) {
  if (claimed) return `<div class="pad-free">WINS</div><div class="pad-claimed">Claimed ${icon('check')}</div>`
  return `<div class="pad-free">WINS</div><div class="pad-amount">${icon('trophy')} +${formatNumber(padWins(s, state))}</div>`
}

/**
 * The whole stage line: a long lime track with the red running path, the template's
 * tan brick walls down both sides, stage-coloured pillars marking every wall, and in
 * each stage a WINS pad in the left corner with its trophy spinning over it.
 *
 * Built as a handful of long meshes rather than per-stage pieces: fifty stages cost
 * the same ~9 draw calls as one, and fog hides whatever is beyond the view distance.
 * Only the trophies are pooled, following the player (they're the heavy part).
 * The breakable walls themselves are in Walls.jsx.
 */
export function StageLine() {
  const preset = usePreset()
  const texSize = Math.min(512, preset.textureSize)
  const padsRef = useRef(null)
  const trophyRef = useRef(null)
  const padFxRef = useRef(null)
  const treesRef = useRef(null)

  const textures = useMemo(
    () => ({
      ground: createStudTexture({ base: GROUND.base, alt: GROUND.alt, size: texSize }),
      path: createStudTexture({ base: PATH.base, alt: PATH.alt, size: texSize }),
      border: createStudTexture({ base: PATH.border, alt: PATH.borderAlt, size: Math.min(256, texSize) }),
      brick: createStudTexture({ base: WALLS.base, alt: WALLS.alt, studsPerCell: 4, size: texSize }),
    }),
    [texSize],
  )
  const trees = useMemo(() => (preset.name === 'LOW' ? [] : treeSpots()), [preset.name])

  const geo = useMemo(() => {
    const floor = createWorldBoxGeometry(TRACK_HALF * 2 + 4, 1, LENGTH, GROUND_TILE)
    floor.translate(0, -0.5, MID_Z)
    const walls = [-1, 1].map((side) => {
      const g = createWorldBoxGeometry(2, TRACK_WALL_HEIGHT, LENGTH + 2, WALL_TILE)
      g.translate(side * SIDE_X, TRACK_WALL_HEIGHT / 2, MID_Z)
      return g
    })
    const end = createWorldBoxGeometry(TRACK_HALF * 2 + 4, TRACK_WALL_HEIGHT, 2, WALL_TILE)
    end.translate(0, TRACK_WALL_HEIGHT / 2, STAGE_END_Z - 1)
    return {
      floor,
      walls: merge([...walls, end].map((g) => g.toNonIndexed())),
      path: strip(PATH_HALF * 2, 0, 0.015),
      borders: merge([strip(0.7, -PATH_HALF - 0.35, 0.016), strip(0.7, PATH_HALF + 0.35, 0.016)]),
      pillars: buildPillars(),
      pad: new BoxGeometry(PAD_SIZE, 0.22, PAD_SIZE),
      trophy: buildTrophy(),
      padFx: createEffectColumnGeometry(STAGE_COUNT, PAD_SIZE * 0.6),
      tree: buildTree(),
    }
  }, [])

  const mat = useMemo(
    () => ({
      floor: new MeshLambertMaterial({ map: textures.ground }),
      walls: new MeshLambertMaterial({ map: textures.brick }),
      path: new MeshLambertMaterial({ map: textures.path, polygonOffset: true, polygonOffsetFactor: -1 }),
      border: new MeshLambertMaterial({ map: textures.border, polygonOffset: true, polygonOffsetFactor: -2 }),
      vertex: new MeshLambertMaterial({ vertexColors: true }),
      pad: new MeshBasicMaterial({ color: '#ffffff' }),
      trophy: new MeshLambertMaterial({ vertexColors: true, emissive: '#5a3a00' }),
      padFx: createEffectColumnMaterial(),
    }),
    [textures],
  )
  useEffect(() => () => Object.values(geo).forEach((g) => g?.dispose()), [geo])
  useEffect(
    () => () => {
      Object.values(mat).forEach((m) => m.dispose())
      Object.values(textures).forEach((t) => t.dispose())
    },
    [mat, textures],
  )

  // Static instances: pads, their effect columns, trees.
  useLayoutEffect(() => {
    _color.set(PADS.ready)
    for (let s = 0; s < STAGE_COUNT; s += 1) {
      _dummy.position.set(padX(), 0.11, padZ(s))
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(1, 1, 1)
      _dummy.updateMatrix()
      padsRef.current?.setMatrixAt(s, _dummy.matrix)
      padsRef.current?.setColorAt(s, _color)
      _dummy.position.set(padX(), 2.4, padZ(s))
      _dummy.scale.set(1, 4.8, 1)
      _dummy.updateMatrix()
      padFxRef.current?.setMatrixAt(s, _dummy.matrix)
      setEffectInstance(geo.padFx, s, { color: '#ffd23f', type: 'swirl' })
    }
    trees.forEach((t, i) => {
      _dummy.position.set(t.x, 0, t.z)
      _dummy.rotation.set(0, t.r, 0)
      _dummy.scale.set(t.s, t.s, t.s)
      _dummy.updateMatrix()
      treesRef.current?.setMatrixAt(i, _dummy.matrix)
    })
    for (const ref of [padsRef, padFxRef, trophyRef, treesRef]) {
      const m = ref.current
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [geo, trees, preset.name])

  // Labels: a STAGE sign over every wall and the Wins on every pad.
  useEffect(() => {
    const signs = Array.from({ length: STAGE_COUNT }, (_, s) =>
      createLabel({
        position: [0, WALL_HEIGHT + 2.2, wallZ(s)],
        className: 'stage-label',
        html: `<div class="lbl-stage" style="color:${s === 0 ? '#ffffff' : STAGE_COLORS[(s - 1) % STAGE_COLORS.length]}">STAGE ${s + 1}</div>`,
        maxDistance: 75,
        refDistance: 14,
      }),
    )
    const padLabels = Array.from({ length: STAGE_COUNT }, (_, s) =>
      createLabel({ position: [padX(), 5.4, padZ(s)], className: 'pad-label', maxDistance: 45, refDistance: 10 }),
    )
    const refresh = () => {
      const state = useGameStore.getState()
      padLabels.forEach((l, s) => l.setHtml(padLabelHtml(s, state, stageRun.claimed)))
      _color.set(stageRun.claimed ? PADS.claimed : PADS.ready)
      for (let s = 0; s < STAGE_COUNT; s += 1) padsRef.current?.setColorAt(s, _color)
      if (padsRef.current?.instanceColor) padsRef.current.instanceColor.needsUpdate = true
    }
    refresh()
    const offs = [events.on('padClaim', refresh), events.on('runReset', refresh)]
    const unsubscribe = useGameStore.subscribe((s, prev) => {
      if (s.rebirths !== prev.rebirths || s.boosts !== prev.boosts) refresh()
    })
    // A 2x Wins boost running out changes the numbers without a store change.
    const id = setInterval(refresh, 5000)
    return () => {
      offs.forEach((off) => off())
      unsubscribe()
      clearInterval(id)
      signs.forEach((l) => l.remove())
      padLabels.forEach((l) => l.remove())
    }
  }, [])

  useColliders(
    () => [
      ...[-1, 1].map((side) => ({ box: [side * SIDE_X, MID_Z, 1, LENGTH / 2 + 1] })),
      { box: [0, STAGE_END_Z - 1, TRACK_HALF + 2, 1] },
    ],
    [],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // The trophy pool: spinning and bobbing over the pads around the player.
    const trophies = trophyRef.current
    if (trophies) {
      const first = Math.max(0, stageAtZ(player.z) - 1)
      for (let k = 0; k < TROPHY_POOL; k += 1) {
        const s = first + k
        if (s >= STAGE_COUNT) {
          trophies.setMatrixAt(k, _hidden.matrix)
          continue
        }
        _dummy.position.set(padX(), 2.6 + Math.sin(t * 2 + s) * 0.2, padZ(s))
        _dummy.rotation.set(0, t * 1.6 + s, 0)
        _dummy.scale.set(1.1, 1.1, 1.1)
        _dummy.updateMatrix()
        trophies.setMatrixAt(k, _dummy.matrix)
      }
      trophies.instanceMatrix.needsUpdate = true
    }
    setUniform(padFxRef.current?.material, 'uTime', t)
  })

  return (
    <>
      <mesh geometry={geo.floor} material={mat.floor} receiveShadow />
      <mesh geometry={geo.path} material={mat.path} receiveShadow />
      <mesh geometry={geo.borders} material={mat.border} receiveShadow />
      <mesh geometry={geo.walls} material={mat.walls} receiveShadow />
      <mesh geometry={geo.pillars} material={mat.vertex} castShadow receiveShadow />
      <instancedMesh ref={padsRef} args={[geo.pad, mat.pad, STAGE_COUNT]} />
      <instancedMesh ref={trophyRef} args={[geo.trophy, mat.trophy, TROPHY_POOL]} frustumCulled={false} />
      {preset.name !== 'LOW' && (
        <instancedMesh ref={padFxRef} args={[geo.padFx, mat.padFx, STAGE_COUNT]} renderOrder={2} frustumCulled={false} />
      )}
      {trees.length > 0 && (
        <instancedMesh key={trees.length} ref={treesRef} args={[geo.tree, mat.vertex, trees.length]} castShadow={false} />
      )}
    </>
  )
}

export default StageLine
