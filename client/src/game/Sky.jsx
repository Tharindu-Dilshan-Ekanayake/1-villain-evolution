import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Triangle,
  Vector3,
} from 'three'

import { usePreset } from './quality'
import { CLOUDS, LIGHTS, SKY } from './sceneStyle'

const SKY_RADIUS = 450

/** Centre of the cloud field: the middle of the track. */
const CLOUD_CENTER = [0, 0, -80]
/** Radians per second the whole cloud field turns about its centre. */
const CLOUD_DRIFT = 0.004

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const skyFragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform float exponent;

  varying vec3 vDirection;

  void main() {
    float h = normalize(vDirection).y;
    // Below the horizon stays horizon-coloured, matching the fog on distant ground.
    vec3 color = mix(horizonColor, topColor, pow(max(h, 0.0), exponent));
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/**
 * Vertical gradient dome. Follows the camera so the horizon always sits at eye level
 * and the dome can never be walked out of.
 */
function SkyDome() {
  const ref = useRef(null)
  const camera = useThree((s) => s.camera)

  const uniforms = useMemo(
    () => ({
      topColor: { value: new Color(SKY.top) },
      horizonColor: { value: new Color(SKY.horizon) },
      exponent: { value: SKY.exponent },
    }),
    [],
  )

  useFrame(() => {
    ref.current?.position.copy(camera.position)
  })

  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
      />
    </mesh>
  )
}

/** Small seeded PRNG, so the cloud layout is the same on every load. */
function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A faceted puff with its shading baked into vertex colours: white where a face points
 * up or towards the sun, blue-grey underneath.
 *
 * Baked rather than lit so the clouds stay bright white regardless of the scene lights,
 * and the flat per-face colour gives the low-poly look.
 */
function createPuffGeometry() {
  const geometry = new IcosahedronGeometry(1, 1)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)

  const top = new Color(CLOUDS.top)
  const bottom = new Color(CLOUDS.bottom)
  const sun = new Vector3(...LIGHTS.sunDirection).normalize()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const faceNormal = new Vector3()
  const faceColor = new Color()

  // IcosahedronGeometry is non-indexed: every 3 vertices are one face.
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    Triangle.getNormal(a, b, c, faceNormal)
    // Every vertex lies on the unit sphere, so the vertex itself points outward.
    if (faceNormal.dot(a) < 0) faceNormal.negate()

    const up = faceNormal.y * 0.5 + 0.5
    const lit = Math.max(faceNormal.dot(sun), 0) * 0.35
    faceColor.copy(bottom).lerp(top, Math.min(1, up * 0.85 + lit))

    for (let v = 0; v < 3; v += 1) {
      colors[(i + v) * 3] = faceColor.r
      colors[(i + v) * 3 + 1] = faceColor.g
      colors[(i + v) * 3 + 2] = faceColor.b
    }
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/**
 * Each cloud is a row of overlapping, slightly flattened puffs with one more on top.
 *
 * Kept fairly low and large: the follow camera looks slightly down, so only clouds
 * low in the sky ever reach the top of the screen. The lowest cloud bottom still sits
 * above the highest the camera can orbit.
 */
function buildCloudLayout(count) {
  const rand = mulberry32(7)
  const clouds = []

  for (let i = 0; i < count; i += 1) {
    const size = 7 + rand() * 6
    const puffCount = 3 + Math.floor(rand() * 3)
    const puffs = []

    for (let p = 0; p < puffCount; p += 1) {
      // Bigger in the middle, tapering to the ends.
      const along = (p - (puffCount - 1) / 2) * size * 0.9
      const taper = 1 - Math.abs(along) / (size * puffCount * 0.6)
      const s = size * (0.75 + rand() * 0.35) * taper
      puffs.push({
        position: [along, (rand() - 0.3) * size * 0.4, (rand() - 0.5) * size * 0.6],
        scale: [s, s * 0.75, s * 0.85],
      })
    }
    // The billow on top that makes it read as a cumulus rather than a sausage.
    puffs.push({
      position: [(rand() - 0.5) * size, size * 0.55, 0],
      scale: [size * 0.8, size * 0.65, size * 0.7],
    })

    clouds.push({
      position: [(rand() * 2 - 1) * 220, 36 + rand() * 16, (rand() * 2 - 1) * 260],
      rotationY: rand() * Math.PI,
      puffs,
    })
  }

  return clouds
}

/**
 * Every puff of every cloud is one instance of a single InstancedMesh: the whole sky
 * is one draw call. The cloud count follows the quality preset.
 */
function Clouds({ count }) {
  const ref = useRef(null)
  const meshRef = useRef(null)
  const geometry = useMemo(() => createPuffGeometry(), [])
  const material = useMemo(() => new MeshBasicMaterial({ vertexColors: true, fog: false }), [])
  const puffs = useMemo(() => {
    const out = []
    const cloudMatrix = new Matrix4()
    const puffMatrix = new Matrix4()
    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)
    for (const cloud of buildCloudLayout(CLOUDS.count).slice(0, count)) {
      q.setFromAxisAngle(up, cloud.rotationY)
      cloudMatrix.compose(new Vector3(...cloud.position), q, new Vector3(1, 1, 1))
      for (const puff of cloud.puffs) {
        puffMatrix.compose(
          new Vector3(...puff.position),
          new Quaternion(),
          new Vector3(...puff.scale),
        )
        out.push(cloudMatrix.clone().multiply(puffMatrix))
      }
    }
    return out
  }, [count])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    puffs.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [puffs])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * CLOUD_DRIFT
  })

  return (
    <group ref={ref} position={CLOUD_CENTER}>
      {/* fog off on the material: the clouds sit past the fog's far distance. */}
      <instancedMesh
        key={puffs.length}
        ref={meshRef}
        args={[geometry, material, puffs.length]}
        frustumCulled={false}
      />
    </group>
  )
}

/** Gradient sky plus drifting low-poly clouds. */
export function Sky() {
  const preset = usePreset()
  return (
    <>
      <SkyDome />
      <Clouds count={preset.clouds} />
    </>
  )
}

export default Sky
