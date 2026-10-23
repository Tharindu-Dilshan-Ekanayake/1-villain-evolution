import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { BASE_BODY_URL } from './avatarAssets'

/**
 * The base Bloxity rig (`player.glb`), loaded once through R3F's suspending, cached
 * `useLoader` with three's own GLTFLoader - the same loader the avatar parts use, so
 * the game ships one GLTF loader rather than two.
 */
export function useBaseBody() {
  return useLoader(GLTFLoader, BASE_BODY_URL)
}

/** Starts the download early (index.html also preloads the file). */
export function preloadBaseBody() {
  useLoader.preload(GLTFLoader, BASE_BODY_URL)
}
