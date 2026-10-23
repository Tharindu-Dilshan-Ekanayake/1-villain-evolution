import { Color } from 'three'

import { STAGE_COLORS } from '../sceneStyle'

const WHITE = new Color('#ffffff')
const PALETTE = STAGE_COLORS.map((c) => new Color(c))

/**
 * Brick tint for stage `s`'s wall, multiplied over the template's tan brick: plain tan
 * for Stage 1, then each stage its own colour, cycling through the palette.
 */
export function wallTint(s, out = new Color()) {
  out.copy(WHITE)
  if (s > 0) out.lerp(PALETTE[(s - 1) % PALETTE.length], 0.55)
  return out
}
