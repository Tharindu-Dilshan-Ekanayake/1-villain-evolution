import { useEffect, useState } from 'react'

import rebirthIcon from '../assets/rebirth.webp'
import { useBloxity } from '../bloxity/BloxityContext'
import { villainPortrait } from '../characters/skins'
import { petIcon } from '../game/pets/petModels'
import { useQuality } from '../game/quality'
import {
  BOOSTS,
  DAILY_REWARDS,
  PET_BY_ID,
  PET_INVENTORY,
  PET_SLOTS,
  PLAYTIME_REWARDS,
  RARITIES,
  VILLAINS,
} from '../state/content'
import {
  boostCost,
  canAffordVillain,
  canRebirth,
  DAILY_COOLDOWN_MS,
  DAILY_STREAK_RESET_MS,
  formatDuration,
  formatMultiplier,
  formatNumber,
  padsOfWins,
  petMultiplier,
  rebirthCost,
  rebirthLevel,
  rebirthMultiplier,
  STAGE_COUNT,
  treadmillUnlockedAt,
} from '../state/economy'
import { respawn } from '../state/gameplay'
import { TUTORIAL_DONE, useGameStore } from '../state/gameStore'
import { useLevel, useNow } from './hooks'
import Icon from './Icon'
import PriceLabel from './PriceLabel'

function PanelShell({ title, icon, bg, children, extra }) {
  const closePanel = useGameStore((s) => s.closePanel)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closePanel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePanel])
  return (
    <div className="panel-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closePanel()}>
      <div className="panel" role="dialog" aria-label={title}>
        <div className={`panel-head ${bg}`}>
          <span className="panel-icon">{icon}</span>
          <span className="title ol">{title}</span>
          {extra}
          <button type="button" className="gbtn exit bg-red ol" onClick={closePanel}>
            Exit
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  )
}

/* --- Villains ----------------------------------------------------------------------- */

function VillainCard({ villain }) {
  const { identity } = useBloxity()
  const owned = useGameStore((s) => s.ownedVillains.includes(villain.id))
  const equipped = useGameStore((s) => s.villain === villain.id)
  const affordable = useGameStore((s) => canAffordVillain(s, villain.id))
  const buyVillain = useGameStore((s) => s.buyVillain)
  const equipVillain = useGameStore((s) => s.equipVillain)
  const portrait = villain.id === 'bloxity' ? identity?.pfp : villainPortrait(villain.id)
  const glow = villain.aura?.color || villain.fx.color
  return (
    <div className={`villain-card ${equipped ? 'equipped' : ''}`} style={{ '--glow': glow }}>
      <div className="vc-portrait">
        {portrait ? <img src={portrait} alt="" /> : <span className="vc-initial">🙂</span>}
      </div>
      <div className="vc-name ol">{villain.name}</div>
      <div className="vc-gain ol">+{formatNumber(villain.perStep)} / step</div>
      {equipped ? (
        <button type="button" className="gbtn vc-btn bg-yellow ol" disabled>
          Equipped
        </button>
      ) : owned ? (
        <button type="button" className="gbtn vc-btn bg-green ol" onClick={() => equipVillain(villain.id)}>
          Become
        </button>
      ) : (
        <button
          type="button"
          className={`gbtn vc-btn ol ${affordable ? 'bg-green' : 'bg-red'}`}
          onClick={() => buyVillain(villain.id)}
        >
          <PriceLabel villain={villain} />
        </button>
      )}
    </div>
  )
}

function VillainsPanel() {
  const wins = useGameStore((s) => s.wins)
  const points = useGameStore((s) => s.rebirthPoints)
  const owned = useGameStore((s) => s.ownedVillains.length)
  return (
    <PanelShell
      title="Villains"
      icon="🦹"
      bg="bg-purple"
      extra={<span className="ol head-stat">🏆 {formatNumber(wins)}</span>}
    >
      <div className="muted-note">
        Become a villain to earn more Speed with every step - each has its own aura. {owned}/{VILLAINS.length} unlocked.
      </div>
      <div className="section-title ol">Bought with Wins</div>
      <div className="villain-grid">
        {VILLAINS.filter((v) => !v.rebirthVillain).map((v) => (
          <VillainCard key={v.id} villain={v} />
        ))}
      </div>
      <div className="section-title ol">
        Rebirth Villains <span className="section-note">You have 🔄 {points} Rebirth Point{points === 1 ? '' : 's'} · one per rebirth</span>
      </div>
      <div className="villain-grid">
        {VILLAINS.filter((v) => v.rebirthVillain).map((v) => (
          <VillainCard key={v.id} villain={v} />
        ))}
      </div>
    </PanelShell>
  )
}

/* --- Rebirth ---------------------------------------------------------------------- */

function RebirthPanel() {
  const rebirths = useGameStore((s) => s.rebirths)
  const ready = useGameStore((s) => canRebirth(s))
  const rebirth = useGameStore((s) => s.rebirth)
  const { level, top, fraction } = useLevel()
  const pad = treadmillUnlockedAt(rebirths + 1)
  const pct = level >= top ? 100 : ((level - 1 + fraction) / (top - 1)) * 100
  return (
    <PanelShell title="Rebirth" icon={<img className="panel-icon-img" src={rebirthIcon} alt="" />} bg="bg-orange">
      <div className="rebirth-grid">
        <div className="hdr ol">Rebirth {rebirths}</div>
        <div />
        <div className="hdr ol">Rebirth {rebirths + 1}</div>
        <div className="cell bg-purple ol">{formatMultiplier(rebirthMultiplier(rebirths))} Speed</div>
        <div className="arrow ol">▶</div>
        <div className="cell bg-purple ol">{formatMultiplier(rebirthMultiplier(rebirths + 1))} Speed</div>
        <div className="cell bg-yellow ol">+{Math.round(rebirths * 20)}% Wins</div>
        <div className="arrow ol">▶</div>
        <div className="cell bg-yellow ol">+{Math.round((rebirths + 1) * 20)}% Wins</div>
        <div className="cell bg-blue ol">Rebirth at Lv {top}</div>
        <div className="arrow ol">▶</div>
        <div className="cell bg-blue ol">Next at Lv {rebirthLevel(rebirths + 1)}</div>
      </div>
      <div className="muted-note">
        + 1 Rebirth Point for the rebirth villains
        {pad && (
          <>
            <br />
            Unlocks the <b>{pad.name}</b> (x{formatNumber(pad.mult)} Speed)
          </>
        )}
      </div>
      <div className="progress">
        <div style={{ width: `${pct}%` }} />
        <span className="ol tnum">
          Level {level} / {top}
        </span>
      </div>
      <div className="muted-note">
        {ready
          ? 'Ready! Rebirth takes you back to Level 1 (and 0 Speed) - you keep your Wins, villains, pets and treadmills.'
          : `Reach Level ${top} to rebirth (${formatNumber(rebirthCost(rebirths))} Speed).`}
      </div>
      <button
        type="button"
        className={`gbtn ol big-action ${ready ? 'bg-rainbow' : 'bg-grey'}`}
        disabled={!ready}
        onClick={rebirth}
      >
        Rebirth
      </button>
    </PanelShell>
  )
}

/* --- Pets ------------------------------------------------------------------------- */

function PetsPanel() {
  const pets = useGameStore((s) => s.pets)
  const equipped = useGameStore((s) => s.equippedPets)
  const mult = useGameStore((s) => petMultiplier(s))
  const equipPet = useGameStore((s) => s.equipPet)
  const unequipPet = useGameStore((s) => s.unequipPet)
  const equipBestPets = useGameStore((s) => s.equipBestPets)
  const deletePet = useGameStore((s) => s.deletePet)
  const [deleting, setDeleting] = useState(false)

  const sorted = [...pets].sort((a, b) => (PET_BY_ID[b.id]?.boost || 0) - (PET_BY_ID[a.id]?.boost || 0))
  return (
    <PanelShell
      title="Pets"
      icon="🐾"
      bg="bg-orange"
      extra={<span className="ol head-stat">{formatMultiplier(mult)}</span>}
    >
      <div className="muted-note">
        Equip up to {PET_SLOTS} pets: their boosts add to your Speed multiplier. Hatch eggs at the stands by the lobby's
        east wall. {pets.length}/{PET_INVENTORY} pets.
      </div>
      <div className="pet-toolbar">
        <button type="button" className="gbtn price-btn bg-green ol" onClick={equipBestPets} disabled={pets.length === 0}>
          Equip Best
        </button>
        <button
          type="button"
          className={`gbtn price-btn ol ${deleting ? 'bg-red' : 'bg-grey'}`}
          onClick={() => setDeleting(!deleting)}
          disabled={pets.length === 0}
        >
          {deleting ? 'Done deleting' : 'Delete pets'}
        </button>
      </div>
      {pets.length === 0 && <div className="muted-note">No pets yet - the Starter Egg costs 🏆 50.</div>}
      <div className="pet-grid">
        {sorted.map((p) => {
          const pet = PET_BY_ID[p.id]
          const on = equipped.includes(p.uid)
          const rarity = RARITIES[pet.rarity]
          return (
            <button
              key={p.uid}
              type="button"
              className={`pet-card ${on ? 'on' : ''} ${deleting ? 'deleting' : ''}`}
              style={{ '--rarity': rarity.color }}
              onClick={() => (deleting ? deletePet(p.uid) : on ? unequipPet(p.uid) : equipPet(p.uid))}
            >
              <img src={petIcon(p.id)} alt="" />
              <span className="pc-name ol">{pet.name}</span>
              <span className="pc-rarity ol">{rarity.name}</span>
              <span className="pc-boost ol">+{pet.boost}x</span>
              {on && !deleting && <span className="pc-on ol">✔</span>}
              {deleting && <span className="pc-del ol">🗑️</span>}
            </button>
          )
        })}
      </div>
    </PanelShell>
  )
}

/* --- Daily ------------------------------------------------------------------------ */

function DailyPanel() {
  const now = useNow(1000)
  const daily = useGameStore((s) => s.daily)
  const claimDaily = useGameStore((s) => s.claimDaily)
  const stats = useGameStore((s) => s.stats)
  const rebirths = useGameStore((s) => s.rebirths)
  const state = { stats, rebirths }
  const ready = now - daily.at >= DAILY_COOLDOWN_MS
  const broken = now - daily.at > DAILY_STREAK_RESET_MS
  const next = ready ? (broken ? 1 : (daily.streak % DAILY_REWARDS.length) + 1) : daily.streak
  return (
    <PanelShell title="Daily Rewards" icon="📅" bg="bg-blue">
      <div className="muted-note">Come back every day: the rewards grow all week. Miss two days and the streak restarts.</div>
      <div className="daily-grid">
        {DAILY_REWARDS.map((r) => {
          const done = r.day < next || (!ready && r.day === daily.streak)
          const today = ready && r.day === next
          return (
            <div key={r.day} className={`daily-cell ${done ? 'done' : ''} ${today ? 'today' : ''}`}>
              <div className="dc-day ol">Day {r.day}</div>
              <div className="dc-reward ol">🏆 {formatNumber(padsOfWins(state, r.winsPads))}</div>
              {r.boost && <div className="dc-boost ol">+ {BOOSTS.find((b) => b.id === r.boost).name}</div>}
              {done && <div className="dc-check ol">✔</div>}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className={`gbtn ol big-action ${ready ? 'bg-rainbow' : 'bg-grey'}`}
        disabled={!ready}
        onClick={claimDaily}
      >
        {ready ? `Claim Day ${next}!` : `Next in ${formatDuration(daily.at + DAILY_COOLDOWN_MS - now)}`}
      </button>
    </PanelShell>
  )
}

/* --- Playtime --------------------------------------------------------------------- */

function rewardText(reward, state) {
  const parts = []
  if (reward.winsPads) parts.push(`🏆 ${formatNumber(padsOfWins(state, reward.winsPads))}`)
  if (reward.boost) parts.push(`${reward.boostMinutes} min ${BOOSTS.find((b) => b.id === reward.boost).name}`)
  return parts.join(' + ')
}

function PlaytimePanel() {
  const now = useNow(1000)
  const sessionStart = useGameStore((s) => s.sessionStart)
  const claimed = useGameStore((s) => s.playtimeClaimed)
  const claimPlaytime = useGameStore((s) => s.claimPlaytime)
  const stats = useGameStore((s) => s.stats)
  const rebirths = useGameStore((s) => s.rebirths)
  const state = { stats, rebirths }
  const played = now - sessionStart
  return (
    <PanelShell title="Playtime Rewards" icon="⏰" bg="bg-pink">
      <div className="muted-note">Rewards for playing this session: {formatDuration(played)} so far.</div>
      {PLAYTIME_REWARDS.map((r, i) => {
        const left = r.minutes * 60000 - played
        const done = claimed.includes(i)
        return (
          <div key={r.minutes} className="row-card bg-dark">
            <div className="icon">{r.boost ? '🧪' : '🏆'}</div>
            <div className="grow">
              <div className="name ol">{r.minutes} minutes</div>
              <div className="desc ol">{rewardText(r, state)}</div>
            </div>
            <button
              type="button"
              className={`gbtn price-btn ol ${done ? 'bg-grey' : left <= 0 ? 'bg-green' : 'bg-blue'}`}
              disabled={done || left > 0}
              onClick={() => claimPlaytime(i)}
            >
              {done ? 'Claimed ✓' : left <= 0 ? 'Claim!' : formatDuration(left)}
            </button>
          </div>
        )
      })}
    </PanelShell>
  )
}

/* --- Boosts ------------------------------------------------------------------------- */

function BoostsPanel() {
  const now = useNow(1000)
  const boosts = useGameStore((s) => s.boosts)
  const wins = useGameStore((s) => s.wins)
  const cost = useGameStore((s) => boostCost(s))
  const buyBoost = useGameStore((s) => s.buyBoost)
  return (
    <PanelShell title="Boosts" icon="🧪" bg="bg-green">
      <div className="muted-note">15 minutes each, bought with Wins. Buying more stacks the time.</div>
      {BOOSTS.map((b) => {
        const left = (boosts[b.id] || 0) - now
        return (
          <div key={b.id} className="row-card bg-purple">
            <div className="icon">
              <Icon name={b.icon} />
            </div>
            <div className="grow">
              <div className="name ol">{b.name}</div>
              <div className="desc ol">
                {b.desc} {left > 0 && `Active: ${formatDuration(left)}`}
              </div>
            </div>
            <button
              type="button"
              className={`gbtn price-btn ol ${wins >= cost ? 'bg-green' : 'bg-red'}`}
              onClick={() => buyBoost(b.id)}
            >
              🏆 {formatNumber(cost)}
            </button>
          </div>
        )
      })}
    </PanelShell>
  )
}

/* --- Settings ----------------------------------------------------------------------- */

function Toggle({ on, onClick, children }) {
  return (
    <button type="button" className={`gbtn price-btn ol ${on ? 'bg-green' : 'bg-red'}`} onClick={onClick}>
      {children}: {on ? 'ON' : 'OFF'}
    </button>
  )
}

function SettingsPanel() {
  const openPanel = useGameStore((s) => s.openPanel)
  const closePanel = useGameStore((s) => s.closePanel)
  const settings = useGameStore((s) => s.settings)
  const setSetting = useGameStore((s) => s.setSetting)
  const tutorial = useGameStore((s) => s.tutorial)
  const setTutorial = useGameStore((s) => s.setTutorial)
  const resetProgress = useGameStore((s) => s.resetProgress)
  const uid = useGameStore((s) => s.uid)
  const mode = useQuality((s) => s.mode)
  const level = useQuality((s) => s.level)
  const setMode = useQuality((s) => s.setMode)
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <PanelShell title="Settings" icon="⚙️" bg="bg-grey">
      <div className="row-card bg-dark" style={{ flexWrap: 'wrap' }}>
        <div className="grow">
          <div className="name ol">Sound</div>
        </div>
        <Toggle on={settings.music} onClick={() => setSetting('music', !settings.music)}>
          Music
        </Toggle>
        <Toggle on={settings.sfx} onClick={() => setSetting('sfx', !settings.sfx)}>
          Effects
        </Toggle>
      </div>
      <div className="row-card bg-dark" style={{ flexWrap: 'wrap' }}>
        <div className="grow">
          <div className="name ol">Graphics</div>
          <div className="desc ol">Now: {level}. Auto drops quality if the frame rate dips.</div>
        </div>
        {['AUTO', 'LOW', 'MEDIUM', 'HIGH'].map((m) => (
          <button
            key={m}
            type="button"
            className={`gbtn price-btn ol ${mode === m ? 'bg-yellow' : 'bg-blue'}`}
            style={{ minWidth: 0 }}
            onClick={() => setMode(m)}
          >
            {m[0] + m.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div className="row-card bg-dark">
        <div className="grow">
          <div className="name ol">Controls</div>
          <div className="desc ol">
            WASD or joystick: run · Stand on a treadmill: train · Run into a wall: smash it · Space: jump · Normal Speed switch: run at a normal pace ·
            E: use · Drag: camera · Scroll or pinch: zoom
          </div>
        </div>
      </div>
      <div className="row-card bg-dark" style={{ flexWrap: 'wrap' }}>
        <div className="grow">
          <div className="name ol">🎁 Codes</div>
          <div className="desc ol">Got a code? Redeem it for free rewards.</div>
        </div>
        <button type="button" className="gbtn price-btn bg-orange ol" onClick={() => openPanel('codes')}>
          Redeem
        </button>
        <button type="button" className="gbtn price-btn bg-blue ol" onClick={() => openPanel('stats')}>
          Stats
        </button>
      </div>
      <div className="row-card bg-dark" style={{ flexWrap: 'wrap' }}>
        <div className="grow">
          <div className="name ol">Player</div>
          <div className="desc ol">UID {uid ? `#${uid}` : 'not assigned yet (joins with the server)'}</div>
        </div>
        <button
          type="button"
          className="gbtn price-btn bg-blue ol"
          onClick={() => {
            respawn()
            closePanel()
          }}
        >
          Respawn
        </button>
        <button
          type="button"
          className="gbtn price-btn bg-blue ol"
          disabled={tutorial !== TUTORIAL_DONE}
          onClick={() => setTutorial(1)}
        >
          Replay tutorial
        </button>
        <button
          type="button"
          className={`gbtn price-btn ol ${confirmReset ? 'bg-red' : 'bg-grey'}`}
          onClick={() => {
            if (confirmReset) {
              resetProgress()
              setConfirmReset(false)
            } else setConfirmReset(true)
          }}
        >
          {confirmReset ? 'Tap again to wipe' : 'Reset progress'}
        </button>
      </div>
    </PanelShell>
  )
}

/* --- Codes -------------------------------------------------------------------------- */

function CodesPanel() {
  const redeemCode = useGameStore((s) => s.redeemCode)
  const [code, setCode] = useState('')
  const [result, setResult] = useState(null)
  return (
    <PanelShell title="Codes" icon="🎁" bg="bg-orange">
      <div className="muted-note">Enter a code to claim free rewards. Try VISITS500K!</div>
      <form
        className="code-form"
        onSubmit={(e) => {
          e.preventDefault()
          setResult(redeemCode(code))
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" maxLength={20} />
        <button type="submit" className="gbtn price-btn bg-green ol">
          Redeem
        </button>
      </form>
      {result && (
        <div className="muted-note" style={{ color: result.ok ? '#1f8a3a' : '#c41f1f' }}>
          {result.message}
        </div>
      )}
    </PanelShell>
  )
}

/* --- Stats -------------------------------------------------------------------------- */

function StatsPanel() {
  const s = useGameStore((st) => st.stats)
  const rebirths = useGameStore((st) => st.rebirths)
  const villains = useGameStore((st) => st.ownedVillains.length)
  const uid = useGameStore((st) => st.uid)
  const rows = [
    ['🆔 UID', uid ? `#${uid}` : '—'],
    ['👟 Steps', formatNumber(s.steps)],
    ['🧱 Walls smashed', formatNumber(s.walls)],
    ['🚩 Best stage', `${Math.max(1, s.bestStage)} / ${STAGE_COUNT}`],
    ['🏆 Wins earned', formatNumber(s.winsEarned)],
    ['⚡ Best Speed', formatNumber(s.bestSpeed)],
    ['🔄 Rebirths', String(rebirths)],
    ['🦹 Villains', `${villains} / ${VILLAINS.length}`],
    ['🥚 Eggs hatched', formatNumber(s.hatched)],
    ['⏱️ Play time', formatDuration(s.playSeconds * 1000)],
  ]
  return (
    <PanelShell title="Stats" icon="📊" bg="bg-green">
      {rows.map(([k, v]) => (
        <div key={k} className="row-card bg-dark">
          <div className="grow name ol" style={{ fontSize: 'calc(24px * var(--ps))' }}>
            {k}
          </div>
          <div className="name ol tnum" style={{ color: 'var(--wins)', fontSize: 'calc(26px * var(--ps))' }}>
            {v}
          </div>
        </div>
      ))}
    </PanelShell>
  )
}

const PANELS = {
  villains: VillainsPanel,
  rebirth: RebirthPanel,
  pets: PetsPanel,
  daily: DailyPanel,
  playtime: PlaytimePanel,
  boosts: BoostsPanel,
  settings: SettingsPanel,
  codes: CodesPanel,
  stats: StatsPanel,
}

export function Panels() {
  const panel = useGameStore((s) => s.panel)
  const Component = PANELS[panel]
  return Component ? <Component /> : null
}

export default Panels
