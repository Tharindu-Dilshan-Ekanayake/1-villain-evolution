import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  MeshLambertMaterial,
} from 'three'

import { events, nowSeconds } from '../../state/runtime'
import { WALL_HEIGHT, WALL_THICKNESS, WALL_WIDTH, wallZ } from '../layout'
import { usePreset } from '../quality'
import { WALLS } from '../sceneStyle'
import { createCrackTexture, createStudTexture } from '../textures'
import { mulberry32 } from '../world/kit'
import { crackColor } from './crackColor'
import { setUniform } from '../world/materials'
import { wallTint } from './wallTint'

/** Simultaneous breaks we can show; older ones are recycled. */
const POOL = 3
/** Seconds a break lasts, start of crack to last shard gone. */
const LIFE = 2.6

const W = WALL_WIDTH
const H = WALL_HEIGHT
const T = WALL_THICKNESS

/**
 * Pre-fractures a wall into triangular prisms on a jittered grid. Shards tile the
 * wall exactly and carry the wall's own brick UVs, so swapping the wall for its
 * shards is seamless. Each vertex knows its shard's centre and a random vector; the
 * vertex shader does all the motion.
 */
function buildShards(cols, rows, seed = 9) {
  const rand = mulberry32(seed)
  const gx = cols + 1
  const pts = []
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const edgeX = c === 0 || c === cols
      const edgeY = r === 0 || r === rows
      let x = -W / 2 + (c / cols) * W
      let y = (r / rows) * H
      if (!edgeX) x += (rand() - 0.5) * (W / cols) * 0.7
      if (!edgeY) y += (rand() - 0.5) * (H / rows) * 0.7
      pts.push([x, y])
    }
  }
  const tris = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = pts[r * gx + c]
      const b = pts[r * gx + c + 1]
      const d = pts[(r + 1) * gx + c]
      const e = pts[(r + 1) * gx + c + 1]
      if (rand() < 0.5) tris.push([a, b, e], [a, e, d])
      else tris.push([a, b, d], [b, e, d])
    }
  }

  const positions = []
  const normals = []
  const uvs = []
  const colors = []
  const centers = []
  const rnds = []
  const pushVertex = (x, y, z, nx, ny, nz, shade, cx, cy, rnd) => {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    uvs.push((x + W / 2) / 4, y / 4)
    colors.push(shade, shade, shade)
    centers.push(cx, cy, 0)
    rnds.push(rnd[0], rnd[1], rnd[2])
  }
  for (const [p0, p1, p2] of tris) {
    const cx = (p0[0] + p1[0] + p2[0]) / 3
    const cy = (p0[1] + p1[1] + p2[1]) / 3
    const rnd = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]
    // Winding so the front face (+z, towards the player) is counter-clockwise.
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
    const [q0, q1, q2] = cross > 0 ? [p0, p1, p2] : [p0, p2, p1]
    for (const q of [q0, q1, q2]) pushVertex(q[0], q[1], T / 2, 0, 0, 1, 1, cx, cy, rnd)
    for (const q of [q0, q2, q1]) pushVertex(q[0], q[1], -T / 2, 0, 0, -1, 0.85, cx, cy, rnd)
    // Sides: darker, like the inside of broken brick.
    const ring = [q0, q1, q2]
    for (let k = 0; k < 3; k += 1) {
      const a = ring[k]
      const b = ring[(k + 1) % 3]
      let nx = b[1] - a[1]
      let ny = -(b[0] - a[0])
      const len = Math.hypot(nx, ny) || 1
      nx /= len
      ny /= len
      pushVertex(a[0], a[1], T / 2, nx, ny, 0, 0.62, cx, cy, rnd)
      pushVertex(a[0], a[1], -T / 2, nx, ny, 0, 0.62, cx, cy, rnd)
      pushVertex(b[0], b[1], -T / 2, nx, ny, 0, 0.62, cx, cy, rnd)
      pushVertex(a[0], a[1], T / 2, nx, ny, 0, 0.62, cx, cy, rnd)
      pushVertex(b[0], b[1], -T / 2, nx, ny, 0, 0.62, cx, cy, rnd)
      pushVertex(b[0], b[1], T / 2, nx, ny, 0, 0.62, cx, cy, rnd)
    }
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  g.setAttribute('aCenter', new BufferAttribute(new Float32Array(centers), 3))
  g.setAttribute('aRand', new BufferAttribute(new Float32Array(rnds), 3))
  g.setAttribute('iStart', new InstancedBufferAttribute(new Float32Array(POOL).fill(-1000), 1))
  g.setAttribute('iStyle', new InstancedBufferAttribute(new Float32Array(POOL), 1))
  g.setAttribute('iImpact', new InstancedBufferAttribute(new Float32Array(POOL * 2), 2))
  return g
}

/**
 * Standard Lambert lighting with the shard motion injected. Three break styles, picked
 * per break:
 *   0 blast    - knocked back down the track, fanning out from the slam
 *   1 collapse - the wall crumbles straight down, bottom first
 *   2 explode  - bursts outward in every direction
 * Cracks run outward from the impact: shards nearer the slam let go first.
 */
function createShardMaterial(map, crackMap) {
  const material = new MeshLambertMaterial({ map, vertexColors: true })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    shader.uniforms.uCrackMap = { value: crackMap }
    shader.uniforms.uCrackColor = { value: crackColor }
    material.userData.shader = shader
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aCenter;
        attribute vec3 aRand;
        attribute float iStart;
        attribute float iStyle;
        attribute vec2 iImpact;
        uniform float uTime;
        varying float vT;
        varying vec2 vCrackUv;
        vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
          float c = cos(angle);
          float s = sin(angle);
          return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
        }
        vec3 shardVelocity(vec3 fromImpact) {
          vec3 r = aRand;
          vec2 radial = normalize(fromImpact.xy + vec2(0.001));
          if (iStyle < 0.5) {
            return vec3(radial.x * 2.6 + r.x * 1.4, 1.5 + radial.y * 2.0 + r.y * 2.5, -(7.0 + r.z * 3.0));
          } else if (iStyle < 1.5) {
            return vec3(r.x * 1.1, -0.4 + r.y * 0.6, -(0.6 + abs(r.z) * 1.4));
          }
          return vec3(radial.x * 6.5 + r.x * 2.0, 2.5 + radial.y * 4.5 + r.y * 2.0, -(2.0 + r.z * 3.5));
        }
        float shardDelay(vec3 fromImpact) {
          if (iStyle > 0.5 && iStyle < 1.5) return (1.0 - aCenter.y / ${H.toFixed(1)}) * 0.35;
          return length(fromImpact.xy) * 0.028;
        }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 fromImpact0 = aCenter - vec3(iImpact, 0.0);
        float tRaw = uTime - iStart;
        float tLocal = max(0.0, tRaw - shardDelay(fromImpact0));
        vec3 vel0 = shardVelocity(fromImpact0);
        float G = 22.0;
        float floorY = 0.25;
        float tLand = (vel0.y + sqrt(max(0.0, vel0.y * vel0.y + 2.0 * G * (aCenter.y - floorY)))) / G;
        float tFly = min(tLocal, tLand);
        vec3 axis0 = normalize(aRand + vec3(0.01, 0.02, 0.03));
        float spin = (4.0 + abs(aRand.x) * 9.0) * (iStyle > 0.5 && iStyle < 1.5 ? 0.45 : 1.0);
        float angle = spin * (tFly + 0.15 * max(0.0, tLocal - tLand));
        vec3 objectNormal = rotateAxis(normal, axis0, angle);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 c = aCenter + vel0 * tFly + vec3(0.0, -0.5 * G * tFly * tFly, 0.0);
        c.xz += vel0.xz * 0.12 * min(max(0.0, tLocal - tLand), 0.6);
        c.y = max(c.y, floorY);
        // A hair of separation the moment a shard cracks loose.
        c.z += step(0.0001, tLocal) * 0.04;
        float shrink = 1.0 - smoothstep(${(LIFE - 0.7).toFixed(2)}, ${LIFE.toFixed(2)}, tRaw);
        if (tRaw < 0.0 || tRaw > ${LIFE.toFixed(2)}) shrink = 0.0;
        vec3 transformed = c + rotateAxis(position - aCenter, axis0, angle) * shrink;
        vT = tRaw;
        vCrackUv = vec2(position.x / ${W.toFixed(1)} + 0.5, position.y / ${H.toFixed(1)});`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uCrackMap;
        uniform vec3 uCrackColor;
        varying float vT;
        varying vec2 vCrackUv;
        float shardCrack;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        shardCrack = texture2D(uCrackMap, vCrackUv).g;
        diffuseColor.rgb *= 1.0 - shardCrack * 0.8;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // The wall's glowing cracks flare as it gives way, then fade.
        totalEmissiveRadiance += uCrackColor * shardCrack * (1.0 - smoothstep(0.0, 0.6, vT)) * 1.6;`,
      )
  }
  material.customProgramCacheKey = () => 'villain-wall-shards'
  return material
}

const _m = new Matrix4()
const _tint = new Color()

/**
 * The wall-break effect: when a wall breaks it is swapped for its shards, which crack
 * apart from the slam and tumble down the track. One instanced mesh (a pool of three
 * breaks), animated entirely in the vertex shader - no per-frame CPU work besides one
 * uniform.
 */
export function Shatter() {
  const preset = usePreset()
  const meshRef = useRef(null)
  // The walls are twice as wide as tall: twice the columns of rows.
  const cols = preset.name === 'LOW' ? 8 : preset.name === 'MEDIUM' ? 11 : 14
  const rows = preset.name === 'LOW' ? 4 : preset.name === 'MEDIUM' ? 5 : 7

  const textures = useMemo(
    () => ({
      brick: createStudTexture({ base: WALLS.base, alt: WALLS.alt, studsPerCell: 4, size: Math.min(512, preset.textureSize) }),
      crack: createCrackTexture(Math.min(512, preset.textureSize)),
    }),
    [preset.textureSize],
  )
  const geometry = useMemo(() => buildShards(cols, rows), [cols, rows])
  const material = useMemo(() => createShardMaterial(textures.brick, textures.crack), [textures])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(
    () => () => {
      material.dispose()
      textures.brick.dispose()
      textures.crack.dispose()
    },
    [material, textures],
  )

  useEffect(() => {
    let next = 0
    return events.on('wallBreak', ({ index, impactX = 0 }) => {
      const mesh = meshRef.current
      if (!mesh) return
      const slot = next
      next = (next + 1) % POOL
      _m.makeTranslation(0, 0, wallZ(index))
      mesh.setMatrixAt(slot, _m)
      mesh.instanceMatrix.needsUpdate = true
      mesh.setColorAt(slot, wallTint(index, _tint))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      const start = geometry.getAttribute('iStart')
      const style = geometry.getAttribute('iStyle')
      const impact = geometry.getAttribute('iImpact')
      start.setX(slot, nowSeconds())
      style.setX(slot, Math.floor(Math.random() * 3))
      impact.setXY(slot, Math.max(-W / 2 + 1, Math.min(W / 2 - 1, impactX)), 1.6)
      start.needsUpdate = true
      style.needsUpdate = true
      impact.needsUpdate = true
    })
  }, [geometry])

  useFrame(() => {
    setUniform(meshRef.current?.material.userData.shader, 'uTime', nowSeconds())
  })

  return (
    <instancedMesh
      key={`${cols}x${rows}`}
      ref={meshRef}
      args={[geometry, material, POOL]}
      // No shadow: the shadow pass doesn't run the shard motion.
      frustumCulled={false}
    />
  )
}

export default Shatter
