import { useBloxityStore } from '../bloxity/store'

const GUEST_KEY = 'villain-evo-uid'
let guestUid = null

/** This browser's guest id, made once and kept in localStorage. */
function localGuestUid() {
  if (guestUid) return guestUid
  try {
    guestUid = localStorage.getItem(GUEST_KEY)
    if (!guestUid) {
      guestUid = `g:${crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)}`
      localStorage.setItem(GUEST_KEY, guestUid)
    }
  } catch {
    guestUid ||= `g:${Math.random().toString(36).slice(2)}`
  }
  return guestUid
}

/** Stable id for leaderboards: the Bloxity user id, or this browser's guest id. */
export function playerUid() {
  const user = useBloxityStore.getState().user
  const id = user?._id || user?.id || user?.legionId
  return id ? `u:${id}` : localGuestUid()
}

/** The name other players see. */
export function displayName() {
  const { user, guest } = useBloxityStore.getState()
  const identity = user || guest
  return identity?.username || identity?.displayName || 'Guest'
}
