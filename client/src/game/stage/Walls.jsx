import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, Color, InstancedBufferAttribute, MeshLambertMaterial, Object3D } from 'three'

import { formatNumber, STAGE_COUNT } from '../../state/economy'
import { events, firstStandingWall, nowSeconds, stageRun } from '../../state/runtime'
import { createLabel } from '../labels'
import { WALL_HEIGHT, WALL_THICKNESS, WALL_WIDTH, wallZ } from '../layout'
import { useColliders } from '../physics'
import { usePreset } from '../quality'
import { WALLS } from '../sceneStyle'
import { createCrackTexture, createStudTexture } from '../textures'
import { crackColor, useCrackColor } from './crackColor'
import { wallTint } from './wallTint'

const _dummy = new Object3D()
const _tint = new Color()
const N = STAGE_COUNT

/** Each stage has its own brick colour. */
function paintTints(mesh) {
  for (let g = 0; g < N; g += 1) mesh.setColorAt(g, wallTint(g, _tint))
  mesh.instanceColor.needsUpdate = true
}

/**
 * Adds the crack reveal to a standard material. Per instance `aDamage` (0..1) shows
 * every crack whose threshold (R) is below it; fresh cracks glow in the villain's colour.
 */
function createWallMaterial(map, crackMap) {
  const material = new MeshLambertMaterial({ map })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrackMap = { value: crackMap }
    shader.uniforms.uCrackColor = { value: crackColor }
    shader.uniforms.uWallSize = { value: [WALL_WIDTH, WALL_HEIGHT] }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aDamage;
         uniform vec2 uWallSize;
         varying float vDamage;
         varying vec2 vCrackUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vDamage = aDamage;
         vCrackUv = position.xy / uWallSize + 0.5;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uCrackMap;
         uniform vec3 uCrackColor;
         varying float vDamage;
         varying vec2 vCrackUv;
         float crackAmount;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec4 ck = texture2D(uCrackMap, vCrackUv);
         crackAmount = ck.g * step(ck.r, vDamage);
         diffuseColor.rgb *= 1.0 - crackAmount * 0.82;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uCrackColor * crackAmount * (0.35 + vDamage * 0.9);`,
      )
  }
  // Separate program from other standard materials.
  material.customProgramCacheKey = () => 'villain-wall-cracks'
  return material
}

/**
 * Every stage's breakable wall, as one instanced mesh. Damage, HP and broken state
 * live in `stageRun` (mutated by the gameplay tick); this component only reflects
 * them. One HP bar label rides on the next wall to break.
 */
export function Walls() {
  const preset = usePreset()
  useCrackColor()
  const meshRef = useRef(null)
  const [broken, setBroken] = useState(() => Array.from(stageRun.broken, Boolean))

  const textures = useMemo(
    () => ({
      brick: createStudTexture({
        base: WALLS.base,
        alt: WALLS.alt,
        studsPerCell: 4,
        size: Math.min(512, preset.textureSize),
      }),
      crack: createCrackTexture(Math.min(512, preset.textureSize)),
    }),
    [preset.textureSize],
  )
  const geometry = useMemo(() => {
    const g = new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_THICKNESS)
    // Brick UVs in world units (4 m per texture tile) on the faces you see.
    const uv = g.getAttribute('uv')
    const normal = g.getAttribute('normal')
    for (let i = 0; i < uv.count; i += 1) {
      const isSide = Math.abs(normal.getX(i)) > 0.5 || Math.abs(normal.getY(i)) > 0.5
      const w = isSide ? WALL_THICKNESS : WALL_WIDTH
      uv.setXY(i, (uv.getX(i) * w) / 4, (uv.getY(i) * WALL_HEIGHT) / 4)
    }
    g.setAttribute('aDamage', new InstancedBufferAttribute(new Float32Array(N), 1))
    return g
  }, [])
  const material = useMemo(() => createWallMaterial(textures.brick, textures.crack), [textures])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(
    () => () => {
      material.dispose()
      textures.brick.dispose()
      textures.crack.dispose()
    },
    [material, textures],
  )

  // One HP bar on the next wall to break (the STAGE sign above it is StageLine's).
  useEffect(() => {
    const label = createLabel({
      position: [0, 4.6, wallZ(0) + WALL_THICKNESS / 2 + 0.05],
      className: 'wall-label',
      // Shown once you're through the gate; from spawn it would sit behind the top HUD.
      maxDistance: 55,
      refDistance: 9,
      maxScale: 1.6,
    })
    const render = () => {
      const g = firstStandingWall()
      label.setHidden(g >= N)
      if (g >= N) return
      label.setPosition(0, 4.6, wallZ(g) + WALL_THICKNESS / 2 + 0.05)
      const max = stageRun.maxHp[g]
      const hp = stageRun.hp[g]
      const pct = Math.max(0, Math.min(100, (hp / max) * 100))
      label.setHtml(
        `<div class="hp-bar"><div class="hp-fill" style="width:${pct.toFixed(
          1,
        )}%"></div><div class="hp-text">${formatNumber(hp)} / ${formatNumber(max)}</div></div>`,
      )
    }
    render()
    const offs = [
      events.on('wallHit', render),
      events.on('wallBreak', () => {
        render()
        setBroken(Array.from(stageRun.broken, Boolean))
      }),
      events.on('runReset', () => {
        render()
        setBroken(Array.from(stageRun.broken, Boolean))
      }),
    ]
    return () => {
      offs.forEach((off) => off())
      label.remove()
    }
  }, [])

  // Instance transforms, tints and damage. Broken walls scale to zero.
  const lastDamage = useRef(new Float32Array(N).fill(-1))
  const shaking = useRef(new Uint8Array(N))
  /** 0 = not written yet, 1 = standing, 2 = hidden. */
  const shown = useRef(new Uint8Array(N))
  /** The mesh the per-instance data above was written to. */
  const writtenTo = useRef(null)

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    // R3F builds a new mesh when the material changes (a quality preset switch), and
    // a new InstancedMesh has every wall at the origin - the middle of the lobby.
    // Rewrite every instance whenever the mesh is a different one.
    if (writtenTo.current !== mesh) {
      writtenTo.current = mesh
      shown.current.fill(0)
      lastDamage.current.fill(-1)
      paintTints(mesh)
    }
    const now = nowSeconds()
    const damageAttr = geometry.getAttribute('aDamage')
    let matrixDirty = false
    let damageDirty = false

    for (let i = 0; i < N; i += 1) {
      const isBroken = stageRun.broken[i] === 1
      const sinceHit = now - stageRun.hitAt[i]
      const shake = !isBroken && sinceHit < 0.18
      const desired = isBroken ? 2 : 1
      if (shake || shaking.current[i] || shown.current[i] !== desired) {
        const amp = shake ? (0.18 - sinceHit) * 0.6 : 0
        _dummy.position.set(Math.sin(now * 90 + i) * amp, WALL_HEIGHT / 2, wallZ(i) + Math.cos(now * 70) * amp * 0.5)
        _dummy.rotation.set(0, 0, Math.sin(now * 60) * amp * 0.05)
        const s = isBroken ? 0 : 1
        _dummy.scale.set(s, s, s)
        _dummy.updateMatrix()
        mesh.setMatrixAt(i, _dummy.matrix)
        matrixDirty = true
        shaking.current[i] = shake ? 1 : 0
        shown.current[i] = desired
      }
      const d = isBroken ? 1 : stageRun.damage[i]
      if (d !== lastDamage.current[i]) {
        damageAttr.setX(i, d)
        lastDamage.current[i] = d
        damageDirty = true
      }
    }
    if (matrixDirty) mesh.instanceMatrix.needsUpdate = true
    if (damageDirty) damageAttr.needsUpdate = true
  })

  // Walls break in order, so only the next standing wall can be reached: it is the
  // only one that needs a collider.
  const next = broken.indexOf(false)
  useColliders(() => (next < 0 ? [] : [{ box: [0, wallZ(next), WALL_WIDTH / 2 + 0.5, WALL_THICKNESS / 2] }]), [next])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, N]}
      castShadow
      receiveShadow
      // Instances span the whole tunnel; per-instance culling isn't worth it here.
      frustumCulled={false}
    />
  )
}

export default Walls
