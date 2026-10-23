import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, DoubleSide, Matrix4, Quaternion, RingGeometry, ShaderMaterial, Vector3 } from 'three'

import { VILLAIN_BY_ID } from '../../state/content'
import { useGameStore } from '../../state/gameStore'
import { events, nowSeconds, player } from '../../state/runtime'
import { LIFE, POOL, rings, spawnImpact, spawnSlam } from './impactPool'

const ringVertex = /* glsl */ `
  varying float vRadius;
  varying vec3 vColor;
  void main() {
    vRadius = length(position.xy);
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`
const ringFragment = /* glsl */ `
  varying float vRadius;
  varying vec3 vColor;
  void main() {
    // Bright leading edge fading inward; the instance colour carries the fade too.
    float edge = smoothstep(0.5, 1.0, vRadius);
    gl_FragColor = vec4(mix(vColor, vec3(1.0), edge * 0.45), edge);
  }
`

const _m = new Matrix4()
const _p = new Vector3()
const _s = new Vector3()
const _c = new Color()
const _black = new Color(0, 0, 0)
const _flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
const _upright = new Quaternion()
const _hidden = new Matrix4().makeScale(0, 0, 0)

/** The local villain's aura colour, for its slams. */
function slamColor() {
  const v = VILLAIN_BY_ID[useGameStore.getState().villain]
  return v?.aura?.color || v?.fx?.color || '#ffffff'
}

/**
 * Wall-slam shockwaves for every villain on screen (the pool is fx/impactPool.js):
 * one instanced draw call. Kept on every quality preset - it's the hit feedback - at
 * a handful of quads.
 */
export function ImpactFx() {
  const meshRef = useRef(null)
  const geometry = useMemo(() => new RingGeometry(0.62, 1, 40, 1), [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
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

  // Instance colours exist from the start, so the first slam doesn't recompile the shader.
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < POOL; i += 1) {
      mesh.setMatrixAt(i, _hidden)
      mesh.setColorAt(i, _black)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }, [])

  // The local villain's slams (the player is right against the wall face), and the
  // shockwave of becoming a new villain.
  useEffect(() => {
    const offs = [
      events.on('slam', ({ broke }) => spawnSlam(player.x, player.z, broke, slamColor())),
      events.on('transform', () => {
        const color = slamColor()
        spawnImpact(player.x, 0.06, player.z, 8, color, true)
        spawnImpact(player.x, 1.0, player.z, 4.5, color, true)
        setTimeout(() => spawnImpact(player.x, 0.06, player.z, 5, '#ffffff', true), 160)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const now = nowSeconds()
    for (let i = 0; i < POOL; i += 1) {
      const r = rings[i]
      const age = now - r.start
      if (age < 0 || age > LIFE) {
        mesh.setMatrixAt(i, _hidden)
        continue
      }
      const u = age / LIFE
      // Fast out, easing off; fades as it grows.
      const scale = (r.size / 2) * (0.25 + 0.75 * (1 - (1 - u) * (1 - u)))
      _p.set(r.x, r.y, r.z)
      _s.set(scale, scale, scale)
      mesh.setMatrixAt(i, _m.compose(_p, r.flat ? _flat : _upright, _s))
      mesh.setColorAt(i, _c.copy(r.color).multiplyScalar(1 - u))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={meshRef} args={[geometry, material, POOL]} frustumCulled={false} renderOrder={7} />
}

export default ImpactFx
