import { BOOST_BY_ID, TREADMILL_BY_ID } from '../state/content'
import { boostActive, formatDuration, formatMultiplier, formatNumber, speedMultiplier, treadmillOp } from '../state/economy'
import { useGameStore } from '../state/gameStore'
import { context, events } from '../state/runtime'
import { useLevel, useNow } from './hooks'
import Icon from './Icon'

/**
 * Your Speed and multiplier over the level bar, as in the reference: "34.27K Speed" on
 * the left, "Multiplier x1.73" on the right, active boosts and the treadmill you're on
 * above them.
 */
/** Normal Speed ON: run at a plain pace. OFF (the default): run at your Speed. */
function SpeedSwitch() {
  const normal = useGameStore((s) => Boolean(s.settings.normalSpeed))
  const setSetting = useGameStore((s) => s.setSetting)
  return (
    <button
      type="button"
      className={`gbtn speed-switch ${normal ? 'on bg-green' : 'bg-dark'}`}
      aria-pressed={normal}
      onClick={() => {
        events.emit('ui')
        setSetting('normalSpeed', !normal)
      }}
    >
      <span className="ss-label ol">Normal Speed</span>
      <span className="ss-track">
        <span className="ss-knob" />
        <span className="ss-state">{normal ? 'ON' : 'OFF'}</span>
      </span>
    </button>
  )
}

export function BottomBar() {
  const now = useNow(1000)
  const speed = useGameStore((s) => s.speed)
  // Primitive selectors: the bar only re-renders when a number changes.
  const mult = useGameStore((s) => speedMultiplier(s, now))
  const boosts = useGameStore((s) => s.boosts)
  const { level, top, isMax, next, fraction } = useLevel()
  const pad = context.pad ? TREADMILL_BY_ID[context.pad] : null
  const op = treadmillOp(now)

  const active = Object.keys(BOOST_BY_ID).filter((id) => boostActive({ boosts }, id, now))

  return (
    <div className="bottom-bar">
      <div className="bottom-info">
        <div className="bottom-left">
          {active.map((id) => (
            <div key={id} className="boosts ol">
              <Icon name={BOOST_BY_ID[id].icon} /> {BOOST_BY_ID[id].name} ({formatDuration(boosts[id] - now)})
            </div>
          ))}
          {pad && (
            <div className="boosts ol bag-boost">
              x{formatNumber(pad.mult * op.mult)} {pad.name}
            </div>
          )}
          <div className="speed-amount ol">
            <span className="tnum">{formatNumber(speed)}</span> Speed
          </div>
        </div>
        <div className="mult-text ol">
          Multiplier <span className="tnum">{formatMultiplier(mult)}</span>
        </div>
      </div>
      <div className="level-row">
        <SpeedSwitch />
        <div className="level-bar">
          <div className="level-fill" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
          <div className="level-text ol">
            <span>
              Level {level}
              <span className="level-top">/{top}</span>
            </span>
            <span className="right tnum">{isMax ? 'MAX - Rebirth!' : `${formatNumber(speed)} / ${formatNumber(next)}`}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BottomBar
