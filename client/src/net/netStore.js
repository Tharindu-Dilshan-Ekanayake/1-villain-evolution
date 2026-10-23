import { create } from 'zustand'

import { PET_BY_ID, RARITIES, VILLAIN_BY_ID } from '../state/content'
import { icon } from '../ui/icons'

/**
 * Multiplayer state.
 *
 * React-visible (zustand): connection status, lobby number, each remote player's look
 * and the activity feed - things that change rarely and re-render a component when
 * they do.
 *
 * Per-frame (`remotes`): the latest position/facing/slam reported for each remote
 * player. The network callbacks write it, the RemotePlayers frame loop reads it;
 * neither goes through React.
 */
export const useNetStore = create((set) => ({
  /** 'offline' | 'connecting' | 'online' */
  status: 'offline',
  lobby: 0,
  /** sessionId -> { name, morph, skin, level, rebirths, power, pets, uid } */
  players: {},
  /** Latest activity first: [{ id, html, at }]. */
  feed: [],

  setStatus: (status) => set({ status }),
  setLobby: (lobby) => set({ lobby }),
  setPlayer: (id, profile) => set((s) => ({ players: { ...s.players, [id]: profile } })),
  removePlayer: (id) =>
    set((s) => {
      const players = { ...s.players }
      delete players[id]
      return { players }
    }),
  clearPlayers: () => set({ players: {} }),
}))

/** sessionId -> { x, z, y, yaw, speed, train, slam, slamKind } as last reported. */
export const remotes = new Map()

/** Max players in one lobby; the server opens a new lobby for the next one. */
export const LOBBY_SIZE = 8

const FEED_SIZE = 5
let feedId = 0

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The feed line for one piece of news, or null for anything unrecognised. */
function feedHtml(msg) {
  const who = `<b>${escape(msg.name || 'Someone')}</b>`
  switch (msg.kind) {
    case 'hatch': {
      const pet = PET_BY_ID[msg.id]
      if (!pet) return null
      const rarity = RARITIES[pet.rarity]
      return `${icon('egg')} ${who} hatched a <span style="color:${rarity.color}">${rarity.name} ${escape(pet.name)}</span>!`
    }
    case 'villain': {
      const villain = VILLAIN_BY_ID[msg.id]
      if (!villain) return null
      const color = villain.aura?.color || villain.fx?.color || '#ffffff'
      return `${icon('villain')} ${who} became <span style="color:${color}">${escape(villain.name)}</span>!`
    }
    case 'rebirth':
      return `${icon('rebirth')} ${who} reached <span style="color:#ffd23f">Rebirth ${Math.floor(Number(msg.rebirths) || 0)}</span>!`
    case 'stage':
      return `${icon('boom')} ${who} broke into <span style="color:#41e05a">Stage ${Math.floor(Number(msg.stage) || 0)}</span>!`
    default:
      return null
  }
}

/** Adds a piece of news to the activity feed (it fades out by itself in the HUD). */
export function pushFeed(msg) {
  const html = feedHtml(msg)
  if (!html) return
  feedId += 1
  useNetStore.setState((s) => ({ feed: [{ id: feedId, html, at: Date.now() }, ...s.feed].slice(0, FEED_SIZE) }))
}
