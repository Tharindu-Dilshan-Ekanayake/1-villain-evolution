import { TorusGeometry } from 'three'

import { box, colorize, cyl, merge, place } from '../world/kit'

const GOLD = '#ffc83d'
const LIGHT_GOLD = '#ffe27a'
const DARK_GOLD = '#d99a1c'

/**
 * A low-poly gold trophy (the 🏆 of the Wins), about 2 m tall with its base at y = 0,
 * as one vertex-coloured geometry.
 */
export function buildTrophy() {
  const handle = (side) => {
    const g = colorize(new TorusGeometry(0.3, 0.07, 6, 14, Math.PI), DARK_GOLD)
    g.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2)
    return place(g, { pos: [side * 0.58, 1.48, 0] })
  }
  return merge([
    box(0.95, 0.24, 0.95, '#5a3a1a', { pos: [0, 0.12, 0] }),
    cyl(0.36, 0.42, 0.18, 12, DARK_GOLD, { pos: [0, 0.33, 0] }),
    cyl(0.1, 0.16, 0.55, 10, GOLD, { pos: [0, 0.68, 0] }),
    cyl(0.18, 0.1, 0.12, 10, LIGHT_GOLD, { pos: [0, 0.98, 0] }),
    // The cup, widening to the rim.
    cyl(0.62, 0.24, 0.95, 16, GOLD, { pos: [0, 1.5, 0] }),
    cyl(0.66, 0.66, 0.08, 16, LIGHT_GOLD, { pos: [0, 1.98, 0] }),
    handle(-1),
    handle(1),
    // A star on the front.
    box(0.26, 0.26, 0.06, LIGHT_GOLD, { pos: [0, 1.5, 0.48], rot: [0, 0, Math.PI / 4] }),
  ])
}
