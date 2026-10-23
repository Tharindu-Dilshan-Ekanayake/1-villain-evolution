import { Color } from 'three'

import { VILLAIN_BY_ID } from '../../state/content'

/**
 * The running effect's shared state: SpeedLines works out how fast you're going each
 * frame (0..1) and the colour of your villain's aura; WindStreaks reads both.
 */
export const speedFx = {
  level: 0,
  villain: '',
  tint: new Color('#9fd8ff'),
  core: new Color('#ffffff'),
}

/** Re-tints the effect when the villain changes (a no-op otherwise). */
export function tintFor(villainId) {
  if (villainId === speedFx.villain) return
  speedFx.villain = villainId
  const v = VILLAIN_BY_ID[villainId]
  speedFx.tint.set(v?.aura?.color || v?.fx?.color || '#9fd8ff')
  speedFx.core.set(v?.aura?.core || '#ffffff')
}
