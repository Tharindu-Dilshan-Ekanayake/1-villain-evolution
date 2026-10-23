import { NearestFilter, Quaternion, SRGBColorSpace, Vector3 } from 'three'

import { BACK_BONE, HAT_BONE, NECK_OFFSET_BONE, PART_SLOTS } from '../bloxity/avatarAssets'
import { softenPart } from '../characters/softBody'

/**
 * Rig manipulation for the base `player.glb` character.
 *
 * The rig's real structure (confirmed by reading player.glb directly):
 *   character
 *     - default_arm_L / default_arm_R / default_head
 *     - default_leg_L / default_leg_R / default_torso   (6 SkinnedMeshes, 1 skeleton)
 *     - Rig1
 *         - Spine1 > Spine2 > { ArmL_Offset > ArmL1 > ArmL2,
 *                               ArmR_Offset > ArmR1 > ArmR2,
 *                               Neck_Offset > Neck1 }
 *         - LegL_Offset > LegL1 > LegL2, LegR_Offset > LegR1 > LegR2
 *
 * Two consequences drive everything below:
 *  1. Body parts are NOT attached to bones. Each is a separate SkinnedMesh sharing one
 *     skeleton, so equipping a part means swapping that mesh's geometry (remapping
 *     skin indices into the base skeleton's bone order first).
 *  2. Accessories DO attach to bones: hats to `Neck1`, back items to `Spine2`.
 *
 * player.glb ships no animation clips, so the character is posed, not animated.
 */

/**
 * Walks the loaded rig and collects everything later operations need. Box-shaped body
 * parts are rounded off on the way (characters/softBody.js).
 *
 * @param {import('three').Object3D} root
 * @param {'round' | 'bevel' | 'none'} [softMode]
 */
export function collectRig(root, softMode = 'none') {
  const rig = {
    root,
    softMode,
    skeleton: null,
    /** slot -> SkinnedMesh */
    partMeshes: {},
    /** slot -> the pristine geometry to restore on unequip */
    originalGeometries: {},
    /** bone name -> { bone, origPos, origQuat, origScale } */
    bones: {},
    hatBone: null,
    backBone: null,
    neckOffsetBindY: 0,
    skinnedMeshes: [],
    /** Rest placement of the character root, so whole-body moves return to it. */
    rootRestY: root.position.y,
    rootRestZ: root.position.z,
    rootRestPitch: root.rotation.x,
  }

  const meshBySlot = new Map(
    Object.entries(PART_SLOTS).map(([slot, cfg]) => [cfg.mesh.toLowerCase(), slot]),
  )

  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      node.castShadow = true
      node.receiveShadow = true
      rig.skinnedMeshes.push(node)
      if (!rig.skeleton) rig.skeleton = node.skeleton
      // Always soften from the pristine part, so a second pass can change the mode.
      node.userData.baseGeometry ??= node.geometry
      node.geometry = softenPart(node.userData.baseGeometry, softMode)

      const slot = meshBySlot.get((node.name || '').toLowerCase())
      if (slot) {
        rig.partMeshes[slot] = node
        rig.originalGeometries[slot] = node.geometry.clone()
      }
    } else if (node.isMesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  const skeleton = rig.skeleton
  if (skeleton) {
    for (const bone of skeleton.bones) {
      // Proportions are re-applied every frame from these rest values.
      bone.matrixAutoUpdate = true
      rig.bones[bone.name] = {
        bone,
        origPos: bone.position.clone(),
        origQuat: bone.quaternion.clone(),
        origScale: bone.scale.clone(),
      }
    }

    // Bone local axes are NOT world-aligned in this rig: a limb bone's local X
    // points along world -Z and its local Z along world -X, so rotating a leg about
    // its local X swings it sideways instead of forward/back. The offsets differ per
    // bone (Spine1 is identity, ArmL2 is off by ~14 degrees), so rather than hardcode
    // an axis, record for each bone the local-space axis matching each character-space
    // axis and animate about those.
    root.updateMatrixWorld(true)
    const rootQuat = new Quaternion()
    root.getWorldQuaternion(rootQuat)
    const rootQuatInv = rootQuat.invert()
    const boneWorld = new Quaternion()

    for (const bone of skeleton.bones) {
      const entry = rig.bones[bone.name]
      if (!entry) continue
      bone.getWorldQuaternion(boneWorld)
      // Bone orientation relative to the character, then inverted: this maps a
      // character-space axis into the bone's own local frame.
      const relInv = rootQuatInv.clone().multiply(boneWorld).invert()
      /** Local axis to rotate about for forward/back swing. */
      entry.axisX = new Vector3(1, 0, 0).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for lateral sway. */
      entry.axisZ = new Vector3(0, 0, 1).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for a twist (turning the torso or head). */
      entry.axisY = new Vector3(0, 1, 0).applyQuaternion(relInv).normalize()
    }

    rig.hatBone = skeleton.bones.find((b) => b.name === HAT_BONE) || null
    rig.backBone = skeleton.bones.find((b) => b.name === BACK_BONE) || null

    const neckIndex = skeleton.bones.findIndex((b) => b.name === NECK_OFFSET_BONE)
    if (neckIndex >= 0) {
      // elements[13] is the Y translation of the inverted bind matrix.
      rig.neckOffsetBindY = skeleton.boneInverses[neckIndex].clone().invert().elements[13]
    }
  }

  return rig
}

/**
 * Bloxity textures are authored unflipped and pixel-art filtered.
 *
 * They are also sRGB images. A plain TextureLoader leaves them tagged as linear, which
 * makes three skip the sRGB decode and the avatar renders pale and washed out.
 */
export function configureAvatarTexture(texture) {
  if (!texture) return texture
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Applies the skin texture to every skinned mesh of the base body.
 * The base body ships with an empty texture, so this always runs - with skin "0"
 * standing in when nothing is equipped.
 */
export function applySkin(rig, texture) {
  if (!texture) return
  for (const mesh of rig.skinnedMeshes) {
    if (!mesh.material) continue
    mesh.material.map = texture
    mesh.material.needsUpdate = true
  }
}

/**
 * Swaps a body part's geometry onto its base skinned mesh.
 *
 * A part GLB carries its own skeleton whose bone *order* may differ from the base
 * rig's. Its `skinIndex` attribute therefore has to be remapped by bone name, or the
 * limb deforms against the wrong bones.
 *
 * @param {object} rig from `collectRig`
 * @param {string} slot key of PART_SLOTS
 * @param {import('three').Object3D|null} partScene loaded GLB scene, or null to reset
 */
export function applyPart(rig, slot, partScene) {
  const targetMesh = rig.partMeshes[slot]
  if (!targetMesh) return

  // Unequipped / failed download: restore the part baked into player.glb.
  if (!partScene) {
    const original = rig.originalGeometries[slot]
    if (original && targetMesh.geometry !== original) targetMesh.geometry = original
    return
  }

  let skinnedSource = null
  let plainSource = null
  partScene.traverse((node) => {
    if (node.isSkinnedMesh && !skinnedSource) skinnedSource = node
    else if (node.isMesh && !plainSource) plainSource = node
  })

  if (!skinnedSource) {
    // Some parts ship as plain meshes; use them as-is.
    if (plainSource) targetMesh.geometry = plainSource.geometry
    return
  }

  const baseSkeleton = rig.skeleton
  if (!baseSkeleton || !skinnedSource.skeleton) {
    targetMesh.geometry = skinnedSource.geometry
    return
  }

  const cacheKey = `${skinnedSource.geometry.uuid}:${slot}`
  const geometry = skinnedSource.geometry.clone()

  const baseIndexByName = new Map()
  baseSkeleton.bones.forEach((bone, i) => baseIndexByName.set(bone.name, i))

  const remap = new Map()
  skinnedSource.skeleton.bones.forEach((bone, i) => {
    const baseIndex = baseIndexByName.get(bone.name)
    if (baseIndex !== undefined) remap.set(i, baseIndex)
  })

  const skinIndex = geometry.getAttribute('skinIndex')
  if (skinIndex) {
    const array = skinIndex.array
    for (let i = 0; i < array.length; i += 1) {
      const mapped = remap.get(array[i])
      if (mapped !== undefined) array[i] = mapped
    }
    skinIndex.needsUpdate = true
  }

  const soft = softenPart(geometry, rig.softMode, cacheKey)
  if (soft !== geometry) geometry.dispose()
  targetMesh.geometry = soft
}

/**
 * Attaches a hat or back accessory to its bone.
 * Offsets are the SDK's own: hats sit at y=0.8 on `Neck1`, back items at the origin
 * of `Spine2`.
 */
export function attachAccessory(rig, kind, object) {
  const bone = kind === 'hat' ? rig.hatBone : rig.backBone
  if (!object || !bone) return null

  object.scale.setScalar(1)
  object.position.set(0, kind === 'hat' ? 0.8 : 0, 0)
  object.traverse((child) => {
    if (child.isMesh) child.castShadow = true
  })

  bone.add(object)
  return object
}

/**
 * Applies Bloxity body proportions.
 *
 * Must run every frame: each bone is reset to its rest transform before the
 * multipliers are re-applied, which is what makes the result idempotent and lets
 * proportion changes take effect live.
 *
 * `height`, `armLength`, `headScale` and `neckHeight` are applied exactly as the
 * Bloxity portal does, so the in-game body matches the preview. The remaining three
 * (`shoulderWidth`, `torsoScaleX`, `legOffsetX`) are not implemented in the SDK's
 * preview renderer; they are applied here in the spirit of their names and are the
 * ones to sanity-check against the portal.
 */
export function applyProportions(rig, proportions) {
  const skeleton = rig.skeleton
  if (!skeleton || !proportions) return

  const height = proportions.height ?? 1
  const armLength = proportions.armLength ?? 1
  const headScale = proportions.headScale ?? 1
  const neckHeight = proportions.neckHeight ?? 1
  const shoulderWidth = proportions.shoulderWidth ?? 1
  const torsoScaleX = proportions.torsoScaleX ?? 1
  const legOffsetX = proportions.legOffsetX ?? 1

  // Overall height is a scale on the character root, not on a bone.
  rig.root.scale.set(1, height, 1)

  for (const bone of skeleton.bones) {
    const rest = rig.bones[bone.name]
    if (!rest) continue

    const { origScale, origPos, origQuat } = rest
    bone.position.copy(origPos)
    bone.quaternion.copy(origQuat)
    bone.scale.copy(origScale)

    const name = bone.name

    if (name.startsWith('Arm')) {
      bone.scale.y = origScale.y * armLength
      // Not in the SDK preview: widen the shoulders by pushing the arm roots out.
      if (name === 'ArmL_Offset' || name === 'ArmR_Offset') {
        bone.position.x = origPos.x * shoulderWidth
      }
    } else if (name === NECK_OFFSET_BONE) {
      // Keeps the head sitting on the neck as height/headScale change, then applies
      // neckHeight against the bind-pose offset.
      bone.position.y += (height - headScale) * origPos.y
      bone.position.y += rig.neckOffsetBindY * (neckHeight - 1) * 0.8
    } else if (name === HAT_BONE) {
      // Divided by height so the head stays uniform inside the stretched root.
      bone.scale.set(
        origScale.x * headScale,
        origScale.y * (headScale / height),
        origScale.z * headScale,
      )
    } else if (name === BACK_BONE) {
      // Not in the SDK preview: torso width.
      bone.scale.x = origScale.x * torsoScaleX
    } else if (name === 'LegL_Offset' || name === 'LegR_Offset') {
      // Not in the SDK preview: leg splay, mirrored about the rig centre.
      bone.position.x = origPos.x * legOffsetX
    }
  }
}

/* ---------------------------------------------------------------------------
 * Procedural animation
 *
 * player.glb ships zero animation clips, so every move is posed on the bones.
 * A pose is a flat list of joint angles (channels); layers (stance, run, air,
 * charge, slam, knockback, victory, flex) each write a full pose and are
 * cross-faded by weight,
 * then the result is applied once on top of the rest pose that
 * applyProportions() just restored.
 *
 * Angle conventions, in character space (it faces +Z, its left is +X):
 *   swing (about X): negative raises a limb forward / up; positive on a knee folds it.
 *   sway  (about Z): positive moves the LEFT limb outward, negative the RIGHT one.
 *   twist (about Y): positive turns the chest to its left (right shoulder forward).
 * ------------------------------------------------------------------------- */

export const CH = {
  spineSwing: 0,
  spineSway: 1,
  spineTwist: 2,
  neckSwing: 3,
  neckTwist: 4,
  armL1Swing: 5,
  armL1Sway: 6,
  armL2Swing: 7,
  armL2Sway: 8,
  armR1Swing: 9,
  armR1Sway: 10,
  armR2Swing: 11,
  armR2Sway: 12,
  legL1Swing: 13,
  legL1Sway: 14,
  legL2Swing: 15,
  legR1Swing: 16,
  legR1Sway: 17,
  legR2Swing: 18,
  rootY: 19,
  /** Whole body forward (model units) and pitched forward (radians, about the hips). */
  rootZ: 20,
  bodyPitch: 21,
}
const CHANNELS = 22
/** Height of the hips in model units: whole-body pitch turns about them. */
const HIP_PIVOT = 3.2

export const createPose = () => new Float32Array(CHANNELS)

const _animQ = new Quaternion()

function rotateAbout(entry, axisKey, angle) {
  if (!angle || !entry) return
  const axis = entry[axisKey]
  if (!axis) return
  entry.bone.quaternion.multiply(_animQ.setFromAxisAngle(axis, angle))
}

function poseBone(rig, name, swingA, swayA, twistA) {
  const entry = rig.bones[name]
  if (!entry) return
  rotateAbout(entry, 'axisX', swingA)
  rotateAbout(entry, 'axisZ', swayA)
  rotateAbout(entry, 'axisY', twistA)
}

/** Applies a pose on top of the rest pose (call right after applyProportions). */
export function applyPose(rig, p) {
  if (!rig?.skeleton) return
  poseBone(rig, 'Spine1', p[CH.spineSwing], p[CH.spineSway], p[CH.spineTwist])
  poseBone(rig, 'Neck1', p[CH.neckSwing], 0, p[CH.neckTwist])
  poseBone(rig, 'ArmL1', p[CH.armL1Swing], p[CH.armL1Sway], 0)
  poseBone(rig, 'ArmL2', p[CH.armL2Swing], p[CH.armL2Sway], 0)
  poseBone(rig, 'ArmR1', p[CH.armR1Swing], p[CH.armR1Sway], 0)
  poseBone(rig, 'ArmR2', p[CH.armR2Swing], p[CH.armR2Sway], 0)
  poseBone(rig, 'LegL1', p[CH.legL1Swing], p[CH.legL1Sway], 0)
  poseBone(rig, 'LegL2', p[CH.legL2Swing], 0, 0)
  poseBone(rig, 'LegR1', p[CH.legR1Swing], p[CH.legR1Sway], 0)
  poseBone(rig, 'LegR2', p[CH.legR2Swing], 0, 0)
  // Pitch about the hips, not the feet: shift the root so the hips stay put.
  const pitch = p[CH.bodyPitch]
  rig.root.rotation.x = rig.rootRestPitch + pitch
  rig.root.position.y = rig.rootRestY + p[CH.rootY] + HIP_PIVOT * (1 - Math.cos(pitch))
  rig.root.position.z = rig.rootRestZ + p[CH.rootZ] - HIP_PIVOT * Math.sin(pitch)
}

function lerpPose(out, a, b, t) {
  for (let i = 0; i < CHANNELS; i += 1) out[i] = a[i] + (b[i] - a[i]) * t
}

/* --- Layers ---------------------------------------------------------------- */

/**
 * Villain stance: chest out, arms held a little away from the body with loose fists,
 * feet apart and a slow, menacing breath. (`bounce` 0 freezes it, for statues.)
 */
function writeGuard(p, t, bounce = 1) {
  p.fill(0)
  const breathe = Math.sin(t * 1.7) * bounce
  const sway = Math.sin(t * 0.9) * bounce
  p[CH.spineSwing] = -0.06 + breathe * 0.02
  p[CH.spineTwist] = sway * 0.05
  p[CH.neckSwing] = -0.1 + breathe * 0.02
  p[CH.neckTwist] = -sway * 0.08

  p[CH.armL1Swing] = -0.2
  p[CH.armL1Sway] = 0.34 + breathe * 0.03
  p[CH.armL2Swing] = -0.55
  p[CH.armR1Swing] = -0.2
  p[CH.armR1Sway] = -0.34 - breathe * 0.03
  p[CH.armR2Swing] = -0.55

  p[CH.legL1Sway] = 0.13
  p[CH.legR1Sway] = -0.13
  p[CH.rootY] = breathe * 0.04
}

/** Fighter's run: fists up and pumping, leaning into it. */
function writeRun(p, t, ratio) {
  p.fill(0)
  const phase = t * (5 + ratio * 5)
  const cycle = Math.sin(phase)
  const legAmp = 0.9 * ratio
  const armAmp = 0.75 * ratio

  p[CH.legL1Swing] = cycle * legAmp
  p[CH.legR1Swing] = -cycle * legAmp
  p[CH.legL2Swing] = Math.max(0, -cycle) * 1.2 * ratio + 0.1
  p[CH.legR2Swing] = Math.max(0, cycle) * 1.2 * ratio + 0.1

  p[CH.armL1Swing] = -cycle * armAmp - 0.25
  p[CH.armR1Swing] = cycle * armAmp - 0.25
  p[CH.armL2Swing] = -1.25
  p[CH.armR2Swing] = -1.25
  p[CH.armL1Sway] = 0.08
  p[CH.armR1Sway] = -0.08

  p[CH.spineSwing] = 0.2 * ratio
  p[CH.spineTwist] = cycle * 0.12 * ratio
  p[CH.neckSwing] = -0.12 * ratio
  p[CH.rootY] = Math.abs(Math.cos(phase)) * 0.2 * ratio
  return phase
}

function writeAir(p, rising) {
  p.fill(0)
  p[CH.legL1Swing] = -0.75
  p[CH.legL2Swing] = 0.95
  p[CH.legR1Swing] = 0.25
  p[CH.legR2Swing] = 0.55
  p[CH.armL1Swing] = rising ? -2.3 : -1.2
  p[CH.armR1Swing] = rising ? -0.6 : -1.0
  p[CH.armL1Sway] = 0.35
  p[CH.armR1Sway] = -0.5
  p[CH.armL2Swing] = -0.6
  p[CH.armR2Swing] = -1.2
  p[CH.spineSwing] = 0.1
}

/**
 * Shoulder charge, layered over the run as a villain closes on a wall: leaning in,
 * right shoulder leading, that arm braced across the chest, the other swept back.
 */
function writeCharge(p, base) {
  p.set(base)
  p[CH.bodyPitch] = 0.3
  p[CH.spineTwist] = 0.55
  p[CH.spineSwing] = 0.15
  p[CH.neckSwing] = -0.22
  p[CH.neckTwist] = -0.45
  p[CH.armR1Swing] = -0.55
  p[CH.armR1Sway] = 0.5
  p[CH.armR2Swing] = -1.9
  p[CH.armL1Swing] = 0.6
  p[CH.armL1Sway] = 0.28
  p[CH.armL2Swing] = -0.65
}

/** The instant of impact: squashed into the wall, crouched, shoulder buried. */
function writeSlam(p, base) {
  writeCharge(p, base)
  p[CH.bodyPitch] = 0.48
  p[CH.rootZ] = 0.55
  p[CH.rootY] = -0.4
  p[CH.spineTwist] = 0.7
  p[CH.legL1Swing] = -0.55
  p[CH.legL2Swing] = 0.75
  p[CH.legR1Swing] = 0.55
  p[CH.legR2Swing] = 0.45
}

/**
 * Bounced off a wall that held: flung backwards through the air, body tipped back,
 * arms and legs flailing. `u` (0..1) is how far through the flight it is.
 */
function writeKnock(p, t, u) {
  p.fill(0)
  const flail = Math.sin(t * 22)
  const arc = Math.sin(Math.PI * Math.min(1, u))
  p[CH.bodyPitch] = -0.3 - 0.5 * arc
  p[CH.spineSwing] = -0.28
  p[CH.spineTwist] = Math.sin(t * 9) * 0.18
  p[CH.neckSwing] = -0.5 + 0.35 * u
  p[CH.armL1Swing] = -2.1 + flail * 0.35
  p[CH.armL1Sway] = 0.75
  p[CH.armL2Swing] = -0.4
  p[CH.armR1Swing] = -1.8 - flail * 0.35
  p[CH.armR1Sway] = -0.8
  p[CH.armR2Swing] = -0.5
  p[CH.legL1Swing] = -0.95 + flail * 0.22
  p[CH.legL2Swing] = 0.7
  p[CH.legR1Swing] = -0.55 - flail * 0.22
  p[CH.legR2Swing] = 1.0
  p[CH.rootY] = 0.2 * arc
}

/**
 * Landing from a knockback, superhero style: down on one knee, one fist planted on the
 * ground, the other arm swept back.
 */
function writeLand(p, base) {
  p.set(base)
  p[CH.bodyPitch] = 0.32
  p[CH.spineSwing] = 0.2
  p[CH.spineTwist] = 0.25
  p[CH.neckSwing] = -0.45
  p[CH.rootY] = -1.5
  p[CH.legL1Swing] = -1.25
  p[CH.legL2Swing] = 1.45
  p[CH.legL1Sway] = 0.1
  p[CH.legR1Swing] = 0.85
  p[CH.legR2Swing] = 1.85
  p[CH.armR1Swing] = -0.55
  p[CH.armR1Sway] = 0.12
  p[CH.armR2Swing] = -0.05
  p[CH.armL1Swing] = 0.95
  p[CH.armL1Sway] = 0.65
  p[CH.armL2Swing] = -0.3
}

/** Smashing through: both arms thrown up in triumph, still running. */
function writeBurst(p, base) {
  p.set(base)
  p[CH.armL1Swing] = -2.65
  p[CH.armR1Swing] = -2.65
  p[CH.armL1Sway] = 0.5
  p[CH.armR1Sway] = -0.5
  p[CH.armL2Swing] = -0.2
  p[CH.armR2Swing] = -0.2
  p[CH.spineSwing] = -0.15
  p[CH.spineTwist] = 0
  p[CH.neckSwing] = -0.3
  p[CH.bodyPitch] = 0.08
}

/* --- Villain styles ---------------------------------------------------------- */

/** Hand on hip, weight on one leg, a head tilt and a slow sway. */
function writeHips(p, t, bounce = 1) {
  p.fill(0)
  const breathe = Math.sin(t * 1.7) * bounce
  const sway = Math.sin(t * 0.8) * bounce
  p[CH.spineSway] = 0.09 + sway * 0.03
  p[CH.spineTwist] = -0.14
  p[CH.spineSwing] = -0.05 + breathe * 0.015
  p[CH.neckTwist] = 0.16
  p[CH.neckSwing] = -0.06
  p[CH.armL1Swing] = 0.22
  p[CH.armL1Sway] = 0.78
  p[CH.armL2Swing] = -0.35
  p[CH.armL2Sway] = -1.55
  p[CH.armR1Swing] = -0.1
  p[CH.armR1Sway] = -0.16 - breathe * 0.02
  p[CH.armR2Swing] = -0.25
  p[CH.legL1Sway] = 0.03
  p[CH.legR1Sway] = -0.2
  p[CH.legR1Swing] = -0.1
  p[CH.legR2Swing] = 0.2
  p[CH.rootY] = breathe * 0.03
}

/** Wide, heavy and hunched: arms bowed out, knees bent, big slow breaths. */
function writeBruteStance(p, t, bounce = 1) {
  p.fill(0)
  const breathe = Math.sin(t * 1.4) * bounce
  p[CH.spineSwing] = 0.22 + breathe * 0.03
  p[CH.neckSwing] = -0.28
  p[CH.armL1Swing] = -0.25
  p[CH.armL1Sway] = 0.55 + breathe * 0.05
  p[CH.armL2Swing] = -0.65
  p[CH.armL2Sway] = -0.35
  p[CH.armR1Swing] = -0.25
  p[CH.armR1Sway] = -0.55 - breathe * 0.05
  p[CH.armR2Swing] = -0.65
  p[CH.armR2Sway] = 0.35
  p[CH.legL1Swing] = -0.2
  p[CH.legL1Sway] = 0.26
  p[CH.legL2Swing] = 0.38
  p[CH.legR1Swing] = -0.2
  p[CH.legR1Sway] = -0.26
  p[CH.legR2Swing] = 0.38
  p[CH.rootY] = -0.3 + breathe * 0.06
}

/** Levitating: drifting up and down, legs together, arms held out, palms down. */
function writeFloat(p, t, bounce = 1) {
  p.fill(0)
  const bob = Math.sin(t * 1.8) * bounce
  p[CH.rootY] = 1.1 + bob * 0.25
  p[CH.spineSway] = Math.sin(t * 1.1) * 0.05 * bounce
  p[CH.spineSwing] = -0.04
  p[CH.neckSwing] = -0.08
  p[CH.armL1Swing] = -0.35
  p[CH.armL1Sway] = 0.62 + bob * 0.06
  p[CH.armL2Swing] = -0.3
  p[CH.armR1Swing] = -0.35
  p[CH.armR1Sway] = -0.62 - bob * 0.06
  p[CH.armR2Swing] = -0.3
  p[CH.legL1Swing] = -0.15
  p[CH.legL2Swing] = 0.4
  p[CH.legR1Swing] = 0.08
  p[CH.legR2Swing] = 0.12
  p[CH.legL1Sway] = -0.04
  p[CH.legR1Sway] = 0.04
}

function writeStance(p, t, stance, bounce = 1) {
  if (stance === 'hips') writeHips(p, t, bounce)
  else if (stance === 'brute') writeBruteStance(p, t, bounce)
  else if (stance === 'float') writeFloat(p, t, bounce)
  else writeGuard(p, t, bounce)
}

/** The ninja run: leaning hard into it, arms straight out behind. */
function writeNinjaRun(p, t, ratio) {
  const phase = writeRun(p, t, ratio)
  p[CH.bodyPitch] = 0.42 * ratio
  p[CH.spineSwing] = 0.15 * ratio
  p[CH.neckSwing] = -0.48 * ratio
  p[CH.spineTwist] = 0
  p[CH.armL1Swing] = 1.25
  p[CH.armR1Swing] = 1.25
  p[CH.armL1Sway] = 0.18
  p[CH.armR1Sway] = -0.18
  p[CH.armL2Swing] = 0
  p[CH.armR2Swing] = 0
  return phase
}

/** The brute's stomp: wide, rolling shoulders, big swinging arms, heavy bounce. */
function writeBruteRun(p, t, ratio) {
  const phase = writeRun(p, t * 0.85, ratio)
  const cycle = Math.sin(phase)
  p[CH.spineTwist] = cycle * 0.32 * ratio
  p[CH.spineSwing] = 0.28 * ratio
  p[CH.armL1Sway] = 0.45
  p[CH.armR1Sway] = -0.45
  p[CH.armL1Swing] = -cycle * 0.95 * ratio - 0.2
  p[CH.armR1Swing] = cycle * 0.95 * ratio - 0.2
  p[CH.armL2Swing] = -0.9
  p[CH.armR2Swing] = -0.9
  p[CH.legL1Sway] = 0.16
  p[CH.legR1Sway] = -0.16
  p[CH.rootY] = Math.abs(Math.cos(phase)) * 0.38 * ratio - 0.15
  return phase
}

/**
 * Hover-glide for the floating villains: tipped forward, arms swept back like wings,
 * legs trailing together. The (unseen) stride phase still counts steps.
 */
function writeGlide(p, t, ratio) {
  p.fill(0)
  const phase = t * (5 + ratio * 5)
  const beat = Math.sin(phase * 0.5)
  p[CH.rootY] = 1.3 + beat * 0.18
  p[CH.bodyPitch] = 0.65 * ratio
  p[CH.spineSwing] = 0.1
  p[CH.neckSwing] = -0.6 * ratio
  p[CH.spineTwist] = Math.sin(t * 1.3) * 0.08
  p[CH.armL1Swing] = 0.85 + beat * 0.15
  p[CH.armR1Swing] = 0.85 + beat * 0.15
  p[CH.armL1Sway] = 0.38
  p[CH.armR1Sway] = -0.38
  p[CH.armL2Swing] = -0.15
  p[CH.armR2Swing] = -0.15
  p[CH.legL1Swing] = 0.3
  p[CH.legR1Swing] = 0.48
  p[CH.legL2Swing] = 0.35
  p[CH.legR2Swing] = 0.5
  return phase
}

function writeRunStyle(p, t, ratio, run) {
  if (run === 'ninja') return writeNinjaRun(p, t, ratio)
  if (run === 'brute') return writeBruteRun(p, t, ratio)
  if (run === 'glide') return writeGlide(p, t, ratio)
  return writeRun(p, t, ratio)
}

/** Front flip, tucked tight: `u` 0..1 through the jump. */
function writeFlip(p, u) {
  p.fill(0)
  const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)
  p[CH.bodyPitch] = Math.PI * 2 * e
  const tuck = Math.sin(Math.PI * Math.min(1, u * 1.15))
  p[CH.legL1Swing] = -1.5 * tuck
  p[CH.legR1Swing] = -1.5 * tuck
  p[CH.legL2Swing] = 1.9 * tuck
  p[CH.legR2Swing] = 1.9 * tuck
  p[CH.armL1Swing] = -1.3 * tuck
  p[CH.armR1Swing] = -1.3 * tuck
  p[CH.armL2Swing] = -1.4 * tuck
  p[CH.armR2Swing] = -1.4 * tuck
  p[CH.spineSwing] = 0.35 * tuck
  p[CH.neckSwing] = 0.3 * tuck
  p[CH.rootY] = 0.6 * tuck
}

/** The evil laugh: claws up, head thrown back, shoulders shaking. */
function writeLaugh(p, base, t) {
  p.set(base)
  const shake = Math.sin(t * 26)
  p[CH.neckSwing] = -0.62 + shake * 0.05
  p[CH.spineSwing] = -0.24
  p[CH.spineTwist] = Math.sin(t * 11) * 0.07
  p[CH.armL1Swing] = -0.95
  p[CH.armL1Sway] = 0.95
  p[CH.armL2Swing] = -1.35
  p[CH.armR1Swing] = -0.95
  p[CH.armR1Sway] = -0.95
  p[CH.armR2Swing] = -1.35
  p[CH.legL1Sway] = 0.16
  p[CH.legR1Sway] = -0.16
  p[CH.rootY] = (base[CH.rootY] || 0) + Math.abs(shake) * 0.1
}

/** The hair flip: a hand sweeps up through the hair and flicks it out, hip popped. */
function writeHairflip(p, base, u) {
  writeHips(p, u * 3, 0.5)
  const up = Math.min(1, u / 0.4)
  const flick = u > 0.4 ? Math.min(1, (u - 0.4) / 0.25) : 0
  const back = u > 0.7 ? (u - 0.7) / 0.3 : 0
  p[CH.armR1Swing] = (-2.7 + flick * 0.4) * up * (1 - back)
  p[CH.armR1Sway] = (-0.25 - flick * 0.85) * (1 - back)
  p[CH.armR2Swing] = -1.2 * up * (1 - flick) * (1 - back)
  p[CH.neckTwist] = 0.16 + flick * 0.4 * (1 - back)
  p[CH.neckSwing] = -0.06 - flick * 0.3 * (1 - back)
  p[CH.spineSway] = 0.09 + flick * 0.1
  p[CH.rootY] = (base[CH.rootY] > 0.5 ? base[CH.rootY] : 0) + flick * 0.1
}

/** Powering up as a new villain: rising, arms flung wide, head back. */
function writePowerUp(p, base, u) {
  p.set(base)
  const lift = Math.sin(Math.PI * Math.min(1, u))
  p[CH.rootY] = (base[CH.rootY] || 0) + lift * 1.6
  p[CH.armL1Swing] = -2.0
  p[CH.armL1Sway] = 1.0
  p[CH.armR1Swing] = -2.0
  p[CH.armR1Sway] = -1.0
  p[CH.armL2Swing] = -0.2
  p[CH.armR2Swing] = -0.2
  p[CH.spineSwing] = -0.3
  p[CH.neckSwing] = -0.55
  p[CH.legL1Swing] = -0.2
  p[CH.legL2Swing] = 0.5
  p[CH.legR1Swing] = 0.15
  p[CH.legR2Swing] = 0.35
}

function writeVictory(p, base, t) {
  p.set(base)
  const pump = Math.sin(t * 9) * 0.12
  p[CH.armL1Swing] = -2.9 + pump
  p[CH.armR1Swing] = -2.9 - pump
  p[CH.armL1Sway] = 0.35
  p[CH.armR1Sway] = -0.35
  p[CH.armL2Swing] = -0.25
  p[CH.armR2Swing] = -0.25
  p[CH.spineSwing] = -0.12
  p[CH.spineTwist] = 0
  p[CH.neckSwing] = -0.25
  p[CH.neckTwist] = 0
  p[CH.rootY] = Math.abs(Math.sin(t * 9)) * 0.25
}

/** Double-biceps flex, for level ups and rebirths. */
function writeFlex(p, base) {
  p.set(base)
  p[CH.armL1Swing] = -0.1
  p[CH.armR1Swing] = -0.1
  p[CH.armL1Sway] = 1.45
  p[CH.armR1Sway] = -1.45
  p[CH.armL2Sway] = 1.55
  p[CH.armR2Sway] = -1.55
  p[CH.armL2Swing] = 0
  p[CH.armR2Swing] = 0
  p[CH.spineSwing] = -0.06
  p[CH.spineTwist] = 0
  p[CH.neckTwist] = 0
  p[CH.neckSwing] = -0.12
  p[CH.legL1Sway] = 0.18
  p[CH.legR1Sway] = -0.18
  p[CH.legL1Swing] = 0
  p[CH.legR1Swing] = 0
  p[CH.rootY] = -0.08
}

/** Static statue poses for the villain pedestals. */
export function writeStatuePose(p, name) {
  const base = createPose()
  switch (name) {
    case 'salute':
      p.fill(0)
      p[CH.armR1Swing] = -1.7
      p[CH.armR1Sway] = 0.75
      p[CH.armR2Swing] = -2.2
      p[CH.armL1Sway] = -0.05
      p[CH.spineSwing] = -0.04
      break
    case 'fistUp':
      p.fill(0)
      p[CH.armR1Swing] = -2.95
      p[CH.armR1Sway] = -0.2
      p[CH.armR2Swing] = -0.15
      p[CH.armL1Sway] = 0.55
      p[CH.armL2Swing] = -1.3
      p[CH.armL2Sway] = -0.4
      p[CH.legL1Sway] = 0.12
      p[CH.legR1Sway] = -0.12
      p[CH.neckSwing] = -0.15
      break
    case 'ready':
      p.fill(0)
      p[CH.armL1Swing] = -0.45
      p[CH.armR1Swing] = -0.3
      p[CH.armL2Swing] = -0.9
      p[CH.armR2Swing] = -1.1
      p[CH.armL1Sway] = 0.15
      p[CH.armR1Sway] = -0.15
      p[CH.legL1Sway] = 0.18
      p[CH.legR1Sway] = -0.18
      p[CH.spineTwist] = 0.2
      p[CH.neckTwist] = -0.2
      break
    case 'flex':
      writeGuard(base, 0, 0)
      writeFlex(p, base)
      break
    case 'armsBack':
      p.fill(0)
      p[CH.armL1Swing] = 0.45
      p[CH.armR1Swing] = 0.45
      p[CH.armL1Sway] = -0.15
      p[CH.armR1Sway] = 0.15
      p[CH.armL2Swing] = 0.6
      p[CH.armR2Swing] = 0.6
      p[CH.spineSwing] = -0.08
      p[CH.neckSwing] = -0.1
      break
    case 'hips':
      writeHips(p, 0, 0)
      break
    case 'laugh':
      writeGuard(base, 0, 0)
      writeLaugh(p, base, 0)
      break
    case 'float':
      // Floating, both hands raised, casting.
      writeFloat(p, 0, 0)
      p[CH.armL1Swing] = -1.9
      p[CH.armL1Sway] = 0.55
      p[CH.armR1Swing] = -1.9
      p[CH.armR1Sway] = -0.55
      p[CH.armL2Swing] = -0.3
      p[CH.armR2Swing] = -0.3
      p[CH.neckSwing] = -0.2
      break
    case 'ninja':
      writeNinjaRun(p, 0.32, 1)
      break
    case 'superhero':
      writeGuard(base, 0, 0)
      writeLand(p, base)
      break
    case 'pounce':
      // Crouched to spring, claws out.
      writeBruteStance(p, 0, 0)
      p[CH.rootY] = -1.0
      p[CH.bodyPitch] = 0.35
      p[CH.legL1Swing] = -0.9
      p[CH.legL2Swing] = 1.4
      p[CH.legR1Swing] = -0.6
      p[CH.legR2Swing] = 1.3
      p[CH.armL1Swing] = -1.2
      p[CH.armR1Swing] = -1.0
      p[CH.armL2Swing] = -0.7
      p[CH.armR2Swing] = -0.9
      p[CH.neckSwing] = -0.5
      break
    case 'guard':
    default:
      writeGuard(p, 0, 0)
  }
}

/* --- Driver ----------------------------------------------------------------- */

const _base = createPose()
const _layer = createPose()
const _out = createPose()

/** Per-character animation state, owned by the avatar component. */
export function createAnimState() {
  return {
    moveBlend: 0,
    airBlend: 0,
    chargeBlend: 0,
    slamStart: -10,
    slamBroke: false,
    flipStart: -10,
    wasGrounded: true,
    tauntStart: -10,
    tauntKind: 'laugh',
    powerStart: -10,
    victoryStart: -10,
    flexStart: -10,
    lastStepPhase: 0,
  }
}

/**
 * Wall-slam timing, in seconds, shared with the physics in Player so the poses line
 * up with the body: the hit-stop against the wall, the flight back, the landing.
 */
export const SLAM_TIMING = { hit: 0.12, flight: 0.5, land: 0.42, burst: 0.55 }

/** How the villain moves when it has no style of its own. */
export const DEFAULT_STYLE = { stance: 'menace', run: 'sprint', taunt: 'laugh' }

const FLIP_TIME = 0.68
export const TAUNT_TIME = { laugh: 1.6, hairflip: 1.15, flex: 1.1 }
const POWER_TIME = 0.95

/** The villain's taunt (`kind` from its style) starts now. */
export function triggerTaunt(anim, time, kind) {
  anim.tauntKind = TAUNT_TIME[kind] ? kind : 'laugh'
  anim.tauntStart = time
}

/** Becoming a new villain: the power-up, then its taunt. */
export function triggerPowerUp(anim, time, style) {
  anim.powerStart = time
  triggerTaunt(anim, time + POWER_TIME, (style || DEFAULT_STYLE).taunt)
}

/** True while a taunt or power-up is playing (so idle taunts don't overlap). */
export function isPosing(anim, time) {
  return time - anim.powerStart < POWER_TIME || (time >= anim.tauntStart && time - anim.tauntStart < (TAUNT_TIME[anim.tauntKind] || 1.5))
}

/** A slam into a wall starts now; `broke` if the wall gave way. */
export function triggerSlam(anim, time, broke) {
  anim.slamStart = time
  anim.slamBroke = broke
}

const ramp = (t, len) => Math.min(1, Math.max(0, t / len))

/**
 * Poses the rig for this frame.
 *
 * @param {object} rig from collectRig
 * @param {{ time: number, speed: number, grounded: boolean, maxSpeed: number,
 *           vy?: number, charging?: boolean }} motion
 * @param {object} anim from createAnimState
 * @param {number} delta frame time in seconds
 * @returns {boolean} true on the frame a foot lands during a run (for step sounds)
 */
export function animateRig(rig, motion, anim, delta = 1 / 60) {
  if (!rig?.skeleton || !motion) return false
  const { time = 0, speed = 0, grounded = true, maxSpeed = 6, vy = 0, charging = false } = motion
  const style = motion.style || DEFAULT_STYLE
  const ratio = Math.min(speed / Math.max(maxSpeed, 0.001), 1)
  const T = SLAM_TIMING
  const knocking = time - anim.slamStart < T.hit + T.flight + 0.1

  // Leaving the ground on a jump (not a knockback): flip.
  if (anim.wasGrounded && !grounded && vy > 3 && !knocking) anim.flipStart = time
  anim.wasGrounded = grounded

  // Smooth the layer weights so poses never pop.
  const k = 1 - Math.pow(0.0005, delta)
  anim.moveBlend += ((ratio > 0.06 ? 1 : 0) - anim.moveBlend) * k
  anim.airBlend += ((grounded ? 0 : 1) - anim.airBlend) * Math.min(1, k * 1.5)
  anim.chargeBlend += ((charging ? 1 : 0) - anim.chargeBlend) * Math.min(1, k * 1.2)

  writeStance(_base, time, style.stance)
  let stepped = false
  if (anim.moveBlend > 0.001) {
    const phase = writeRunStyle(_layer, time, Math.max(ratio, 0.35), style.run)
    lerpPose(_base, _base, _layer, anim.moveBlend)
    const stepPhase = Math.sin(phase)
    if (ratio > 0.3 && grounded && Math.sign(stepPhase) !== Math.sign(anim.lastStepPhase)) {
      stepped = true
    }
    anim.lastStepPhase = stepPhase
  }
  // Floaters stay floating; everyone else takes the jump pose in the air.
  if (anim.airBlend > 0.001 && style.stance !== 'float') {
    writeAir(_layer, vy > 0)
    lerpPose(_base, _base, _layer, anim.airBlend)
  }
  const flipU = (time - anim.flipStart) / FLIP_TIME
  if (flipU >= 0 && flipU < 1 && !grounded) {
    writeFlip(_layer, flipU)
    _base.set(_layer)
  }
  if (anim.chargeBlend > 0.001) {
    writeCharge(_layer, _base)
    lerpPose(_base, _base, _layer, anim.chargeBlend)
  }

  _out.set(_base)

  // Taunts and the power-up play over the stance when standing (a run cancels them).
  const still = 1 - anim.moveBlend
  const pu = (time - anim.powerStart) / POWER_TIME
  if (pu >= 0 && pu < 1) {
    writePowerUp(_layer, _out, pu)
    lerpPose(_out, _out, _layer, Math.min(1, pu * 6, (1 - pu) * 6))
  }
  const tt = time - anim.tauntStart
  const tLen = TAUNT_TIME[anim.tauntKind] || 1.5
  if (tt >= 0 && tt < tLen && still > 0.05) {
    if (anim.tauntKind === 'hairflip') writeHairflip(_layer, _out, tt / tLen)
    else if (anim.tauntKind === 'flex') writeFlex(_layer, _out)
    else writeLaugh(_layer, _out, time)
    lerpPose(_out, _out, _layer, Math.min(1, tt / 0.15, (tLen - tt) / 0.25) * still)
  }

  // Wall slam: impact, then either the burst through or the knockback and landing.
  const since = time - anim.slamStart
  if (since >= 0 && since < T.hit) {
    writeSlam(_layer, _out)
    lerpPose(_out, _out, _layer, ramp(since, 0.04))
  } else if (anim.slamBroke && since >= T.hit && since < T.hit + T.burst) {
    const u = since - T.hit
    writeBurst(_layer, _out)
    lerpPose(_out, _out, _layer, Math.min(ramp(u, 0.08), 1 - ramp(u - T.burst + 0.2, 0.2)))
  } else if (!anim.slamBroke && since >= T.hit && since < T.hit + T.flight) {
    writeKnock(_layer, time, (since - T.hit) / T.flight)
    _out.set(_layer)
  } else if (!anim.slamBroke && since >= T.hit + T.flight && since < T.hit + T.flight + T.land) {
    const u = since - T.hit - T.flight
    writeLand(_layer, _out)
    lerpPose(_out, _out, _layer, 1 - ramp(u - T.land * 0.4, T.land * 0.6))
  }

  const vt = time - anim.victoryStart
  if (vt >= 0 && vt < 1.4) {
    const w = Math.min(1, vt / 0.15) * Math.min(1, (1.4 - vt) / 0.25)
    writeVictory(_layer, _out, vt)
    lerpPose(_out, _out, _layer, w)
  }

  const ft = time - anim.flexStart
  if (ft >= 0 && ft < 1.1) {
    const w = Math.min(1, ft / 0.15) * Math.min(1, (1.1 - ft) / 0.25)
    writeFlex(_layer, _out)
    lerpPose(_out, _out, _layer, w)
  }

  applyPose(rig, _out)
  return stepped
}
