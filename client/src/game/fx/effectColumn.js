import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  ShaderMaterial,
} from 'three'

/**
 * Animated light columns rising from pads: one instanced draw call for a whole group
 * (villain pedestals, treadmills, win pads), each instance with its own colour and
 * style. Styles:
 */
export const EFFECT = { glow: 0, fire: 1, electric: 2, swirl: 3 }

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aEffect;
  attribute float aSeed;
  attribute float aStrength;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vEffect;
  varying float vSeed;
  varying float vStrength;
  void main() {
    vUv = uv;
    vColor = aColor;
    vEffect = aEffect;
    vSeed = aSeed;
    vStrength = aStrength;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uSimple;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vEffect;
  varying float vSeed;
  varying float vStrength;

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
    for (int k = 0; k < 3; k++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
    return v;
  }

  void main() {
    float h = vUv.y;
    float t = uTime + vSeed * 10.0;
    float base = pow(1.0 - h, 1.8);
    vec3 col = vColor;
    float a;

    if (uSimple > 0.5 || vEffect < 0.5) {
      // Soft glow.
      a = base * 0.45;
    } else if (vEffect < 1.5) {
      // Fire: noise tongues licking upward, white-yellow at the roots.
      float n = fbm(vec2(vUv.x * 6.0, h * 2.2 - t * 1.6));
      float f = smoothstep(0.32 + h * 0.6, 0.95, n + (1.0 - h) * 0.45);
      a = f * 0.95 + base * 0.15;
      col = mix(vColor, vec3(1.0, 0.92, 0.45), f * 0.65 * (1.0 - h));
    } else if (vEffect < 2.5) {
      // Electric: three jagged arcs crawling up, flickering on and off.
      float bolts = 0.0;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float x = fract(vUv.x * 3.0 + fk * 0.37 + 0.12 * sin(h * 20.0 + t * 9.0 + fk * 3.0) + 0.06 * sin(h * 47.0 - t * 13.0));
        float line = smoothstep(0.04, 0.0, abs(x - 0.5));
        float flick = step(0.35, hash(vec2(floor(t * 12.0) + fk * 7.0, vSeed)));
        bolts += line * flick;
      }
      a = base * 0.28 + bolts * (1.0 - h * 0.7);
      col = mix(vColor, vec3(1.0), clamp(bolts, 0.0, 1.0) * 0.65);
    } else {
      // Swirl: bright bands spiralling up, with twinkling sparkles.
      float band = smoothstep(0.55, 1.0, sin(vUv.x * 12.566 + h * 8.0 - t * 3.0));
      float sparkle = step(0.982, hash(floor(vec2(vUv.x * 40.0, h * 30.0 - t * 4.0))));
      a = base * 0.3 + band * base * 0.7 + sparkle * (1.0 - h);
      col = mix(vColor, vec3(1.0), sparkle);
    }
    gl_FragColor = vec4(col, clamp(a * vStrength, 0.0, 1.0));
  }
`

/** Open cylinder of height 1 (y from -0.5 to 0.5); scale per instance. */
export function createEffectColumnGeometry(count, radius = 1) {
  const g = new CylinderGeometry(radius, radius * 0.92, 1, 24, 1, true)
  g.setAttribute('aColor', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('aEffect', new InstancedBufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aStrength', new InstancedBufferAttribute(new Float32Array(count).fill(1), 1))
  return g
}

export function createEffectColumnMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSimple: { value: 0 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
}

const _c = new Color()

/** Sets instance `i`'s colour, style ('fire' | ...), seed and strength. */
export function setEffectInstance(geometry, i, { color, type = 'glow', strength = 1 }) {
  _c.set(color)
  geometry.getAttribute('aColor').setXYZ(i, _c.r, _c.g, _c.b)
  geometry.getAttribute('aEffect').setX(i, EFFECT[type] ?? 0)
  geometry.getAttribute('aSeed').setX(i, (i * 0.618) % 1)
  geometry.getAttribute('aStrength').setX(i, strength)
  for (const name of ['aColor', 'aEffect', 'aSeed', 'aStrength']) geometry.getAttribute(name).needsUpdate = true
}
