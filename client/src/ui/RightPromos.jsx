import { useNetStore } from '../net/netStore'
import { BOOST_BY_ID } from '../state/content'
import { boostCost, formatDuration, formatNumber } from '../state/economy'
import { useGameStore } from '../state/gameStore'
import Drawer from './Drawer'
import Icon from './Icon'
import { useNow } from './hooks'

const PROMOS = [
  { id: 'speed', bg: 'bg-blue' },
  { id: 'wins', bg: 'bg-yellow' },
]

/** How long a line stays in the activity feed. */
const FEED_MS = 9000

/**
 * Quick-buy boost cards, priced in Wins (the reference's 2x Speed / 2x Wins). Each
 * card is one button; a running boost shows its time left. On phones the stack slides
 * away behind an arrow.
 */
export function RightPromos() {
  const now = useNow(1000)
  const boosts = useGameStore((s) => s.boosts)
  const wins = useGameStore((s) => s.wins)
  const cost = useGameStore((s) => boostCost(s))
  const buyBoost = useGameStore((s) => s.buyBoost)

  return (
    <Drawer id="promos" side="right" label="boosts">
      <div className="promo-stack">
        {PROMOS.map((p) => {
          const boost = BOOST_BY_ID[p.id]
          const left = (boosts[p.id] || 0) - now
          return (
            <button key={p.id} type="button" className={`gbtn promo live ${p.bg}`} onClick={() => buyBoost(p.id)}>
              <span className="promo-tag ol">{left > 0 ? `Active ${formatDuration(left)}` : `${boost.minutes} min`}</span>
              <span className="promo-title ol">
                <Icon name={boost.icon} /> {boost.name}
              </span>
              <span className={`promo-price ol ${wins >= cost ? 'can-buy' : ''}`}>
                <Icon name="trophy" /> {formatNumber(cost)}
              </span>
            </button>
          )
        })}
      </div>
    </Drawer>
  )
}

/** What everyone in the lobby is up to: hatches, new villains, rebirths, stages. */
export function Feed() {
  const feed = useNetStore((s) => s.feed)
  const now = useNow(feed.length ? 1000 : 60000)
  const live = feed.filter((f) => now - f.at < FEED_MS)
  if (live.length === 0) return null
  return (
    <div className="feed" aria-live="polite">
      {live.map((f) => (
        // The HTML is built from escaped names and fixed content (netStore.feedHtml).
        <div key={f.id} className="feed-line ol" dangerouslySetInnerHTML={{ __html: f.html }} />
      ))}
    </div>
  )
}

export default RightPromos
