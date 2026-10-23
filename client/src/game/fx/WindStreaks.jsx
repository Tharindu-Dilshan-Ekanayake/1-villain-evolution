import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'

import { player } from '../../state/runtime'
import { setUniform } from '../world/materials'
import { speedFx } from './speedFx'

/** Ribbons in the pool, and where they appear around the runner (m). */
const POOL = 36
const AHEAD = [10, 24]
const SIDE = [1.3, 4.6]
const HEIGHT = [0.2, 2.9]
/** Gone once this far behind. */
const BEHIND = -7
/** Ribbon length (m) at the start and at full speed. */
const LENGTH = [1.6, 5.5]

const VERTEX = /* glsl */ `
  attribute vec2 aRibbon;
  attribute float aFade;
  varying vec2 vRibbon;
  varying float vFade;
  void main() {
    vRibbon = aRibbon;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`
const FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uLevel;
  varying vec2 vRibbon;
  varying float vFade;
  void main() {
    // Brightest in the middle of its length, a white core down its centre.
    float along = sin(vRibbon.x * 3.14159);
    float core = 1.0 - abs(vRibbon.y);
    vec3 c = mix(uTint, vec3(1.0), core * core * 0.7);
    float a = along * core * vFade * uLevel * 1.4;
    if (a < 0.004) discard;
    gl_FragColor = vec4(c, a);
  }
`

/** Two crossed ribbons along +Z (0..1), so it reads from any angle. */
function buildRibbon() {
  const w = 0.075
  const positions = []
  const ribbon = []
  const quad = (a, b, c, d) => {
    for (const [p, uv] of [[a, [0, -1]], [b, [0, 1]], [c, [1, 1]], [a, [0, -1]], [c, [1, 1]], [d, [1, -1]]]) {
      positions.push(...p)
      ribbon.push(...uv)
    }
  }
  quad([0, -w, 0], [0, w, 0], [0, w, 1], [0, -w, 1])
  quad([-w, 0, 0], [w, 0, 0], [w, 0, 1], [-w, 0, 1])
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('aRibbon', new BufferAttribute(new Float32Array(ribbon), 2))
  return g
}

const rand = (range) => range[0] + Math.random() * (range[1] - range[0])

const _m = new Matrix4()
const _p = new Vector3()
const _s = new Vector3()
const _q = new Quaternion()
const _up = new Vector3(0, 1, 0)
const _hidden = new Matrix4().makeScale(0, 0, 0)

/**
 * Wind ribbons (MEDIUM / HIGH): when you run fast, glowing streaks in your aura's
 * colour appear ahead on both sides and rush past you, stretching with speed - the
 * 3D half of the speed effect. One instanced draw call, a fixed pool, no allocations.
 */
export function WindStreaks() {
  const meshRef = useRef(null)
  const pool = useRef(
    Array.from({ length: POOL }, () => ({ along: BEHIND - 1, side: 0, height: 0, fade: 0 })),
  )
  const geometry = useMemo(() => {
    const g = buildRibbon()
    g.setAttribute('aFade', new InstancedBufferAttribute(new Float32Array(POOL), 1))
    return g
  }, [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTint: { value: speedFx.tint }, uLevel: { value: 0 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const level = speedFx.level
    const on = level > 0.05
    if (mesh.visible !== on) mesh.visible = on
    const ribbons = pool.current
    if (!on) {
      for (let i = 0; i < POOL; i += 1) ribbons[i].along = BEHIND - 1
      return
    }
    const dt = Math.min(delta, 0.1)
    setUniform(material, 'uLevel', Math.min(1, level * 1.3))
    const fade = geometry.getAttribute('aFade')
    // Along the way the runner faces; ribbons rush back past at more than their speed.
    const dirX = Math.sin(player.yaw)
    const dirZ = Math.cos(player.yaw)
    const rush = player.speed * 0.9 + 8
    const length = LENGTH[0] + (LENGTH[1] - LENGTH[0]) * level
    _q.setFromAxisAngle(_up, player.yaw)
    for (let i = 0; i < POOL; i += 1) {
      const s = ribbons[i]
      s.along -= rush * dt
      if (s.along < BEHIND) {
        // Respawn ahead, on a random side; more of them the faster you go.
        s.along = Math.random() < 0.35 + 0.65 * level ? rand(AHEAD) : BEHIND - 1
        s.side = (Math.random() < 0.5 ? -1 : 1) * rand(SIDE)
        s.height = rand(HEIGHT)
        s.fade = 0
      }
      if (s.along < BEHIND) {
        mesh.setMatrixAt(i, _hidden)
        continue
      }
      s.fade = Math.min(1, s.fade + dt * 4)
      // Right of the runner is (dirZ, -dirX).
      _p.set(player.x + dirX * s.along + dirZ * s.side, s.height, player.z + dirZ * s.along - dirX * s.side)
      _s.set(1, 1, length)
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s))
      fade.setX(i, s.fade * Math.min(1, (s.along - BEHIND) / 4))
    }
    mesh.instanceMatrix.needsUpdate = true
    fade.needsUpdate = true
  })

  return <instancedMesh ref={meshRef} args={[geometry, material, POOL]} frustumCulled={false} renderOrder={6} />
}

export default WindStreaks
