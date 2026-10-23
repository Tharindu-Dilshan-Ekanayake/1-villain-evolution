import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three'

import { useNetStore } from '../../net/netStore'
import { equippedPetIds } from '../../state/economy'
import { useGameStore } from '../../state/gameStore'
import { player } from '../../state/runtime'
import { usePreset } from '../quality'
import { remoteHandles } from '../remoteHandles'
import { petGeometry } from './petModels'

/** Formation slots behind the owner, in owner space (x right, z forward). */
const SLOTS = [
  [-1.35, -1.25],
  [1.35, -1.25],
  [0, -2.35],
]
/** Owners: you plus up to eight other players in the lobby. */
const MAX_OWNERS = 9
/** Instances per species: enough for everyone to have three of the same pet. */
const PER_SPECIES = MAX_OWNERS * SLOTS.length
const PET_SCALE = 0.9
/** Other players' pets are drawn only this close on LOW. */
const REMOTE_RANGE_LOW = 25

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3(PET_SCALE, PET_SCALE, PET_SCALE)
const _up = new Vector3(0, 1, 0)

/** Follow state for every pet slot of every owner, made once (owner index * 3 + slot). */
const followers = Array.from({ length: PER_SPECIES }, () => ({ x: 0, z: 0, yaw: 0, placed: false }))

/** Adds one pet instance at follower `f`, or asks for its species' mesh. */
function placePet(meshes, wanted, speciesId, f, hop) {
  const mesh = meshes.get(speciesId)
  if (!mesh) {
    wanted.add(speciesId)
    return
  }
  if (mesh.count >= PER_SPECIES) return
  _p.set(f.x, hop, f.z)
  _q.setFromAxisAngle(_up, f.yaw)
  mesh.setMatrixAt(mesh.count, _m.compose(_p, _q, _s))
  mesh.count += 1
}

/** Moves one owner's pets towards their formation slots and draws them. */
function followOwner(meshes, wanted, owner, x, z, yaw, pets, t, delta) {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  const k = 1 - Math.exp(-6 * delta)
  for (let slot = 0; slot < SLOTS.length; slot += 1) {
    const f = followers[owner * SLOTS.length + slot]
    const speciesId = pets[slot]
    if (!speciesId) {
      f.placed = false
      continue
    }
    const [sx, sz] = SLOTS[slot]
    // Owner space -> world: right = (-cos, sin), forward = (sin, cos).
    const tx = x - cos * sx + sin * sz
    const tz = z + sin * sx + cos * sz
    if (!f.placed) {
      f.x = tx
      f.z = tz
      f.placed = true
    }
    const dx = (tx - f.x) * k
    const dz = (tz - f.z) * k
    f.x += dx
    f.z += dz
    const moving = dx * dx + dz * dz > 1e-5
    f.yaw = moving ? Math.atan2(dx, dz) : yaw
    const hop = Math.abs(Math.sin(t * 7 + slot * 1.3)) * (moving ? 0.35 : 0.06)
    placePet(meshes, wanted, speciesId, f, hop)
  }
}

/**
 * Every pet in the lobby - yours and everyone else's - as one InstancedMesh per
 * species, so eight players with three pets each is still a handful of draw calls.
 * A species' mesh is made the first time anyone has that pet (between frames, never
 * inside one). Pets trail their owner in formation, hopping as they go.
 */
export function Pets() {
  const preset = usePreset()
  const groupRef = useRef(null)
  const material = useMemo(() => new MeshLambertMaterial({ vertexColors: true }), [])
  /** species id -> InstancedMesh */
  const meshesRef = useRef(new Map())
  /** Species the frame loop wanted but that don't have a mesh yet. */
  const wantedRef = useRef(new Set())
  /** Your equipped pets, kept current outside the frame loop. */
  const mine = useRef([])
  /** Remote session id -> owner index (1..8). */
  const ownersRef = useRef(new Map())

  useEffect(() => {
    const update = (s) => {
      mine.current = equippedPetIds(s)
    }
    update(useGameStore.getState())
    return useGameStore.subscribe(update)
  }, [])

  // Owner indices for other players, reassigned when people join or leave.
  useEffect(() => {
    const owners = ownersRef.current
    const assign = (players) => {
      const ids = Object.keys(players)
      for (const id of [...owners.keys()]) if (!players[id]) owners.delete(id)
      const used = new Set(owners.values())
      for (const id of ids) {
        if (owners.has(id)) continue
        for (let k = 1; k < MAX_OWNERS; k += 1) {
          if (used.has(k)) continue
          owners.set(id, k)
          used.add(k)
          for (let slot = 0; slot < SLOTS.length; slot += 1) followers[k * SLOTS.length + slot].placed = false
          break
        }
      }
    }
    assign(useNetStore.getState().players)
    return useNetStore.subscribe((s, prev) => {
      if (s.players !== prev.players) assign(s.players)
    })
  }, [])

  // Builds meshes for newly seen species between frames.
  useEffect(() => {
    const group = groupRef.current
    const meshes = meshesRef.current
    const wanted = wantedRef.current
    const id = setInterval(() => {
      if (!group || wanted.size === 0) return
      for (const speciesId of wanted) {
        if (meshes.has(speciesId)) continue
        const mesh = new InstancedMesh(petGeometry(speciesId), material, PER_SPECIES)
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.castShadow = preset.shadows
        meshes.set(speciesId, mesh)
        group.add(mesh)
      }
      wanted.clear()
    }, 50)
    return () => {
      clearInterval(id)
      for (const mesh of meshes.values()) {
        group?.remove(mesh)
        mesh.dispose()
      }
      meshes.clear()
      wanted.clear()
    }
  }, [material, preset.shadows])

  useEffect(() => () => material.dispose(), [material])

  useFrame((state, rawDelta) => {
    const meshes = meshesRef.current
    const wanted = wantedRef.current
    const owners = ownersRef.current
    const delta = Math.min(rawDelta, 0.05)
    const t = state.clock.elapsedTime
    for (const mesh of meshes.values()) mesh.count = 0

    if (player.ready) followOwner(meshes, wanted, 0, player.x, player.z, player.yaw, mine.current, t, delta)

    const range = preset.name === 'LOW' ? REMOTE_RANGE_LOW : Infinity
    for (const [id, h] of remoteHandles) {
      const owner = owners.get(id)
      if (!owner || !h.root?.visible || !h.pets?.length) continue
      if (Math.hypot(h.x - player.x, h.z - player.z) > range) continue
      followOwner(meshes, wanted, owner, h.x, h.z, h.yaw, h.pets, t, delta)
    }

    for (const mesh of meshes.values()) {
      mesh.visible = mesh.count > 0
      if (mesh.count > 0) mesh.instanceMatrix.needsUpdate = true
    }
  })

  return <group ref={groupRef} />
}

export default Pets
