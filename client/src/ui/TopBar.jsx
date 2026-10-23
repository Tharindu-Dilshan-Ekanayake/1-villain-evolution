import { formatDuration, STAGE_COUNT, treadmillOp } from '../state/economy'
import { useGameStore } from '../state/gameStore'
import { useNow } from './hooks'
import Icon from './Icon'

/** The shared Treadmill OP event: a countdown to it, or to its end while it runs. */
function EventTimer() {
  const now = useNow(1000)
  const op = treadmillOp(now)
  return op.active ? (
    <div className="event-timer live ol">
      <Icon name="fire" /> Treadmill OP <span className="x2">x2</span> ends in <span className="tnum">{formatDuration(op.endsIn)}</span>
    </div>
  ) : (
    <div className="event-timer ol">
      FREE Treadmill OP in <span className="tnum">{formatDuration(op.startsIn)}</span>
    </div>
  )
}

/**
 * Where you are on the line of stages: the stage you're in out on the track; your best
 * stage and the wall-rebuild countdown in the lobby.
 */
function StageChip() {
  const here = useGameStore((s) => s.stageHere)
  const best = useGameStore((s) => s.stats.bestStage)
  const rebuildAt = useGameStore((s) => s.rebuildAt)
  const now = useNow(rebuildAt ? 250 : 60000)
  const rebuildIn = rebuildAt ? Math.max(0, Math.ceil((rebuildAt - now) / 1000)) : 0

  if (here >= 0) {
    return (
      <div className="stage-chip ol">
        STAGE {here + 1}/{STAGE_COUNT}
      </div>
    )
  }
  return (
    <div className="stage-chip ol">
      {best >= STAGE_COUNT ? (
        <>
          <Icon name="star" /> WORLD 1 CLEAR
        </>
      ) : (
        `BEST: STAGE ${Math.max(1, best)}/${STAGE_COUNT}`
      )}
      {rebuildIn > 0 && <span className="stage-walls">Walls rebuild in {rebuildIn}s</span>}
    </div>
  )
}

/** The top centre: event countdown and stage chip. */
export function TopBar() {
  return (
    <div className="top-bar">
      <div className="top-center">
        <EventTimer />
        <StageChip />
      </div>
    </div>
  )
}

export default TopBar
