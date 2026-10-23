import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial, Vector3 } from 'three'

import { useGameStore } from '../../state/gameStore'
import { nowSeconds, player } from '../../state/runtime'
import { usePreset } from '../quality'
import { setUniform } from '../world/materials'
import { speedFx, tintFor } from './speedFx'

/** Running speeds (m/s, towards where the camera looks) where the effect starts and peaks. */
const SPEED_START = 9
const SPEED_FULL = 24
/** Extra field of view at full speed, in degrees: the world stretches past you. */
const FOV_KICK = 9
/** The clear middle of the screen (clip-space x): streaks only live in the two side bands. */
const INNER = 0.26
/** MEDIUM / HIGH: a real blur over the screen edges at full speed, in CSS pixels. */
const EDGE_BLUR_PX = 6

const VERTEX = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAspect;
  uniform float uLanes;
  uniform vec3 uTint;
  uniform vec3 uCore;
  varying vec2 vNdc;

  float hash(float n) {
    return fract(sin(n) * 43758.5453);
  }

  // One layer of streaks fanning out from the middle to the left and right edges.
  // Each lane may carry a streak: a bright head racing outward and a tapering tail.
  // Returns (soft glow, sharp core).
  vec2 streaks(vec2 p, float lanes, float speed, float lenMin, float lenMax, float density, float seed) {
    float r = length(p);
    float lane = atan(p.y, abs(p.x)) / 3.1416 * lanes;
    float id = floor(lane) + step(0.0, p.x) * 131.0 + seed;
    float h = hash(id);
    float h2 = hash(id + 17.0);
    if (h > density) return vec2(0.0);
    float across = abs(fract(lane) - 0.5) * 2.0;
    float len = mix(lenMin, lenMax, h2);
    float head = 0.3 + fract(uTime * speed * (0.7 + h * 0.6) + h2 * 7.0) * (2.0 + len);
    float t = (head - r) / len;
    if (t < 0.0 || t > 1.0) return vec2(0.0);
    float taper = 1.0 - t;
    float width = 0.2 + 0.6 * taper;
    float core = smoothstep(width * 0.4, 0.0, across) * taper;
    float glow = smoothstep(width, 0.0, across) * taper * taper;
    return vec2(glow, core);
  }

  void main() {
    vec2 p = vec2(vNdc.x * uAspect, vNdc.y);
    float a = atan(p.y, abs(p.x));
    float sides = smoothstep(${INNER.toFixed(2)}, 0.95, abs(vNdc.x));
    float level = 1.0 - smoothstep(0.55, 1.0, abs(a) / 1.5708);
    float more = 0.4 + 0.6 * uIntensity;
    // Far: many thin, slower streaks in the aura colour. Near: fewer, thick and fast,
    // white-hot at the core.
    vec2 far = streaks(p, uLanes, 0.8, 0.18, 0.42, 0.55 * more, 0.0);
    vec2 near = streaks(p, uLanes * 0.32, 1.5, 0.35, 0.85, 0.5 * more, 50.0);
    vec3 col = mix(uTint, vec3(1.0), 0.3) * far.x * 0.55 + vec3(1.0) * far.y * 0.35;
    col += uTint * near.x * 1.15 + mix(uCore, vec3(1.0), 0.6) * near.y * 1.3;
    col *= sides * level;
    // A soft tinted wind over both sides, rippling outward: the world blurring past.
    float r = length(p);
    float wind = 0.5 + 0.5 * sin(r * 4.0 - uTime * 9.0 + a * 9.0);
    col += mix(vec3(1.0), uTint, 0.35) * sides * sides * (0.16 + 0.12 * wind);
    col *= uIntensity;
    if (max(max(col.r, col.g), col.b) < 0.004) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`

/** Two clip-space bands down the left and right of the screen. */
function buildFrame() {
  const quads = [
    [-1, -1, -INNER, 1],
    [INNER, -1, 1, 1],
  ]
  const pos = []
  for (const [x0, y0, x1, y1] of quads) pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  return g
}

/** A CSS backdrop blur over the canvas, masked to the left and right edges. */
function createEdgeBlur(parent) {
  const el = document.createElement('div')
  el.className = 'speed-blur'
  el.style.setProperty('--blur', `${EDGE_BLUR_PX}px`)
  el.style.display = 'none'
  parent.appendChild(el)
  return el
}

const _forward = new Vector3()

/**
 * Speed lines: when running fast towards where the camera looks, streaks in your
 * villain's aura colour shoot out to the left and right of the screen - a far layer of
 * thin ones and a near layer of thick, white-hot ones - over a soft rippling wind, and
 * the field of view widens a little. Drawn only in the two side bands (the middle stays clear and costs
 * nothing) and hidden entirely when slow. LOW draws fewer lanes; MEDIUM and HIGH also
 * blur the screen edges for real (a CSS backdrop filter, shown only while running).
 */
export function SpeedLines() {
  const preset = usePreset()
  const gl = useThree((s) => s.gl)
  const meshRef = useRef(null)
  const blurRef = useRef(null)
  const geometry = useMemo(() => buildFrame(), [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uAspect: { value: 1 },
          uLanes: { value: 90 },
          // Shared with speedFx, so a villain change re-tints without touching uniforms.
          uTint: { value: speedFx.tint },
          uCore: { value: speedFx.core },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  const edgeBlur = preset.name !== 'LOW'
  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!edgeBlur || !parent) return undefined
    const el = createEdgeBlur(parent)
    blurRef.current = { el, shown: -1 }
    return () => {
      el.remove()
      blurRef.current = null
    }
  }, [edgeBlur, gl])

  const level = useRef({ value: 0, baseFov: 0 })

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const camera = state.camera
    const l = level.current
    if (!l.baseFov) l.baseFov = camera.fov

    // Speed along the camera's view (flattened): running into the screen.
    camera.getWorldDirection(_forward)
    const flat = Math.hypot(_forward.x, _forward.z) || 1
    const along = player.grounded
      ? (player.speed * (Math.sin(player.yaw) * _forward.x + Math.cos(player.yaw) * _forward.z)) / flat
      : 0
    const target = Math.min(1, Math.max(0, (along - SPEED_START) / (SPEED_FULL - SPEED_START)))
    l.value += (target - l.value) * (1 - Math.exp(-Math.min(delta, 0.1) * (target > l.value ? 6 : 3)))
    speedFx.level = l.value
    tintFor(useGameStore.getState().villain)

    const visible = l.value > 0.02
    if (mesh.visible !== visible) mesh.visible = visible
    // The edge blur: a style write only when it visibly changes.
    const blur = blurRef.current
    if (blur) {
      const shown = visible ? Math.round(l.value * 20) / 20 : 0
      if (shown !== blur.shown) {
        blur.shown = shown
        blur.el.style.display = shown > 0 ? 'block' : 'none'
        blur.el.style.opacity = String(shown)
      }
    }
    setUniform(material, 'uIntensity', l.value)
    setUniform(material, 'uTime', nowSeconds())
    setUniform(material, 'uAspect', state.size.width / Math.max(1, state.size.height))
    setUniform(material, 'uLanes', preset.name === 'LOW' ? 56 : 90)

    const fov = l.baseFov + FOV_KICK * l.value
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={1000} />
}

export default SpeedLines
