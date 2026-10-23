import rebirthIcon from '../assets/rebirth.webp'
import { PLAYTIME_REWARDS } from '../state/content'
import { DAILY_COOLDOWN_MS, formatNumber, levelProgress } from '../state/economy'
import { useGameStore } from '../state/gameStore'
import Drawer from './Drawer'
import Icon from './Icon'
import { useNow } from './hooks'
import { useWinsHeld } from './winsFlight'

const BUTTONS = [
  { id: 'villains', label: 'Villains', icon: 'villain', bg: 'bg-purple' },
  { id: 'rebirth', label: 'Rebirth', img: rebirthIcon, bg: 'bg-red' },
  { id: 'pets', label: 'Pets', icon: 'paw', bg: 'bg-orange' },
  { id: 'daily', label: 'Daily', icon: 'calendar', bg: 'bg-blue' },
  { id: 'playtime', label: 'Playtime', icon: 'clock', bg: 'bg-pink' },
  { id: 'boosts', label: 'Boosts', icon: 'potion', bg: 'bg-green' },
  { id: 'settings', label: 'Settings', icon: 'gear', bg: 'bg-grey' },
]

/** Your Wins and Rebirths, one under the other, above the menu. Values pop when they change. */
export function StatsCard() {
  // Freshly claimed Wins count up as their trophies land (see winsFlight.js).
  const wins = useGameStore((s) => s.wins) - useWinsHeld((s) => s.held)
  const rebirths = useGameStore((s) => s.rebirths)
  const points = useGameStore((s) => s.rebirthPoints)
  return (
    <div className="stats-card">
      <div className="stat stat-wins">
        <span className="stat-badge" aria-hidden>
          <span className="stat-icon">
            <Icon name="trophy" />
          </span>
        </span>
        <span className="stat-text">
          <span key={wins} className="stat-value ol pop tnum">
            {formatNumber(Math.max(0, wins))}
          </span>
          <span className="stat-label">Wins</span>
        </span>
      </div>
      <div className="stat stat-rebirths">
        <span className="stat-badge" aria-hidden>
          <img className="stat-icon-img" src={rebirthIcon} alt="" />
        </span>
        <span className="stat-text">
          <span key={rebirths} className="stat-value ol pop tnum">
            {formatNumber(rebirths)}
          </span>
          <span className="stat-label">Rebirths{points > 0 ? ` · ${points} pts` : ''}</span>
        </span>
      </div>
    </div>
  )
}

/** The main menu buttons; on phones they slide away behind an arrow. */
export function LeftMenu() {
  const openPanel = useGameStore((s) => s.openPanel)
  const now = useNow(1000)
  // How far up the levels to the rebirth level (10, 20, 30 ...).
  const rebirthPct = useGameStore((s) => {
    const { level, top, fraction } = levelProgress(s.speed, s.rebirths)
    return level >= top ? 100 : Math.min(99, Math.floor(((level - 1 + fraction) / (top - 1)) * 100))
  })
  const dailyReady = useGameStore((s) => now - s.daily.at >= DAILY_COOLDOWN_MS)
  const playtimeReady = useGameStore((s) =>
    PLAYTIME_REWARDS.some((r, i) => !s.playtimeClaimed.includes(i) && now - s.sessionStart >= r.minutes * 60000),
  )
  const alerts = { rebirth: rebirthPct >= 100, daily: dailyReady, playtime: playtimeReady }

  return (
    <Drawer id="menu" side="left" label="menu">
      <div className="menu-grid">
        {BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`gbtn menu-btn live ${b.id === 'rebirth' && alerts.rebirth ? 'bg-rainbow' : b.bg}`}
            onClick={() => openPanel(b.id)}
          >
            {b.id === 'rebirth' && <span className="badge ol">{rebirthPct}%</span>}
            {alerts[b.id] && <span className="dot ol">!</span>}
            {b.img ? (
              <img className="icon-img" src={b.img} alt="" />
            ) : (
              <span className="icon" aria-hidden>
                <Icon name={b.icon} />
              </span>
            )}
            <span className="label ol">{b.label}</span>
          </button>
        ))}
      </div>
    </Drawer>
  )
}

export default LeftMenu
