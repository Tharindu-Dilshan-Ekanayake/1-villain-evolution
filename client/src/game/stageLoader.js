import { lazy } from 'react'

/**
 * The stage canyon is its own JS chunk. `loadStage` is called early (when the player
 * starts walking towards the gate) to warm it; React.lazy reuses the same promise.
 */
export const loadStage = () => import('./stage/StageWorld')

export const StageWorld = lazy(loadStage)
