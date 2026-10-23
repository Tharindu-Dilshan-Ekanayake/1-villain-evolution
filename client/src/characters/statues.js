import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import { applyPose, applyProportions, collectRig, createPose, writeStatuePose } from '../game/avatarRig'
import { VILLAIN_BY_ID } from '../state/content'
import { GEAR_BONES, getGear } from './accessories'

/**
 * Bakes every pedestal statue into ONE static geometry.
 *
 * Each statue is the real Bloxity rig, posed with the same pose code the player uses,
 * with its skinned vertices computed once on the CPU. UVs are remapped into the
 * statue atlas cell of that villain, and gear samples the atlas's white cell so its
 * vertex colours show. Result: 21 statues + all their gear = 1 mesh, 1 draw call.
 * Each vertex also knows its statue's centre (`aStatue`), so the material can sway and
 * breathe every statue on its own phase.
 */

const _v = new Vector3()
const _n = new Vector3()
const _toRoot = new Matrix4()
const _place = new Matrix4()
const _q = new Quaternion()
const _up = new Vector3(0, 1, 0)
const _rim = new Color()

function bakeSkinnedMesh(mesh, rootInverse) {
  const src = mesh.geometry
  const pos = src.getAttribute('position')
  const uv = src.getAttribute('uv')
  const count = pos.count

  const positions = new Float32Array(count * 3)
  _toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld)
  for (let i = 0; i < count; i += 1) {
    _v.fromBufferAttribute(pos, i)
    mesh.applyBoneTransform(i, _v)
    _v.applyMatrix4(_toRoot)
    positions[i * 3] = _v.x
    positions[i * 3 + 1] = _v.y
    positions[i * 3 + 2] = _v.z
  }

  // getX/getY rather than copying .array: handles a normalized integer accessor too.
  const uvs = new Float32Array(count * 2)
  for (let i = 0; i < count; i += 1) {
    uvs[i * 2] = uv.getX(i)
    uvs[i * 2 + 1] = uv.getY(i)
  }

  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(positions, 3))
  out.setAttribute('uv', new BufferAttribute(uvs, 2))
  if (src.index) out.setIndex(src.index.clone())
  const flat = out.toNonIndexed()
  flat.computeVertexNormals()
  return flat
}

/** The villain's effect colour on every vertex, for the statue's rim glow. */
function rimColors(count, color) {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    out[i * 3] = color.r
    out[i * 3 + 1] = color.g
    out[i * 3 + 2] = color.b
  }
  return new BufferAttribute(out, 3)
}

function whiteColors(count) {
  return new BufferAttribute(new Float32Array(count * 3).fill(1), 3)
}

/** Per-vertex statue centre (x, z) and an animation phase, for the idle sway. */
function statueAttribute(count, x, z, phase) {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    out[i * 3] = x
    out[i * 3 + 1] = z
    out[i * 3 + 2] = phase
  }
  return new BufferAttribute(out, 3)
}

/**
 * @param {object} params
 * @param {import('three').Object3D} params.baseScene the loaded player.glb scene
 * @param {Array<{id: string, x: number, z: number, facing: number}>} params.statues
 * @param {ReturnType<import('./skins').buildStatueAtlas>} params.atlas
 * @param {number} params.height world height of a statue
 * @returns {BufferGeometry}
 */
export function buildStatueGeometry({ baseScene, statues, atlas, height }) {
  const character = cloneSkeleton(baseScene)
  // Bevelled rather than fully round: 21 statues share the lobby's triangle budget.
  const rig = collectRig(character, 'bevel')
  const pose = createPose()
  const parts = []
  const scale = height / 6.4

  statues.forEach((statue, index) => {
    const morph = VILLAIN_BY_ID[statue.id]
    if (!morph) return
    _rim.set(morph.fx?.color || '#ffffff')
    const phase = index * 2.39

    applyProportions(rig, DEFAULT_PROPORTIONS)
    writeStatuePose(pose, morph.pose)
    applyPose(rig, pose)
    character.updateMatrixWorld(true)
    const rootInverse = character.matrixWorld.clone().invert()

    _q.setFromAxisAngle(_up, statue.facing)
    _place.compose(_v.set(statue.x, statue.y ?? 0, statue.z), _q, _n.set(scale, scale, scale))

    for (const mesh of rig.skinnedMeshes) {
      const g = bakeSkinnedMesh(mesh, rootInverse)
      const uv = g.getAttribute('uv')
      for (let i = 0; i < uv.count; i += 1) {
        const [u, v] = atlas.remap(morph.id, uv.getX(i), uv.getY(i))
        uv.setXY(i, u, v)
      }
      g.setAttribute('color', whiteColors(uv.count))
      g.setAttribute('aRim', rimColors(uv.count, _rim))
      g.setAttribute('aStatue', statueAttribute(uv.count, statue.x, statue.z, phase))
      g.applyMatrix4(_place)
      parts.push(g)
    }

    const gear = getGear(morph.id)
    for (const [slot, boneName] of Object.entries(GEAR_BONES)) {
      const source = gear[slot]
      const bone = rig.bones[boneName]?.bone
      if (!source || !bone) continue
      const g = source.clone()
      const uv = g.getAttribute('uv')
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, atlas.whiteUv[0], atlas.whiteUv[1])
      g.setAttribute('aRim', rimColors(uv.count, _rim))
      g.setAttribute('aStatue', statueAttribute(uv.count, statue.x, statue.z, phase))
      _toRoot.multiplyMatrices(rootInverse, bone.matrixWorld)
      g.applyMatrix4(_toRoot)
      g.applyMatrix4(_place)
      parts.push(g)
    }
  })

  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  merged.computeBoundingSphere()
  return merged
}
