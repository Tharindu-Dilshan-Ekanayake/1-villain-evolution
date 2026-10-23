import { assetUrls, skinCompositeUrl, skinIdOrDefault } from '../bloxity/avatarAssets'
import { useBloxityStore } from '../bloxity/store'
import { equippedPetIds, levelOf } from '../state/economy'
import { useGameStore } from '../state/gameStore'
import { events, player } from '../state/runtime'
import { resolveGameEndpoint } from './endpoints'
import { displayName, playerUid } from './identity'
import { pushFeed, remotes, useNetStore } from './netStore'

/**
 * Multiplayer over Colyseus: everyone in a lobby of up to 8 sees everyone else - where
 * they are, the villain they've become (with its aura), their pets, level, Speed and
 * rebirths - and what they do: wall slams, knockbacks and smashes, treadmill training, hatches,
 * new villains, rebirths and new stages (the activity feed).
 *
 * The SDK is a separate chunk, imported only once the game is up, so it adds nothing
 * to the initial load. The server opens a new lobby for the 9th player. Hosted on
 * Bloxity Legion, each connect first asks the matchmaker for a seat (endpoints.js).
 * If the server can't be reached the game stays single-player and retries in the
 * background, with backoff.
 */

const SEND_INTERVAL_MS = 66
/** Resend at least this often, so a standing player still shows up as alive. */
const HEARTBEAT_MS = 2000
const RETRY_MIN_MS = 3000
/** After leaving a lobby, rejoin after this long plus up to the jitter. */
const REJOIN_MS = 300
const REJOIN_JITTER_MS = 1200
const RETRY_MAX_MS = 30000
const STATS_INTERVAL_MS = 15000

let room = null
let started = false
let stopped = false
let retryMs = RETRY_MIN_MS
let retryTimer = null
let sendTimer = null
let lastSent = { x: NaN, z: NaN, y: NaN, yaw: NaN, speed: NaN, at: 0 }
let lastProfileKey = ''
let statsTimer = null
let lastStatsKey = ''
const offs = []

/** What other players need to draw this player. */
function currentProfile() {
  const s = useGameStore.getState()
  const equipped = useBloxityStore.getState().equipped
  return {
    name: displayName(),
    morph: s.villain,
    skin: skinCompositeUrl(equipped) || assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId)),
    level: levelOf(s),
    rebirths: s.rebirths,
    pets: equippedPetIds(s).join(','),
  }
}

function sendProfileIfChanged() {
  if (!room) return
  const profile = currentProfile()
  const key = JSON.stringify(profile)
  if (key === lastProfileKey) return
  lastProfileKey = key
  room.send('profile', profile)
}

/** Leaderboard records: best Speed, Wins earned, Rebirths, Play time. */
function sendStatsIfChanged() {
  if (!room) return
  const s = useGameStore.getState()
  const stats = {
    speed: s.stats.bestSpeed,
    wins: s.stats.winsEarned,
    rebirths: s.rebirths,
    time: Math.floor(s.stats.playSeconds),
  }
  const key = `${stats.speed}|${stats.wins}|${stats.rebirths}|${Math.floor(stats.time / 60)}`
  if (key === lastStatsKey) return
  lastStatsKey = key
  room.send('stats', stats)
}

function sendMove() {
  if (!room || !player.ready) return
  const now = performance.now()
  const y = Math.max(0, player.y - 0.9)
  const moved =
    Math.abs(player.x - lastSent.x) > 0.02 ||
    Math.abs(player.z - lastSent.z) > 0.02 ||
    Math.abs(y - lastSent.y) > 0.02 ||
    Math.abs(player.yaw - lastSent.yaw) > 0.02 ||
    Math.abs(player.speed - lastSent.speed) > 0.3
  if (!moved && now - lastSent.at < HEARTBEAT_MS) return
  lastSent = { x: player.x, z: player.z, y, yaw: player.yaw, speed: player.speed, at: now }
  room.send('move', { x: player.x, z: player.z, y, yaw: player.yaw, speed: player.speed, train: player.training ? 1 : 0 })
}

const profileOf = (p) => ({
  name: p.name,
  morph: p.morph,
  skin: p.skin,
  level: p.level,
  rebirths: p.rebirths,
  pets: p.pets,
  uid: p.uid,
})

function attachRoom(sdk, joined) {
  room = joined
  retryMs = RETRY_MIN_MS
  lastProfileKey = ''
  lastStatsKey = ''
  sendStatsIfChanged()
  const net = useNetStore.getState()
  net.setStatus('online')

  const callbacks = sdk.Callbacks.get(room)
  callbacks.listen('lobby', (value) => useNetStore.getState().setLobby(value), true)

  callbacks.onAdd('players', (p, id) => {
    if (id === room.sessionId) {
      // Our own entry carries the UID the server gave this player.
      const syncUid = () => p.uid && useGameStore.getState().setUid(p.uid)
      syncUid()
      callbacks.onChange(p, syncUid)
      return
    }
    remotes.set(id, { x: p.x, z: p.z, y: p.y, yaw: p.yaw, speed: p.speed, train: p.train, slam: p.slam, slamKind: p.slamKind })
    let profileKey = ''
    const sync = () => {
      const r = remotes.get(id)
      if (!r) return
      r.x = p.x
      r.z = p.z
      r.y = p.y
      r.yaw = p.yaw
      r.speed = p.speed
      r.train = p.train
      r.slam = p.slam
      r.slamKind = p.slamKind
      // Looks change rarely: only then does React hear about it.
      const profile = profileOf(p)
      const key = JSON.stringify(profile)
      if (key !== profileKey) {
        profileKey = key
        useNetStore.getState().setPlayer(id, profile)
      }
    }
    sync()
    callbacks.onChange(p, sync)
  })

  callbacks.onRemove('players', (_p, id) => {
    remotes.delete(id)
    useNetStore.getState().removePlayer(id)
  })

  // Another player's wall smash: dust and a crash where they are.
  room.onMessage('smash', (msg) => {
    if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) events.emit('remoteBreak', msg)
  })
  // The activity feed: hatches, new villains, rebirths, stages.
  room.onMessage('feed', (msg) => {
    if (msg && typeof msg.name === 'string') pushFeed(msg)
  })

  // The server is moving to a fresh pod (a deploy): leave when it says, then rejoin
  // through the matchmaker straight away.
  room.onMessage('migrate', (msg) => {
    const left = room
    setTimeout(() => {
      if (room === left) left.leave(true)
    }, Math.min(10000, Math.max(0, Number(msg?.inMs) || 0)))
  })

  room.onLeave(() => {
    room = null
    remotes.clear()
    useNetStore.getState().clearPlayers()
    useNetStore.getState().setStatus('offline')
    // Straight back in (a pod was replaced, or the connection dropped), a little apart
    // from everyone else; if that fails the usual backoff takes over.
    if (stopped) return
    clearTimeout(retryTimer)
    retryMs = RETRY_MIN_MS
    retryTimer = setTimeout(connect, REJOIN_MS + Math.random() * REJOIN_JITTER_MS)
  })
}

async function connect() {
  if (stopped || room) return
  useNetStore.getState().setStatus('connecting')
  try {
    const sdk = await import('@colyseus/sdk')
    // A new Client for every endpoint: hosted, each one is pinned to one server pod.
    const endpoint = await resolveGameEndpoint()
    if (stopped) return
    const client = new sdk.Client(endpoint)
    const joined = await client.joinOrCreate('lobby', { ...currentProfile(), uid: playerUid() })
    if (stopped) {
      joined.leave()
      return
    }
    attachRoom(sdk, joined)
  } catch (err) {
    if (retryMs === RETRY_MIN_MS) console.info('[net] multiplayer server unavailable; playing solo for now.', err?.message)
    useNetStore.getState().setStatus('offline')
    scheduleRetry()
  }
}

function scheduleRetry() {
  if (stopped) return
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, retryMs)
  retryMs = Math.min(RETRY_MAX_MS, retryMs * 2)
}

/** Joins a lobby once; safe to call more than once. Returns a stop function. */
export function startMultiplayer() {
  if (started) return stopMultiplayer
  started = true
  stopped = false
  connect()
  sendTimer = setInterval(sendMove, SEND_INTERVAL_MS)
  statsTimer = setInterval(sendStatsIfChanged, STATS_INTERVAL_MS)
  offs.push(
    events.on('slam', ({ broke }) => {
      if (room) room.send('slam', broke ? 1 : 0)
    }),
    events.on('wallBreak', ({ x, z, index }) => {
      if (room) room.send('smash', { x, z, stage: index + 1 })
    }),
    // Your own news goes through the server (which shows it to everyone, you too);
    // playing solo, it goes straight into your feed.
    events.on('feed', (item) => {
      if (room) room.send('feed', item)
      else pushFeed({ ...item, name: displayName() })
    }),
    useGameStore.subscribe((s, prev) => {
      if (
        s.villain !== prev.villain ||
        s.rebirths !== prev.rebirths ||
        s.speed !== prev.speed ||
        s.equippedPets !== prev.equippedPets ||
        s.pets !== prev.pets
      ) {
        sendProfileIfChanged()
      }
    }),
    useBloxityStore.subscribe((s, prev) => {
      if (s.equipped !== prev.equipped || s.user !== prev.user) sendProfileIfChanged()
    }),
  )
  return stopMultiplayer
}

export function stopMultiplayer() {
  stopped = true
  started = false
  clearTimeout(retryTimer)
  clearInterval(sendTimer)
  clearInterval(statsTimer)
  offs.splice(0).forEach((off) => off())
  room?.leave()
  room = null
  remotes.clear()
  useNetStore.getState().clearPlayers()
  useNetStore.getState().setStatus('offline')
}
