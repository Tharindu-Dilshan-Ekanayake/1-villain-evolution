const { Room, ServerError } = require('@colyseus/core')

const { isDraining, track } = require('../drain')
const leaderboard = require('../leaderboard')
const { assignUid } = require('../uids')
const { LobbyState, Player } = require('./state')

/** Players per lobby. The matchmaker opens a new lobby for the next player. */
const MAX_PLAYERS = 8

/** World bounds with slack: the lobby is ~90 m across, the 50-stage line ~2.1 km long. */
const WORLD_X = 200
const WORLD_Z_MIN = -2400
const WORLD_Z_MAX = 200
/** Fastest a player can legitimately run (level, villain, sprint), with slack. */
const MAX_SPEED = 60
/** Highest Speed a name tag will show. */
const MAX_POWER = 1e300

/** News kinds the activity feed accepts, and how often one player may post. */
const FEED_KINDS = new Set(['hatch', 'villain', 'rebirth', 'stage'])
const FEED_GAP_MS = 400
/** Wall smashes relayed per player, at most one per this gap. */
const SMASH_GAP_MS = 150

let lobbyCounter = 0

const finite = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const text = (v, max = 32) => (typeof v === 'string' ? v.slice(0, max) : '')
/** Content ids are short lowercase words. */
const contentId = (v) => (typeof v === 'string' && /^[a-z0-9]{1,16}$/.test(v) ? v : '')

/**
 * A shared lobby for up to eight players.
 *
 * The server relays what each client reports - position, facing, wall slams, its
 * villain, pets and Speed - after sanitising it, and passes on the news that makes
 * the lobby feel alive: wall smashes and the activity feed (hatches, new villains,
 * rebirths, stages). Game progress stays on each client; the server also hands every
 * new player their UID.
 */
class LobbyRoom extends Room {
  maxClients = MAX_PLAYERS
  /** 20 state patches per second; clients interpolate between them. */
  patchRate = 50
  /** Clients send ~15 moves per second; anything far above that is abuse. */
  maxMessagesPerSecond = 60

  onCreate() {
    this.untrack = track(this)
    lobbyCounter += 1
    this.state = new LobbyState()
    this.state.lobby = lobbyCounter
    this.metadata = { lobby: lobbyCounter }

    this.onMessage('move', (client, msg) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || !msg) return
      p.x = clamp(finite(msg.x, p.x), -WORLD_X, WORLD_X)
      p.z = clamp(finite(msg.z, p.z), WORLD_Z_MIN, WORLD_Z_MAX)
      p.y = clamp(finite(msg.y, 0), 0, 10)
      p.yaw = finite(msg.yaw, p.yaw)
      p.speed = clamp(finite(msg.speed, 0), 0, MAX_SPEED)
      p.train = msg.train ? 1 : 0
    })

    // A wall slam: 0 the wall held (knockback), 1 it broke.
    this.onMessage('slam', (client, kind) => {
      const p = this.state.players.get(client.sessionId)
      if (!p) return
      p.slamKind = kind === 1 ? 1 : 0
      p.slam = (p.slam + 1) % 65536
    })

    this.onMessage('profile', (client, profile) => {
      const p = this.state.players.get(client.sessionId)
      if (p && profile) applyProfile(p, profile)
    })

    this.onMessage('power', (client, power) => {
      const p = this.state.players.get(client.sessionId)
      if (p) p.power = clamp(finite(power, 0), 0, MAX_POWER)
    })

    // Another player sees the dust when you smash a wall.
    this.onMessage('smash', (client, msg) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || !msg || !throttle(client, 'smash', SMASH_GAP_MS)) return
      this.broadcast(
        'smash',
        { x: clamp(finite(msg.x, p.x), -WORLD_X, WORLD_X), z: clamp(finite(msg.z, p.z), WORLD_Z_MIN, WORLD_Z_MAX) },
        { except: client },
      )
    })

    // The activity feed: shown to everyone in the lobby, the sender too.
    this.onMessage('feed', (client, msg) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || !msg || !FEED_KINDS.has(msg.kind) || !throttle(client, 'feed', FEED_GAP_MS)) return
      this.broadcast('feed', {
        name: p.name,
        kind: msg.kind,
        id: contentId(msg.id),
        rebirths: clamp(Math.round(finite(msg.rebirths, 0)), 0, 65535),
        stage: clamp(Math.round(finite(msg.stage, 0)), 0, 999),
      })
    })

    // Leaderboard records (best Speed, Wins earned, Rebirths, Play time).
    this.onMessage('stats', (client, stats) => {
      const p = this.state.players.get(client.sessionId)
      if (p && client.userData?.uid) leaderboard.report(client.userData.uid, p.name, stats)
    })
  }

  /** A pod that is draining for a deploy sends players on to the fresh one. */
  onAuth() {
    if (isDraining()) throw new ServerError(503, 'server is moving to a new pod')
    return true
  }

  async onJoin(client, options) {
    const p = new Player()
    p.name = text(options?.name, 24) || 'Guest'
    p.x = 0
    p.z = 24
    p.yaw = Math.PI
    applyProfile(p, options || {})
    // Stable id across sessions (Bloxity user id, or the browser's guest id).
    const key = text(options?.uid, 80)
    client.userData = { uid: key, last: {} }
    this.state.players.set(client.sessionId, p)
    console.log(`[lobby ${this.state.lobby}] ${p.name} joined (${this.clients.length}/${MAX_PLAYERS})`)
    // The player's number: theirs forever from their first join.
    const uid = await assignUid(key)
    if (uid && this.state.players.get(client.sessionId) === p) p.uid = uid
  }

  onLeave(client) {
    const p = this.state.players.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    console.log(`[lobby ${this.state.lobby}] ${p?.name || client.sessionId} left (${this.clients.length}/${MAX_PLAYERS})`)
  }

  onDispose() {
    this.untrack?.()
  }
}

/** True (and records the time) if `kind` hasn't been sent within `gap` ms. */
function throttle(client, kind, gap) {
  const last = client.userData?.last
  if (!last) return false
  const now = Date.now()
  if (now - (last[kind] || 0) < gap) return false
  last[kind] = now
  return true
}

function applyProfile(p, profile) {
  if ('morph' in profile) p.morph = contentId(profile.morph) || 'bloxity'
  if ('skin' in profile) p.skin = text(profile.skin, 200)
  if ('level' in profile) p.level = clamp(Math.round(finite(profile.level, 1)), 0, 65535)
  if ('rebirths' in profile) p.rebirths = clamp(Math.round(finite(profile.rebirths, 0)), 0, 65535)
  if ('pets' in profile) {
    p.pets = text(profile.pets, 60)
      .split(',')
      .map(contentId)
      .filter(Boolean)
      .slice(0, 3)
      .join(',')
  }
}

module.exports = { LobbyRoom, MAX_PLAYERS }
