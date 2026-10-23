import { AdditiveBlending, Color, InstancedBufferAttribute, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from 'three'

import { VILLAIN_TRAIL, VILLAINS } from '../../state/content'
import { nowSeconds } from '../../state/runtime'

/**
 * Walking trails: the shared mark pool and the emitters that feed it (the mesh is
 * fx/Trail.jsx).
 */

/** Seconds a trail mark lasts, appearing to gone. */
const LIFE = 2
/** Metres walked between two marks. */
const STEP = 0.95
/** Marks alternate this far either side of the path, like footsteps. */
const SIDE_OFFSET = 0.28
/** Running slower than this leaves no marks. */
const MIN_SPEED = 1.5

const STYLES = ['glow', 'sparkle', 'ripple', 'bubbles', 'bolt', 'flame', 'star', 'slash', 'spiral', 'splash', 'snow', 'burst']

/** Per villain: style index, colour and size - bigger for higher villains. */
const LOOKS = Object.fromEntries(
  VILLAINS.map((m, i) => [
    m.id,
    { style: Math.max(0, STYLES.indexOf(VILLAIN_TRAIL[m.id])), color: new Color(m.fx.color), size: 0.9 + 0.04 * i },
  ]),
)

const VERTEX = /* glsl */ `
  attribute float iStart;
  attribute vec3 iColor;
  attribute float iStyle;
  attribute float iSize;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAge;
  varying vec3 vColor;
  varying float vStyle;
  varying float vSeed;
  void main() {
    vAge = uTime - iStart;
    vColor = iColor;
    vStyle = iStyle;
    vSeed = fract(iStart * 7.13);
    vUv = uv * 2.0 - 1.0;
    float alive = step(0.0, vAge) * step(vAge, ${LIFE.toFixed(1)});
    float grow = 0.7 + 0.4 * smoothstep(0.0, 0.3, vAge);
    vec3 p = position * iSize * grow * alive;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`

/** Every style is a small distance-field drawing on the mark's square (uv -1..1). */
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSimple;
  varying vec2 vUv;
  varying float vAge;
  varying vec3 vColor;
  varying float vStyle;
  varying float vSeed;

  float stroke(float d, float w) {
    return smoothstep(w, 0.0, d);
  }

  void main() {
    vec2 u = vUv;
    float r = length(u);
    float a = atan(u.y, u.x);
    float t = vAge;
    float s = vStyle;
    float shape = 0.0;
    if (uSimple > 0.5 || s < 0.5) {
      // glow: a soft pool of light
      shape = exp(-r * r * 5.0);
    } else if (s < 1.5) {
      // sparkle: a spinning four-point star
      float c = cos(t * 2.0);
      float sn = sin(t * 2.0);
      vec2 q = mat2(c, -sn, sn, c) * u;
      shape = clamp(max(0.0, 1.0 - abs(q.x) * 7.0 - abs(q.y) * 1.1) + max(0.0, 1.0 - abs(q.y) * 7.0 - abs(q.x) * 1.1), 0.0, 1.0);
      shape += exp(-r * r * 18.0);
    } else if (s < 2.5) {
      // ripple: rings spreading out
      float rr = 0.25 + t * 0.4;
      shape = stroke(abs(r - rr), 0.09) + 0.6 * stroke(abs(r - rr * 0.55), 0.06);
    } else if (s < 3.5) {
      // bubbles
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        vec2 c = vec2(cos(fk * 2.1 + vSeed * 6.0), sin(fk * 2.1 + vSeed * 6.0)) * 0.45;
        float rad = 0.16 + 0.06 * fk;
        float d = length(u - c);
        shape += stroke(abs(d - rad), 0.05) + 0.4 * stroke(length(u - c + vec2(rad * 0.35, -rad * 0.35)), 0.06);
      }
    } else if (s < 4.5) {
      // bolt: a flickering zig-zag
      float zig = (abs(fract(u.y * 1.6 + vSeed) - 0.5) * 2.0 - 0.5) * 0.7;
      float flick = 0.55 + 0.45 * step(0.4, fract(uTime * 13.0 + vSeed * 7.0));
      shape = (stroke(abs(u.x - zig), 0.1) + 0.5 * stroke(abs(u.x - zig), 0.3)) * (1.0 - smoothstep(0.75, 1.0, abs(u.y))) * flick;
    } else if (s < 5.5) {
      // flame: a dancing tongue of fire
      float yy = u.y * 0.5 + 0.5;
      float wob = sin(u.y * 9.0 + uTime * 14.0 + vSeed * 6.0) * 0.07 * yy;
      float w = 0.55 * (1.0 - yy) * smoothstep(0.0, 0.3, yy) + 0.04;
      shape = smoothstep(0.0, 0.12, w - abs(u.x + wob)) + smoothstep(0.0, 0.1, w * 0.45 - abs(u.x + wob));
    } else if (s < 6.5) {
      // star: a turning five-point star
      float f = 0.42 + 0.48 * pow(0.5 + 0.5 * cos((a + t * 1.5) * 5.0), 3.0);
      shape = smoothstep(0.06, 0.0, r - f * 0.95) * (0.6 + 0.4 * (1.0 - r));
    } else if (s < 7.5) {
      // slash: two crossed blade cuts
      float d1 = abs(u.x - u.y) * 0.7071;
      float d2 = abs(u.x + u.y) * 0.7071;
      shape = (stroke(d1, 0.08) + stroke(d2, 0.08)) * (1.0 - smoothstep(0.65, 0.95, r));
    } else if (s < 8.5) {
      // spiral: a swirl of fire
      shape = stroke(abs(sin(a * 2.0 + r * 9.0 - t * 7.0)), 0.45) * (1.0 - smoothstep(0.6, 0.95, r)) * smoothstep(0.05, 0.2, r);
    } else if (s < 9.5) {
      // splash: a ring of water throwing droplets
      float rr = 0.3 + t * 0.35;
      shape = stroke(abs(r - rr), 0.08);
      shape += 1.5 * pow(max(0.0, cos(a * 6.0 + vSeed * 6.0)), 12.0) * stroke(abs(r - rr - 0.2), 0.08);
    } else if (s < 10.5) {
      // snow: a six-armed flake
      float arm = abs(sin((a + t * 0.8) * 3.0)) * r;
      shape = stroke(arm, 0.07) * (1.0 - smoothstep(0.7, 0.9, r)) + stroke(abs(r - 0.45), 0.04) * 0.5;
    } else {
      // burst: a blazing sunburst
      shape = pow(0.5 + 0.5 * cos(a * 10.0 + t * 4.0), 6.0) * (1.0 - smoothstep(0.25, 0.95, r)) + exp(-r * r * 10.0);
    }
    float core = exp(-r * r * 8.0) * 0.35;
    float fade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(${(LIFE * 0.35).toFixed(2)}, ${LIFE.toFixed(1)}, t));
    float alpha = clamp(shape + core, 0.0, 1.6) * fade * (1.0 - smoothstep(0.92, 1.0, r));
    if (alpha < 0.01) discard;
    vec3 col = mix(vColor, vec3(1.0), clamp(shape - 0.8, 0.0, 0.5) + core * 0.6);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`

export function createTrailMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSimple: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/** The live pool, shared by the player and remote players. */
export const pool = { mesh: null, size: 0, next: 0, simple: false }
const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3(1, 1, 1)
const _up = new Vector3(0, 1, 0)

function emitMark(x, z, heading, morph) {
  const mesh = pool.mesh
  if (!mesh) return
  const look = LOOKS[morph] || LOOKS.bloxity
  const i = pool.next
  pool.next = (i + 1) % pool.size
  _q.setFromAxisAngle(_up, heading)
  // Above the lobby deck boards (top at y = 0.06).
  _p.set(x, 0.085, z)
  _m.compose(_p, _q, _s)
  mesh.setMatrixAt(i, _m)
  mesh.instanceMatrix.needsUpdate = true
  const g = mesh.geometry
  g.attributes.iStart.setX(i, nowSeconds())
  g.attributes.iColor.setXYZ(i, look.color.r, look.color.g, look.color.b)
  g.attributes.iStyle.setX(i, look.style)
  g.attributes.iSize.setX(i, look.size)
  g.attributes.iStart.needsUpdate = true
  g.attributes.iColor.needsUpdate = true
  g.attributes.iStyle.needsUpdate = true
  g.attributes.iSize.needsUpdate = true
}

/** Per-walker state: where the last mark was left and which side it was on. */
export function createTrailEmitter() {
  return { x: 0, z: 0, started: false, side: 1 }
}

/**
 * Called every frame with a walker's position; leaves a mark each STEP metres while
 * they run on the ground. Allocation-free.
 */
export function stepTrail(emitter, x, z, speed, grounded, morph) {
  if (!pool.mesh) return
  const dx = x - emitter.x
  const dz = z - emitter.z
  const d = Math.hypot(dx, dz)
  // First call, a jump or a teleport: just move the anchor.
  if (!emitter.started || !grounded || d > 8) {
    emitter.started = true
    emitter.x = x
    emitter.z = z
    return
  }
  if (speed < MIN_SPEED || d < STEP) return
  emitter.x = x
  emitter.z = z
  emitter.side = -emitter.side
  const off = (SIDE_OFFSET * emitter.side) / d
  emitMark(x - dz * off, z + dx * off, Math.atan2(dx, dz), morph)
}

/** Geometry for a pool of `size` marks: a ground quad with per-mark attributes. */
export function createTrailGeometry(size) {
  const g = new PlaneGeometry(1, 1)
  g.rotateX(-Math.PI / 2)
  g.setAttribute('iStart', new InstancedBufferAttribute(new Float32Array(size).fill(-1000), 1))
  g.setAttribute('iColor', new InstancedBufferAttribute(new Float32Array(size * 3), 3))
  g.setAttribute('iStyle', new InstancedBufferAttribute(new Float32Array(size), 1))
  g.setAttribute('iSize', new InstancedBufferAttribute(new Float32Array(size), 1))
  return g
}
