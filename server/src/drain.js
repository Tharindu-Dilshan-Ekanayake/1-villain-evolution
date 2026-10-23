/**
 * Zero-downtime deploys on Bloxity Legion.
 *
 * On a deploy or scale-down Legion sends SIGTERM and waits up to 10 minutes before
 * stopping the pod. Left alone, Colyseus would disconnect every player at once.
 * Instead this pod stops taking players and asks each one to hop to a fresh pod - the
 * client asks the matchmaker again, which routes it to the new pod - a few at a time,
 * then lets Colyseus shut down once the lobbies are empty (or after DRAIN_MAX_MS).
 * Game progress lives on the client, so a hop is a moment of "reconnecting", not a loss.
 */

/** Longest the drain waits for lobbies to empty before Colyseus closes what's left. */
const DRAIN_MAX_MS = 30000
/** Players leave at random within this window, so the new pod isn't hit all at once. */
const STAGGER_MS = 3000

let draining = false
const lobbies = new Set()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** True once the pod has started draining: new players are turned away. */
const isDraining = () => draining

/** Registers a live lobby; returns the function that unregisters it. */
function track(room) {
  lobbies.add(room)
  return () => lobbies.delete(room)
}

/** Asks every player to move to a fresh pod and waits for the lobbies to empty. */
async function drain() {
  if (draining) return
  draining = true
  const rooms = [...lobbies]
  const players = rooms.reduce((n, room) => n + room.clients.length, 0)
  console.log(`[drain] ${process.env.POD_NAME || 'server'}: moving ${players} players from ${rooms.length} lobbies to a fresh pod`)
  for (const room of rooms) {
    await room.lock()
    for (const client of room.clients) client.send('migrate', { inMs: Math.floor(Math.random() * STAGGER_MS) })
  }
  const until = Date.now() + DRAIN_MAX_MS
  while (Date.now() < until && rooms.some((room) => room.clients.length > 0)) await sleep(250)
  const left = rooms.reduce((n, room) => n + room.clients.length, 0)
  console.log(`[drain] done${left ? ` (${left} still connected; closing them)` : ''}`)
}

module.exports = { drain, isDraining, track }
