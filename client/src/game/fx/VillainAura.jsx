import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, CylinderGeometry, FrontSide, ShaderMaterial } from 'three'

import { VILLAIN_BY_ID } from '../../state/content'
import { useGameStore } from '../../state/gameStore'
import { playerFx } from '../../state/runtime'
import { usePreset } from '../quality'

/** Aura styles, as the shader's uStyle. */
const STYLE = { flame: 0, electric: 1, swirl: 2, smoke: 3 }

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  void main() {
    vUv = uv;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uStyle;
  uniform float uRainbow;
  uniform vec3 uColor;
  uniform vec3 uCore;
  varying vec2 vUv;
  varying vec3 vNormalV;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int k = 0; k < 3; k++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }
  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }

  void main() {
    float h = vUv.y;
    float x = vUv.x * 7.0;
    float shape;
    if (uStyle < 0.5) {
      // Flame: tongues licking up the body, thinning towards the top.
      float n = fbm(vec2(x, h * 2.4 - uTime * 1.8) + vec2(sin(h * 6.0 + uTime) * 0.2, 0.0));
      shape = smoothstep(0.25 + h * 0.5, 0.8, n + 0.25 - h * 0.1);
    } else if (uStyle < 1.5) {
      // Electric: thin bright arcs that jump about.
      float t = floor(uTime * 12.0);
      float n = fbm(vec2(x * 1.6 + t * 3.1, h * 3.0 + t));
      float arc = 1.0 - smoothstep(0.0, 0.06, abs(n - 0.5));
      shape = arc * (0.6 + 0.4 * step(0.5, hash(vec2(t, floor(x)))));
      shape += smoothstep(0.7, 1.0, fbm(vec2(x, h * 2.0 - uTime * 2.5))) * 0.35;
    } else if (uStyle < 2.5) {
      // Swirl: bands spiralling up around the villain.
      float s = sin((vUv.x * 6.2832 * 2.0) + h * 9.0 - uTime * 4.0);
      shape = smoothstep(0.35, 1.0, s) * (0.55 + 0.45 * fbm(vec2(x, h * 3.0 - uTime)));
    } else {
      // Smoke: slow, soft billows rising.
      float n = fbm(vec2(x * 0.7, h * 1.6 - uTime * 0.7));
      shape = smoothstep(0.35, 0.85, n) * 0.85;
    }
    float rim = pow(1.0 - abs(vNormalV.z), 1.4);
    // A steady glow along the silhouette, so the aura reads even over bright ground.
    float a = (shape * (0.4 + rim * 0.85) + rim * 0.22 * (1.0 - h)) * uIntensity * (1.0 - h * 0.45);
    vec3 col = mix(uCore, uColor, 0.4 + shape * 0.6);
    if (uRainbow > 0.5) col = mix(col, hue(fract(h * 0.6 + uTime * 0.25 + vUv.x)), 0.55);
    // Kept below 1.0 per channel: additive blending over itself would clip to white.
    gl_FragColor = vec4(col * (0.65 + shape * 0.35), a);
  }
`

/**
 * The villain's own aura: an open shell of energy around it - flame, electric arcs,
 * a spiral or smoke, in that villain's colours - flaring on every wall hit. One mesh,
 * one draw call; not rendered on LOW. Your plain Bloxity avatar has none.
 *
 * Without props it shows the local player's villain; `villainId` shows another
 * player's (`remote`: no hit flare, so it never touches the local player's pulse).
 */
export function VillainAura({ height = 1.8, villainId: villainOverride, remote = false }) {
  const preset = usePreset()
  const ownVillain = useGameStore((s) => s.villain)
  const villainId = villainOverride ?? ownVillain
  const aura = VILLAIN_BY_ID[villainId]?.aura
  const meshRef = useRef(null)

  const geometry = useMemo(() => new CylinderGeometry(0.72, 0.5, height * 1.35, 20, 1, true), [height])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uStyle: { value: STYLE[aura?.style] ?? 0 },
          uRainbow: { value: aura?.rainbow ? 1 : 0 },
          uColor: { value: new Color(aura?.color || '#ffffff') },
          uCore: { value: new Color(aura?.core || '#000000') },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // Outer face only: drawing the far side too doubled the glow into white.
        side: FrontSide,
      }),
    // A new villain means a new aura: rebuilt (rarely), never mutated.
    [aura],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state, delta) => {
    if (!remote) playerFx.auraPulse = Math.max(0, playerFx.auraPulse - delta * 3)
    const uniforms = meshRef.current?.material.uniforms
    if (!uniforms) return
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uIntensity.value = remote ? 1 : 1.05 + playerFx.auraPulse * 0.45
  })

  if (!preset.aura || !aura) return null
  return (
    <mesh ref={meshRef} geometry={geometry} material={material} position={[0, height * 0.6, 0]} renderOrder={6} />
  )
}

export default VillainAura
