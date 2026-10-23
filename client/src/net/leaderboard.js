import { create } from 'zustand'

import { API_URL } from './endpoints'
import { playerUid } from './identity'

/**
 * Lobby leaderboards from the game server: top ten per board, plus this player's
 * rank on each. Polled every 30 s while the tab is visible; when the server can't be
 * reached the boards simply show the player's own records.
 */
export const useLeaderboard = create(() => ({
  /** { speed|wins|rebirths|time: [{ id?: 'you', name, value }] } */
  boards: null,
  /** { board: rank } for this player, when ranked. */
  you: {},
  online: false,
}))

const POLL_MS = 30000

async function poll() {
  if (document.visibilityState !== 'visible') return
  try {
    const res = await fetch(`${API_URL}/api/leaderboard?uid=${encodeURIComponent(playerUid())}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    useLeaderboard.setState({ boards: data.boards || null, you: data.you || {}, online: true })
  } catch {
    useLeaderboard.setState({ online: false })
  }
}

/** Starts polling; returns a stop function. */
export function startLeaderboard() {
  poll()
  const id = setInterval(poll, POLL_MS)
  const onVisible = () => document.visibilityState === 'visible' && poll()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(id)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
