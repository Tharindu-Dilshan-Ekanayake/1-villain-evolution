import { useEffect, useState } from 'react'

import { petIcon } from '../game/pets/petModels'
import { EGG_BY_ID, PET_BY_ID, RARITIES } from '../state/content'
import { useGameStore } from '../state/gameStore'

/** The egg wobbles this long before it pops open. */
const SHAKE_MS = 1100
/** The reveal stays up this long, unless tapped away sooner. */
const SHOW_MS = 2600

/** One hatch, from wobbling egg to reveal; remounted (keyed) for every new hatch. */
function HatchReveal({ hatch, onDone }) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const reveal = setTimeout(() => setRevealed(true), SHAKE_MS)
    const done = setTimeout(onDone, SHAKE_MS + SHOW_MS)
    return () => {
      clearTimeout(reveal)
      clearTimeout(done)
    }
  }, [onDone])

  const egg = EGG_BY_ID[hatch.egg]
  return (
    <div className="hatch-overlay" onPointerDown={() => revealed && onDone()}>
      {!revealed ? (
        <div className="hatch-eggs">
          {hatch.pets.map((id, i) => (
            <div
              key={i}
              className="hatch-egg"
              style={{ '--egg': egg?.color || '#fff', '--spots': egg?.spots || '#ffb347', animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      ) : (
        <div className="hatch-pets">
          {hatch.pets.map((id, i) => {
            const pet = PET_BY_ID[id]
            const rarity = RARITIES[pet.rarity]
            return (
              <div key={i} className="hatch-pet" style={{ '--rarity': rarity.color, animationDelay: `${i * 120}ms` }}>
                <img src={petIcon(id)} alt="" />
                <div className="hp-name ol">{pet.name}</div>
                <div className="hp-rarity ol">{rarity.name}</div>
                <div className="hp-boost ol">+{pet.boost}x Speed</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The hatch: the egg shakes in the middle of the screen, then pops to show the pet(s)
 * inside with their rarity glow. Pure DOM + CSS animation; tap to dismiss.
 */
export function HatchOverlay() {
  const hatch = useGameStore((s) => s.hatch)
  const clearHatch = useGameStore((s) => s.clearHatch)
  if (!hatch) return null
  return <HatchReveal key={hatch.at} hatch={hatch} onDone={clearHatch} />
}

export default HatchOverlay
