import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { MeshLambertMaterial, Object3D, PlaneGeometry } from 'three'

import { GATE_Z, LOBBY, LOBBY_WALL_HEIGHT, LOBBY_WALL_THICKNESS, PATH_HALF, SPAWN, STAGE_END_Z, TRACK_HALF } from '../layout'
import { useColliders } from '../physics'
import { usePreset } from '../quality'
import { FENCE, GROUND, PATH, TREES, WALLS } from '../sceneStyle'
import { createStudTexture, createWorldBoxGeometry, createWorldPlaneGeometry } from '../textures'
import { box, cyl, merge, mulberry32 } from './kit'

/** World size of one ground texture repeat (4 x 4 studs of 0.5 units), as the template. */
const GROUND_TILE = 2
/** World size of one wall texture repeat (8 x 8 studs of 0.5 units), as the template. */
const WALL_TILE = 4

const FENCE_HEIGHT = 1.25
const FENCE_POST_SPACING = 2.5
const FENCE_RAIL_HEIGHTS = [0.45, 0.95]

/** Fence lines closing off the training and villain areas at both ends: [x0, z0, x1, z1]. */
const FENCES = [
  [-42, 29, -9, 29],
  [-42, -35, -9, -35],
  [8, 29, 42, 29],
  [8, -35, 42, -35],
]

/** The red path runs from the egg plaza to the gate. */
const PATH_START_Z = 36

const LOBBY_W = LOBBY.x1 - LOBBY.x0
const LOBBY_D = LOBBY.z1 - LOBBY.z0
const LOBBY_MID_Z = (LOBBY.z0 + LOBBY.z1) / 2
/** The grass beyond the walls reaches past the end of the stage line. */
const FIELD = { w: 420, z0: LOBBY.z1 + 140, z1: STAGE_END_Z - 120 }

const _dummy = new Object3D()

/** The template's wooden fence: two rails and a row of posts, in vertex colours. */
function fenceParts([x0, z0, x1, z1]) {
  const length = Math.hypot(x1 - x0, z1 - z0)
  const angle = Math.atan2(x1 - x0, z1 - z0)
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const parts = FENCE_RAIL_HEIGHTS.map((y) => box(0.12, 0.22, length, FENCE.rail, { pos: [cx, y, cz], rot: [0, angle, 0] }))
  const count = Math.floor(length / FENCE_POST_SPACING) + 1
  for (let i = 0; i < count; i += 1) {
    const k = count === 1 ? 0.5 : i / (count - 1)
    parts.push(box(0.24, FENCE_HEIGHT, 0.24, FENCE.post, { pos: [x0 + (x1 - x0) * k, FENCE_HEIGHT / 2, z0 + (z1 - z0) * k] }))
  }
  return parts
}

/** A strip of the red path, UVs in world units. */
function pathStrip(width, x, z0, z1, y) {
  const length = z0 - z1
  const g = new PlaneGeometry(width, length).toNonIndexed()
  g.rotateX(-Math.PI / 2)
  g.translate(x, y, (z0 + z1) / 2)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, pos.getX(i) / GROUND_TILE, pos.getZ(i) / GROUND_TILE)
  return g
}

function buildTree() {
  return merge([
    box(0.9, 3.2, 0.9, TREES.trunk, { pos: [0, 1.6, 0] }),
    box(3.4, 2.4, 3.4, TREES.leaves[0], { pos: [0, 3.9, 0] }),
    box(2.3, 1.6, 2.3, TREES.leaves[1], { pos: [0, 5.6, 0] }),
  ])
}

/** Trees on the grass round the outside of the lobby walls. */
function treeSpots() {
  const rand = mulberry32(17)
  const out = []
  for (let k = 0; k < 46; k += 1) {
    const a = rand() * Math.PI * 2
    const r = 1.15 + rand() * 0.6
    const x = Math.cos(a) * (LOBBY_W / 2) * r
    const z = LOBBY_MID_Z + Math.sin(a) * (LOBBY_D / 2) * r
    // Keep the view down the stage line clear.
    if (z < GATE_Z && Math.abs(x) < TRACK_HALF + 6) continue
    if (Math.abs(x) < LOBBY.x1 + 4 && z < LOBBY.z1 + 4 && z > LOBBY.z0 - 4) continue
    out.push({ x, z, s: 0.8 + rand() * 0.7, r: rand() * Math.PI })
  }
  return out
}

/**
 * The lobby, in the template's look: a lime studded baseplate (the template's own
 * texture and colours) inside tall tan checker brick walls, with the STAGES gate cut
 * into the north wall. A red running path with yellow borders leads from spawn to the
 * gate, and the template's orange fences frame the treadmill and egg areas.
 *
 * Only the floor is needed to start playing; trees beyond the walls are scenery and
 * skipped on LOW.
 */
export function Ground() {
  const preset = usePreset()
  const texSize = Math.min(512, preset.textureSize)
  const treesRef = useRef(null)

  const textures = useMemo(
    () => ({
      ground: createStudTexture({ base: GROUND.base, alt: GROUND.alt, size: texSize }),
      brick: createStudTexture({ base: WALLS.base, alt: WALLS.alt, studsPerCell: 4, size: texSize }),
      path: createStudTexture({ base: PATH.base, alt: PATH.alt, size: texSize }),
      border: createStudTexture({ base: PATH.border, alt: PATH.borderAlt, size: Math.min(256, texSize) }),
    }),
    [texSize],
  )

  const geo = useMemo(() => {
    const floor = createWorldBoxGeometry(LOBBY_W, 1, LOBBY_D, GROUND_TILE)
    floor.translate(0, -0.5, LOBBY_MID_Z)
    const field = createWorldPlaneGeometry(FIELD.w, FIELD.z0 - FIELD.z1, GROUND_TILE)
    field.rotateX(-Math.PI / 2)
    field.translate(0, -0.25, (FIELD.z0 + FIELD.z1) / 2)

    const wall = (w, d, x, z) => {
      const g = createWorldBoxGeometry(w, LOBBY_WALL_HEIGHT, d, WALL_TILE)
      g.translate(x, LOBBY_WALL_HEIGHT / 2 - 0.25, z)
      return g.toNonIndexed()
    }
    const T = LOBBY_WALL_THICKNESS
    const northW = LOBBY.x1 - TRACK_HALF - 1
    const walls = merge([
      wall(LOBBY_W + T, T, 0, LOBBY.z1),
      wall(T, LOBBY_D + T, LOBBY.x0, LOBBY_MID_Z),
      wall(T, LOBBY_D + T, LOBBY.x1, LOBBY_MID_Z),
      wall(northW, T, -(TRACK_HALF + 1 + northW / 2), LOBBY.z0),
      wall(northW, T, TRACK_HALF + 1 + northW / 2, LOBBY.z0),
    ])

    const pathZ0 = PATH_START_Z
    return {
      floor,
      field,
      walls,
      path: pathStrip(PATH_HALF * 2, 0, pathZ0, GATE_Z, 0.015),
      borders: merge([pathStrip(0.7, -PATH_HALF - 0.35, pathZ0, GATE_Z, 0.016), pathStrip(0.7, PATH_HALF + 0.35, pathZ0, GATE_Z, 0.016)]),
      props: merge([
        ...FENCES.flatMap(fenceParts),
        // The spawn plate.
        cyl(2.5, 2.6, 0.12, 32, '#ffd21a', { pos: [SPAWN[0], 0.06, SPAWN[2]] }),
        cyl(2.05, 2.05, 0.14, 32, '#ffffff', { pos: [SPAWN[0], 0.08, SPAWN[2]] }),
      ]),
      tree: buildTree(),
    }
  }, [])

  const mat = useMemo(
    () => ({
      ground: new MeshLambertMaterial({ map: textures.ground }),
      brick: new MeshLambertMaterial({ map: textures.brick }),
      path: new MeshLambertMaterial({ map: textures.path, polygonOffset: true, polygonOffsetFactor: -1 }),
      border: new MeshLambertMaterial({ map: textures.border, polygonOffset: true, polygonOffsetFactor: -2 }),
      vertex: new MeshLambertMaterial({ vertexColors: true }),
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

  const trees = useMemo(() => (preset.name === 'LOW' ? [] : treeSpots()), [preset.name])
  useLayoutEffect(() => {
    const mesh = treesRef.current
    if (!mesh) return
    trees.forEach((t, i) => {
      _dummy.position.set(t.x, -0.25, t.z)
      _dummy.rotation.set(0, t.r, 0)
      _dummy.scale.set(t.s, t.s, t.s)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [trees])

  useColliders(() => {
    const T = LOBBY_WALL_THICKNESS / 2
    const northW = LOBBY.x1 - TRACK_HALF - 1
    return [
      { box: [0, LOBBY.z1, LOBBY_W / 2 + T, T] },
      { box: [LOBBY.x0, LOBBY_MID_Z, T, LOBBY_D / 2 + T] },
      { box: [LOBBY.x1, LOBBY_MID_Z, T, LOBBY_D / 2 + T] },
      { box: [-(TRACK_HALF + 1 + northW / 2), LOBBY.z0, northW / 2, T] },
      { box: [TRACK_HALF + 1 + northW / 2, LOBBY.z0, northW / 2, T] },
      ...FENCES.map(([x0, z0, x1, z1]) => ({
        box: [(x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2 + 0.15, Math.abs(z1 - z0) / 2 + 0.15],
      })),
    ]
  }, [])

  return (
    <>
      <mesh geometry={geo.field} material={mat.ground} receiveShadow />
      <mesh geometry={geo.floor} material={mat.ground} receiveShadow />
      <mesh geometry={geo.path} material={mat.path} receiveShadow />
      <mesh geometry={geo.borders} material={mat.border} receiveShadow />
      <mesh geometry={geo.walls} material={mat.brick} receiveShadow />
      <mesh geometry={geo.props} material={mat.vertex} castShadow receiveShadow />
      {trees.length > 0 && <instancedMesh key={trees.length} ref={treesRef} args={[geo.tree, mat.vertex, trees.length]} />}
    </>
  )
}

export default Ground
