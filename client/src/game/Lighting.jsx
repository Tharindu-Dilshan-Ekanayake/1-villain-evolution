import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { player } from '../state/runtime'
import { usePreset } from './quality'
import { LIGHTS } from './sceneStyle'

const SUN_DIRECTION = new Vector3(...LIGHTS.sunDirection).normalize()
/** How far back along SUN_DIRECTION the light sits from the point it shadows. */
const SUN_DISTANCE = 60
/** Half-size of the square area around the player that receives shadows. */
const SHADOW_EXTENT = 22

/**
 * Bright, even daylight: a white hemisphere fill and a warm sun with soft shadows.
 *
 * A directional light's shadow only covers a fixed box around its target, so the sun
 * and its target follow the player. Shadows exist only on MEDIUM / HIGH; on LOW the
 * sun casts nothing and the shadow pass is skipped entirely.
 */
export function Lighting() {
  const preset = usePreset()
  const sunRef = useRef(null)
  const scene = useThree((s) => s.scene)

  useLayoutEffect(() => {
    const sun = sunRef.current
    if (!sun) return undefined

    const shadowCamera = sun.shadow.camera
    shadowCamera.left = -SHADOW_EXTENT
    shadowCamera.right = SHADOW_EXTENT
    shadowCamera.top = SHADOW_EXTENT
    shadowCamera.bottom = -SHADOW_EXTENT
    shadowCamera.near = 1
    shadowCamera.far = SUN_DISTANCE * 2
    shadowCamera.updateProjectionMatrix()

    // The target has to be in the scene for its matrix to update as it moves.
    scene.add(sun.target)
    return () => {
      scene.remove(sun.target)
      sun.shadow.map?.dispose()
    }
  }, [scene, preset.name])

  useFrame(() => {
    const sun = sunRef.current
    if (!sun) return
    // Snap to a coarse grid so shadow edges don't shimmer as the player moves.
    const x = Math.round(player.x * 2) / 2
    const z = Math.round(player.z * 2) / 2
    sun.target.position.set(x, 0, z)
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE)
  })

  return (
    <>
      <hemisphereLight args={[LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity]} />
      <directionalLight
        // A new shadow map size needs a fresh light.
        key={preset.name}
        ref={sunRef}
        castShadow={preset.shadows}
        color={LIGHTS.sunColor}
        intensity={LIGHTS.sunIntensity}
        position={SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE).toArray()}
        shadow-mapSize={[preset.shadowMapSize || 512, preset.shadowMapSize || 512]}
        shadow-radius={LIGHTS.shadowSoftness}
        shadow-intensity={LIGHTS.shadowIntensity}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
    </>
  )
}

export default Lighting
