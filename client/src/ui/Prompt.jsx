import { useEffect } from 'react'

import { villainPortrait } from '../characters/skins'
import { petIcon } from '../game/pets/petModels'
import { EGG_BY_ID, PETS_BY_EGG, RARITIES, TREADMILL_BY_ID, VILLAIN_BY_ID, VILLAIN_SPEED } from '../state/content'
import { canAffordVillain, formatNumber, petChance } from '../state/economy'
import { useGameStore } from '../state/gameStore'
import Icon from './Icon'
import PriceLabel from './PriceLabel'

/** Shown on the main button of every prompt: press E to use it (keyboard only). */
function KeyHint() {
  return (
    <kbd className="key-hint" aria-hidden>
      E
    </kbd>
  )
}

/** E presses the open prompt's main button, the same as clicking it. */
function usePromptKey() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')) return
      const button = document.querySelector('.prompt [data-primary]:not(:disabled)')
      if (!button) return
      e.preventDefault()
      button.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function VillainPrompt({ id }) {
  const villain = VILLAIN_BY_ID[id]
  const owned = useGameStore((s) => s.ownedVillains.includes(id))
  const equipped = useGameStore((s) => s.villain === id)
  const affordable = useGameStore((s) => canAffordVillain(s, id))
  const buyVillain = useGameStore((s) => s.buyVillain)
  const equipVillain = useGameStore((s) => s.equipVillain)
  if (!villain) return null
  const speedBonus = Math.round(((VILLAIN_SPEED[id] || 1) - 1) * 100)
  const portrait = villainPortrait(id)
  return (
    <>
      <div className="p-head">
        {portrait && <img className="p-portrait" src={portrait} alt="" style={{ borderColor: villain.aura?.color || '#fff' }} />}
        <div>
          <div className="p-title ol">{villain.name}</div>
          <div className="p-sub">
            +{formatNumber(villain.perStep)} Speed per step
            {speedBonus > 0 && <span className="p-speed"> · +{speedBonus}% run speed</span>}
            {villain.aura && <span style={{ color: villain.aura.color }}> · own aura</span>}
          </div>
        </div>
      </div>
      <div className="p-actions">
        {equipped ? (
          <button type="button" className="gbtn price-btn bg-yellow ol" disabled>
            Equipped <Icon name="check" />
          </button>
        ) : owned ? (
          <button type="button" data-primary className="gbtn price-btn bg-green ol" onClick={() => equipVillain(id)}>
            <KeyHint />
            Become
          </button>
        ) : (
          <button
            type="button"
            data-primary
            className={`gbtn price-btn ol ${affordable ? 'bg-green' : 'bg-red'}`}
            onClick={() => buyVillain(id)}
          >
            <KeyHint />
            Unlock <PriceLabel villain={villain} />
          </button>
        )}
      </div>
    </>
  )
}

function EggPrompt({ id }) {
  const egg = EGG_BY_ID[id]
  const wins = useGameStore((s) => s.wins)
  const rebirths = useGameStore((s) => s.rebirths)
  // Lucky Hatch changes the odds shown.
  const boosts = useGameStore((s) => s.boosts)
  const hatchEgg = useGameStore((s) => s.hatchEgg)
  if (!egg) return null
  const pets = PETS_BY_EGG[id]
  // Triple hatching unlocks at the first rebirth.
  const triple = rebirths >= 1
  return (
    <>
      <div className="p-title ol">{egg.name}</div>
      <div className="egg-odds">
        {pets.map((p) => (
          <div key={p.id} className="egg-pet" style={{ borderColor: RARITIES[p.rarity].color }}>
            <img src={petIcon(p.id)} alt="" />
            <div className="egg-pet-chance ol">{petChance(id, p.id, { boosts }).toFixed(0)}%</div>
            <div className="egg-pet-boost ol">+{p.boost}x</div>
          </div>
        ))}
      </div>
      <div className="p-actions">
        <button
          type="button"
          data-primary
          className={`gbtn price-btn ol ${wins >= egg.cost ? 'bg-green' : 'bg-red'}`}
          onClick={() => hatchEgg(id, 1)}
        >
          <KeyHint />
          Hatch <Icon name="trophy" /> {formatNumber(egg.cost)}
        </button>
        <button
          type="button"
          className={`gbtn price-btn ol ${triple ? (wins >= egg.cost * 3 ? 'bg-purple' : 'bg-red') : 'bg-grey'}`}
          disabled={!triple}
          onClick={() => hatchEgg(id, 3)}
        >
          {triple ? (
            <>
              Hatch x3 <Icon name="trophy" /> {formatNumber(egg.cost * 3)}
            </>
          ) : (
            <>
              <Icon name="lock" /> x3 at 1 Rebirth
            </>
          )}
        </button>
      </div>
    </>
  )
}

function PadPrompt({ id }) {
  const pad = TREADMILL_BY_ID[id]
  const rebirths = useGameStore((s) => s.rebirths)
  const wins = useGameStore((s) => s.wins)
  const buyPad = useGameStore((s) => s.buyPad)
  if (!pad) return null
  return (
    <>
      <div className="p-title ol">{pad.name}</div>
      <div className="p-sub">x{formatNumber(pad.mult)} Speed from every step while you train here</div>
      <div className="p-actions">
        {pad.req.rebirths ? (
          <button type="button" className="gbtn price-btn bg-red ol" disabled>
            <Icon name="lock" /> {pad.req.rebirths} Rebirths ({rebirths}/{pad.req.rebirths})
          </button>
        ) : (
          <button
            type="button"
            data-primary
            className={`gbtn price-btn ol ${wins >= pad.req.wins ? 'bg-green' : 'bg-red'}`}
            onClick={() => buyPad(id)}
          >
            <KeyHint />
            Unlock <Icon name="trophy" /> {formatNumber(pad.req.wins)}
          </button>
        )}
      </div>
    </>
  )
}

/** The card that appears when standing on a pedestal, an egg's pad or a locked treadmill. */
export function Prompt() {
  const prompt = useGameStore((s) => s.prompt)
  const panel = useGameStore((s) => s.panel)
  usePromptKey()
  if (!prompt || panel) return null
  return (
    <div className="prompt">
      {prompt.kind === 'villain' && <VillainPrompt id={prompt.id} />}
      {prompt.kind === 'egg' && <EggPrompt id={prompt.id} />}
      {prompt.kind === 'pad' && <PadPrompt id={prompt.id} />}
    </div>
  )
}

export default Prompt
