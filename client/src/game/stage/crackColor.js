import { useEffect } from 'react'
import { Color } from 'three'

import { VILLAIN_BY_ID } from '../../state/content'
import { useGameStore } from '../../state/gameStore'

/**
 * The colour the walls crack and shatter in: your villain's aura colour (or its fist
 * colour for your plain avatar). One shared Color that both wall shaders use as a
 * uniform value, so changing it recolours them without recompiling anything.
 */
export const crackColor = new Color('#b13bff')

function colourFor(s) {
  const villain = VILLAIN_BY_ID[s.villain]
  return villain?.aura?.color || villain?.fx?.color || '#b13bff'
}

/** Keeps `crackColor` in step with the equipped villain (store changes only). */
export function useCrackColor() {
  useEffect(() => {
    let last = ''
    const update = (s) => {
      const hex = colourFor(s)
      if (hex === last) return
      last = hex
      crackColor.set(hex)
    }
    update(useGameStore.getState())
    return useGameStore.subscribe(update)
  }, [])
}
