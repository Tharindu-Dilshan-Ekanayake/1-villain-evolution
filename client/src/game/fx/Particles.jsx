import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial } from 'three'

import { VILLAIN_BY_ID } from '../../state/content'
import { events, player } from '../../state/runtime'
import { padX, padZ, WALL_HEIGHT, WALL_THICKNESS, WALL_WIDTH, wallZ } from '../layout'
import { usePreset } from '../quality'

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute float aShape;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vShape;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vShape = aShape;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const fragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  varying float vShape;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float a;
    if (vShape > 0.5) {
      // Confetti: a little square.
      a = step(max(abs(p.x), abs(p.y)), 0.32);
    } else {
      a = smoothstep(0.5, 0.0, length(p));
    }
    if (a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <colorspace_fragment>
  }
`

/**
 * A fixed-size particle pool drawn as one Points object. `additive` pools are for
 * sparks and glows, normal pools for dust and confetti.
 */
function createPool(capacity, additive) {
  const geometry = new BufferGeometry()
  const pos = new Float32Array(capacity * 3)
  const size = new Float32Array(capacity)
  const alpha = new Float32Array(capacity)
  const color = new Float32Array(capacity * 3)
  const shape = new Float32Array(capacity)
  geometry.setAttribute('position', new BufferAttribute(pos, 3))
  geometry.setAttribute('aSize', new BufferAttribute(size, 1))
  geometry.setAttribute('aAlpha', new BufferAttribute(alpha, 1))
  geometry.setAttribute('aColor', new BufferAttribute(color, 3))
  geometry.setAttribute('aShape', new BufferAttribute(shape, 1))
  const material = new ShaderMaterial({
    uniforms: { uScale: { value: 300 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false
  return {
    capacity,
    points,
    geometry,
    material,
    pos,
    size,
    alpha,
    color,
    shape,
    vel: new Float32Array(capacity * 3),
    life: new Float32Array(capacity),
    age: new Float32Array(capacity),
    baseSize: new Float32Array(capacity),
    gravity: new Float32Array(capacity),
    drag: new Float32Array(capacity),
    next: 0,
    active: 0,
  }
}

const _c = new Color()

function spawn(pool, { x, y, z, vx = 0, vy = 0, vz = 0, life = 1, size = 1, color = '#ffffff', gravity = 0, drag = 0, square = false }) {
  const i = pool.next
  pool.next = (pool.next + 1) % pool.capacity
  pool.pos[i * 3] = x
  pool.pos[i * 3 + 1] = y
  pool.pos[i * 3 + 2] = z
  pool.vel[i * 3] = vx
  pool.vel[i * 3 + 1] = vy
  pool.vel[i * 3 + 2] = vz
  pool.life[i] = life
  pool.age[i] = 0
  pool.baseSize[i] = size
  pool.gravity[i] = gravity
  pool.drag[i] = drag
  pool.shape[i] = square ? 1 : 0
  _c.set(color)
  pool.color[i * 3] = _c.r
  pool.color[i * 3 + 1] = _c.g
  pool.color[i * 3 + 2] = _c.b
  pool.active = Math.max(pool.active, 1)
}

const rand = (a, b) => a + Math.random() * (b - a)
const pick = (list) => list[Math.floor(Math.random() * list.length)]

const SPARK_COLORS = ['#d17bff', '#ffffff', '#a52cff', '#ffe066']
const CONFETTI = ['#ff4d6d', '#ffd23f', '#41e05a', '#3fd0f2', '#a52cff', '#ffffff']

/**
 * Particle effects driven by gameplay events: slam sparks, wall dust (yours and
 * other players'), win-pad confetti, treadmill sparks, level-up sparkles and the
 * rebirth burst. Not mounted at all on LOW.
 */
export function Particles() {
  const preset = usePreset()
  const capacity = preset.name === 'HIGH' ? 256 : 128

  const pools = useMemo(
    () => ({ glow: createPool(capacity, true), dust: createPool(capacity, false) }),
    [capacity],
  )
  useEffect(
    () => () => {
      for (const pool of Object.values(pools)) {
        pool.geometry.dispose()
        pool.material.dispose()
      }
    },
    [pools],
  )

  useEffect(() => {
    const { glow, dust } = pools
    const offs = [
      events.on('wallHit', ({ index }) => {
        const z = wallZ(index) + WALL_THICKNESS / 2 + 0.1
        const n = 16
        for (let k = 0; k < n; k += 1) {
          spawn(glow, {
            x: player.x + rand(-0.4, 0.4),
            y: player.y + rand(0.1, 0.8),
            z,
            vx: rand(-4, 4),
            vy: rand(-1, 4),
            vz: rand(1, 5),
            life: rand(0.25, 0.5),
            size: rand(0.25, 0.5),
            color: pick(SPARK_COLORS),
            gravity: -8,
            drag: 2,
          })
        }
        for (let k = 0; k < 3; k += 1) {
          spawn(dust, {
            x: player.x + rand(-0.5, 0.5),
            y: player.y + rand(-0.2, 0.8),
            z: z + 0.2,
            vx: rand(-1, 1),
            vy: rand(0, 1),
            vz: rand(0.5, 1.5),
            life: rand(0.6, 1),
            size: rand(0.6, 1.1),
            color: '#d9b98a',
            drag: 1.5,
          })
        }
      }),
      events.on('wallBreak', ({ index }) => {
        const z = wallZ(index)
        for (let k = 0; k < 46; k += 1) {
          spawn(dust, {
            x: rand(-WALL_WIDTH / 2, WALL_WIDTH / 2),
            y: rand(0.2, WALL_HEIGHT),
            z: z + rand(-1, 1),
            vx: rand(-2, 2),
            vy: rand(-0.5, 2),
            vz: rand(-5, 1),
            life: rand(1.1, 1.9),
            size: rand(1.6, 3),
            color: pick(['#d9b98a', '#c4955c', '#e8d2a8']),
            drag: 1.2,
          })
        }
        for (let k = 0; k < 26; k += 1) {
          spawn(glow, {
            x: rand(-WALL_WIDTH / 2, WALL_WIDTH / 2),
            y: rand(0.5, WALL_HEIGHT),
            z,
            vx: rand(-6, 6),
            vy: rand(0, 7),
            vz: rand(-8, 3),
            life: rand(0.4, 0.9),
            size: rand(0.3, 0.6),
            color: pick(SPARK_COLORS),
            gravity: -12,
            drag: 1,
          })
        }
      }),
      events.on('padClaim', ({ stage }) => {
        const x = padX()
        const z = padZ(stage)
        for (let k = 0; k < 60; k += 1) {
          spawn(dust, {
            x: x + rand(-1, 1),
            y: rand(0.3, 1.5),
            z: z + rand(-1, 1),
            vx: rand(-3, 3),
            vy: rand(5, 11),
            vz: rand(-3, 3),
            life: rand(1.4, 2.2),
            size: rand(0.25, 0.42),
            color: pick(CONFETTI),
            gravity: -9,
            drag: 1.4,
            square: true,
          })
        }
      }),
      events.on('levelUp', () => {
        for (let k = 0; k < 22; k += 1) {
          const a = (k / 22) * Math.PI * 2
          spawn(glow, {
            x: player.x + Math.cos(a) * 0.6,
            y: player.y - 0.7,
            z: player.z + Math.sin(a) * 0.6,
            vx: Math.cos(a) * 2.5,
            vy: rand(2, 4),
            vz: Math.sin(a) * 2.5,
            life: rand(0.6, 0.9),
            size: rand(0.35, 0.55),
            color: pick(['#ffe066', '#ffd23f', '#ffffff']),
            drag: 2.5,
          })
        }
      }),
      // Becoming a villain: a fountain of its aura colours.
      events.on('transform', ({ id }) => {
        const v = VILLAIN_BY_ID[id]
        const colors = [v?.aura?.color || v?.fx?.color || '#ffffff', v?.aura?.core || '#ffffff', '#ffffff']
        for (let k = 0; k < 70; k += 1) {
          const a = Math.random() * Math.PI * 2
          const s = rand(2, 7)
          spawn(glow, {
            x: player.x + Math.cos(a) * 0.4,
            y: player.y - 0.6 + rand(0, 1.4),
            z: player.z + Math.sin(a) * 0.4,
            vx: Math.cos(a) * s,
            vy: rand(3, 10),
            vz: Math.sin(a) * s,
            life: rand(0.7, 1.4),
            size: rand(0.35, 0.8),
            color: pick(colors),
            gravity: -5,
            drag: 1.8,
          })
        }
      }),
      events.on('rebirth', () => {
        for (let k = 0; k < 90; k += 1) {
          const a = Math.random() * Math.PI * 2
          const s = rand(3, 9)
          spawn(glow, {
            x: player.x,
            y: player.y,
            z: player.z,
            vx: Math.cos(a) * s,
            vy: rand(2, 9),
            vz: Math.sin(a) * s,
            life: rand(0.8, 1.6),
            size: rand(0.4, 0.9),
            color: pick(['#a52cff', '#d17bff', '#ffd23f', '#ffffff']),
            gravity: -4,
            drag: 1.6,
          })
        }
      }),
      // Another player smashed a wall: a burst of brick dust where they stand.
      events.on('remoteBreak', ({ x, z }) => {
        for (let k = 0; k < 24; k += 1) {
          spawn(dust, {
            x: x + rand(-3, 3),
            y: rand(0.3, 5),
            z: z + rand(-1, 1),
            vx: rand(-2, 2),
            vy: rand(-0.5, 2),
            vz: rand(-4, 1),
            life: rand(0.9, 1.5),
            size: rand(1.2, 2.4),
            color: pick(['#d9b98a', '#c4955c', '#e8d2a8']),
            drag: 1.2,
          })
        }
      }),
      // Every paid-out step on a treadmill kicks sparks off the belt behind you.
      events.on('gain', ({ pad, steps } = {}) => {
        if (!pad) return
        const yaw = player.yaw
        const n = Math.min(6, 2 * steps)
        for (let k = 0; k < n; k += 1) {
          spawn(glow, {
            x: player.x - Math.sin(yaw) * 0.5 + rand(-0.3, 0.3),
            y: 0.15,
            z: player.z - Math.cos(yaw) * 0.5 + rand(-0.3, 0.3),
            vx: -Math.sin(yaw) * rand(2, 4),
            vy: rand(0.5, 2.5),
            vz: -Math.cos(yaw) * rand(2, 4),
            life: rand(0.25, 0.45),
            size: rand(0.2, 0.36),
            color: pick(['#ffe066', '#ffffff', '#ffd23f']),
            gravity: -6,
            drag: 2,
          })
        }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [pools])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const scale = state.size.height * 0.9
    for (const pool of Object.values(pools)) {
      if (!pool.active) continue
      pool.material.uniforms.uScale.value = scale
      let alive = 0
      for (let i = 0; i < pool.capacity; i += 1) {
        if (pool.age[i] >= pool.life[i]) {
          if (pool.alpha[i] !== 0) {
            pool.alpha[i] = 0
            pool.size[i] = 0
          }
          continue
        }
        alive += 1
        pool.age[i] += dt
        const o = i * 3
        const damp = Math.max(0, 1 - pool.drag[i] * dt)
        pool.vel[o] *= damp
        pool.vel[o + 1] = pool.vel[o + 1] * damp + pool.gravity[i] * dt
        pool.vel[o + 2] *= damp
        pool.pos[o] += pool.vel[o] * dt
        pool.pos[o + 1] += pool.vel[o + 1] * dt
        pool.pos[o + 2] += pool.vel[o + 2] * dt
        const t = pool.age[i] / pool.life[i]
        pool.alpha[i] = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9
        pool.size[i] = pool.baseSize[i] * (pool.shape[i] ? 1 : 0.6 + t * 0.8)
      }
      pool.geometry.getAttribute('position').needsUpdate = true
      pool.geometry.getAttribute('aSize').needsUpdate = true
      pool.geometry.getAttribute('aAlpha').needsUpdate = true
      pool.geometry.getAttribute('aColor').needsUpdate = true
      pool.geometry.getAttribute('aShape').needsUpdate = true
      pool.active = alive
    }
  })

  return (
    <>
      <primitive object={pools.dust.points} renderOrder={4} />
      <primitive object={pools.glow.points} renderOrder={5} />
    </>
  )
}

export default Particles
