import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'

import { nowSeconds } from '../../state/runtime'
import { usePreset } from '../quality'
import { setUniform } from '../world/materials'
import { createTrailGeometry, createTrailMaterial, pool } from './trailPool'

/**
 * Glowing marks left behind by running villains, each villain in its own style (see
 * MORPH_TRAIL). One pooled instanced mesh, animated in the shader: one draw call.
 * LOW: a smaller pool of plain glows; other players' marks only close by.
 */
export function Trail() {
  const preset = usePreset()
  const size = preset.name === 'LOW' ? 32 : preset.name === 'MEDIUM' ? 56 : 80
  const meshRef = useRef(null)

  const geometry = useMemo(() => createTrailGeometry(size), [size])
  const material = useMemo(() => createTrailMaterial(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    const mesh = meshRef.current
    pool.mesh = mesh
    pool.size = size
    pool.next = 0
    return () => {
      if (pool.mesh === mesh) pool.mesh = null
    }
  }, [size, geometry])

  useFrame(() => {
    setUniform(material, 'uTime', nowSeconds())
    setUniform(material, 'uSimple', preset.name === 'LOW' ? 1 : 0)
  })

  return <instancedMesh key={size} ref={meshRef} args={[geometry, material, size]} frustumCulled={false} renderOrder={2} />
}

export default Trail
