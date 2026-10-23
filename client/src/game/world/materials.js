import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'

/** Writes a shader uniform. A plain function so per-frame updates read clearly. */
export function setUniform(material, name, value) {
  const uniform = material?.uniforms?.[name]
  if (uniform) uniform.value = value
}

/**
 * Shared instanced shader materials. Each needs only the instance matrix, so one
 * material draws every flame (or beam) of its group in a single call.
 */

const flameVertex = /* glsl */ `
  uniform float uTime;
  varying float vY;
  void main() {
    vec3 p = position;
    float seed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;
    vY = p.y + 0.5;
    p.x += sin(uTime * 9.0 + seed * 7.0 + p.y * 4.0) * 0.12 * vY;
    p.z += cos(uTime * 7.0 + seed * 5.0) * 0.1 * vY;
    p.y *= 1.0 + 0.18 * sin(uTime * 11.0 + seed * 3.0);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`
const flameFragment = /* glsl */ `
  varying float vY;
  void main() {
    vec3 c = mix(vec3(1.0, 0.9, 0.35), vec3(1.0, 0.28, 0.05), vY);
    gl_FragColor = vec4(c, (1.0 - vY) * 0.95);
  }
`

/** Flickering additive flame for a ConeGeometry(r, 1, n, 1, true). Drive `uTime`. */
export function createFlameMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: flameVertex,
    fragmentShader: flameFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

const beamVertex = /* glsl */ `
  varying float vY;
  #ifdef USE_INSTANCING_COLOR
    varying vec3 vColor;
  #endif
  void main() {
    vY = position.y + 0.5;
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
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vY;
  #ifdef USE_INSTANCING_COLOR
    varying vec3 vColor;
  #endif
  void main() {
    vec3 c = uColor;
    #ifdef USE_INSTANCING_COLOR
      c = vColor;
    #endif
    gl_FragColor = vec4(c, pow(1.0 - vY, 1.6) * uStrength);
  }
`

/** Soft additive light column for an open-ended box / cylinder of height 1. */
export function createBeamMaterial(color = '#ffffff', strength = 0.32) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength } },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
}
