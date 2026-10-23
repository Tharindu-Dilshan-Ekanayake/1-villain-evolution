import { create } from 'zustand'

import {
  BOOST_BY_ID,
  CODES,
  DAILY_REWARDS,
  EGG_BY_ID,
  PET_BY_ID,
  PET_INVENTORY,
  PET_SLOTS,
  PLAYTIME_REWARDS,
  TREADMILL_BY_ID,
  VILLAIN_BY_ID,
} from './content'
import {
  bestPets,
  boostCost,
  canRebirth,
  DAILY_COOLDOWN_MS,
  DAILY_STREAK_RESET_MS,
  levelFromSpeed,
  padsOfWins,
  rebirthLevel,
  rollPet,
  speedPerStep,
  STAGE_COUNT,
  treadmillUnlockedAt,
} from './economy'
import { events } from './runtime'

/**
 * The player's progress (persisted) plus a little UI state (not persisted).
 *
 * Writers: UI event handlers and the 10 Hz gameplay tick. Never the frame loop.
 */

const SAVE_PREFIX = 'villain-evo-save-v1:'

export const TUTORIAL_DONE = 99

function freshProgress() {
  return {
    /** Current Speed: your power against walls. A rebirth resets it. */
    speed: 0,
    wins: 0,
    rebirths: 0,
    /** Spent on rebirth villains; one is earned per rebirth. */
    rebirthPoints: 0,
    ownedVillains: ['bloxity'],
    villain: 'bloxity',
    ownedPads: ['t1'],
    /** Inventory: [{ uid, id }]. */
    pets: [],
    equippedPets: [],
    nextPetUid: 1,
    /** Boost id -> expiry timestamp (ms). */
    boosts: {},
    daily: { at: 0, streak: 0 },
    codes: [],
    /** Server-assigned player number, cached once known. */
    uid: 0,
    stats: {
      steps: 0,
      walls: 0,
      winsEarned: 0,
      bestStage: 0,
      playSeconds: 0,
      bestSpeed: 0,
      hatched: 0,
    },
    tutorial: 0,
    // normalSpeed: run at a plain walking pace instead of your Speed (the HUD switch).
    settings: { music: true, sfx: true, normalSpeed: false },
    lastSeen: Date.now(),
  }
}

const PROGRESS_KEYS = Object.keys(freshProgress())

function pickProgress(state) {
  const out = {}
  for (const key of PROGRESS_KEYS) out[key] = state[key]
  return out
}

/** Merges a saved blob over fresh defaults, so older saves gain any new fields. */
function hydrate(saved) {
  const base = freshProgress()
  if (!saved || typeof saved !== 'object') return base
  const merged = { ...base, ...saved }
  for (const key of ['stats', 'settings', 'daily', 'boosts']) {
    merged[key] = { ...base[key], ...(saved[key] || {}) }
  }
  if (!Array.isArray(merged.ownedVillains)) merged.ownedVillains = ['bloxity']
  merged.ownedVillains = merged.ownedVillains.filter((id) => VILLAIN_BY_ID[id])
  if (!merged.ownedVillains.includes('bloxity')) merged.ownedVillains.unshift('bloxity')
  if (!merged.ownedVillains.includes(merged.villain)) merged.villain = 'bloxity'
  if (!Array.isArray(merged.ownedPads)) merged.ownedPads = ['t1']
  if (!Array.isArray(merged.pets)) merged.pets = []
  merged.pets = merged.pets.filter((p) => p && PET_BY_ID[p.id] && Number.isFinite(p.uid))
  if (!Array.isArray(merged.equippedPets)) merged.equippedPets = []
  merged.equippedPets = merged.equippedPets.filter((uid) => merged.pets.some((p) => p.uid === uid)).slice(0, PET_SLOTS)
  for (const key of ['speed', 'wins', 'rebirths', 'rebirthPoints', 'nextPetUid']) {
    if (!Number.isFinite(merged[key]) || merged[key] < 0) merged[key] = base[key]
  }
  merged.nextPetUid = Math.max(merged.nextPetUid, 1 + merged.pets.reduce((m, p) => Math.max(m, p.uid), 0))
  return merged
}

function readSave(key) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeSave(key, progress) {
  try {
    localStorage.setItem(SAVE_PREFIX + key, JSON.stringify(progress))
  } catch {
    // Storage full or blocked: progress just won't persist this session.
  }
}

const toastNow = (text, tone = 'info') => ({ toast: { text, tone, at: Date.now() } })

export const useGameStore = create((set, get) => ({
  ...freshProgress(),

  /* --- UI state (not saved) --- */
  saveKey: null,
  /** True once the avatar is assembled and a frame has rendered. */
  sceneReady: false,
  /** Open modal panel id, or null. */
  panel: null,
  /** Proximity prompt descriptor, or null. */
  prompt: null,
  /** True once the lazy stage chunk should be mounted (shortly after the lobby). */
  stageActive: false,
  /** Stage the player is in (0-based), or -1 in the lobby. */
  stageHere: -1,
  /** When the broken walls rebuild (ms timestamp), or 0 if nothing is pending. */
  rebuildAt: 0,
  /** Short message toast. */
  toast: null,
  /** The latest hatch to animate: { egg, pets: [petId], at }, or null. */
  hatch: null,
  /** This session's start, for the playtime rewards. */
  sessionStart: Date.now(),
  /** Playtime reward indices claimed this session. */
  playtimeClaimed: [],

  /* --- Persistence --- */

  /**
   * Loads the save for `key` (a Bloxity user id, or 'guest'). Signing in with no save
   * of your own keeps the progress you made as a guest.
   */
  loadSave: (key) => {
    const current = get()
    if (current.saveKey === key) return
    const saved = readSave(key)
    const progress = hydrate(saved || pickProgress(current))
    progress.lastSeen = Date.now()
    set({ ...progress, saveKey: key })
  },

  save: () => {
    const s = get()
    if (!s.saveKey) return
    writeSave(s.saveKey, { ...pickProgress(s), lastSeen: Date.now() })
  },

  resetProgress: () => {
    const s = get()
    const fresh = { ...freshProgress(), uid: s.uid }
    set({ ...fresh, panel: null, prompt: null })
    if (s.saveKey) writeSave(s.saveKey, fresh)
  },

  /* --- UI --- */

  openPanel: (panel) => {
    set({ panel })
    events.emit('ui')
  },
  closePanel: () => set({ panel: null }),
  setPrompt: (prompt) => set({ prompt }),
  setStageActive: (stageActive) => set({ stageActive }),
  setStageHere: (stageHere) => set({ stageHere }),
  setRebuildAt: (rebuildAt) => set({ rebuildAt }),
  showToast: (text, tone = 'info') => set(toastNow(text, tone)),
  clearHatch: () => set({ hatch: null }),
  setUid: (uid) => {
    if (Number.isFinite(uid) && uid > 0 && uid !== get().uid) set({ uid })
  },

  /* --- Core loop --- */

  /**
   * Pays out `steps` footsteps, on treadmill `padId` (or walking when null). One
   * store write however many steps landed. Returns the Speed gained.
   */
  addSteps: (steps, padId = null) => {
    if (steps <= 0) return 0
    const s = get()
    const now = Date.now()
    const gain = speedPerStep(s, padId, now) * steps
    const speed = s.speed + gain
    const before = levelFromSpeed(s.speed, s.rebirths)
    const after = levelFromSpeed(speed, s.rebirths)
    set({
      speed,
      stats: { ...s.stats, steps: s.stats.steps + steps, bestSpeed: Math.max(s.stats.bestSpeed, speed) },
    })
    if (after > before) events.emit('levelUp', { level: after })
    return gain
  },

  addWins: (amount) => {
    const s = get()
    set({ wins: s.wins + amount, stats: { ...s.stats, winsEarned: s.stats.winsEarned + amount } })
  },

  recordWallBreak: () => {
    const s = get()
    set({ stats: { ...s.stats, walls: s.stats.walls + 1 } })
  },

  /** Broke into stage `stage` (0-based). */
  reachStage: (stage) => {
    const s = get()
    if (stage + 1 <= s.stats.bestStage) return
    set({ stats: { ...s.stats, bestStage: stage + 1 } })
    events.emit('feed', { kind: 'stage', stage: stage + 1 })
    if (stage === STAGE_COUNT - 1) set(toastNow(`World 1 cleared! All ${STAGE_COUNT} stages done 👑`, 'good'))
  },

  addPlayTime: (seconds) => {
    const s = get()
    set({ stats: { ...s.stats, playSeconds: s.stats.playSeconds + seconds } })
  },

  /** Spends Wins if affordable. Emits an error sound and toast when not. */
  spendWins: (amount) => {
    const s = get()
    if (s.wins < amount) {
      events.emit('error')
      set(toastNow(`You need ${Math.ceil(amount - s.wins).toLocaleString()} more Wins`, 'error'))
      return false
    }
    set({ wins: s.wins - amount })
    return true
  },

  rebirth: () => {
    const s = get()
    if (!canRebirth(s)) {
      events.emit('error')
      set(toastNow(`Reach Level ${rebirthLevel(s.rebirths)} to rebirth`, 'error'))
      return false
    }
    const rebirths = s.rebirths + 1
    set({ speed: 0, rebirths, rebirthPoints: s.rebirthPoints + 1, panel: null })
    events.emit('rebirth', { rebirths })
    events.emit('feed', { kind: 'rebirth', rebirths })
    const pad = treadmillUnlockedAt(rebirths)
    if (pad) set(toastNow(`${pad.name} unlocked! (x${pad.mult} Speed)`, 'good'))
    return true
  },

  /* --- Villains --- */

  buyVillain: (id) => {
    const v = VILLAIN_BY_ID[id]
    const s = get()
    if (!v || s.ownedVillains.includes(id)) return false
    if (v.cost.rp) {
      if (s.rebirthPoints < v.cost.rp) {
        events.emit('error')
        set(toastNow(`You need ${v.cost.rp - s.rebirthPoints} more Rebirth Point${v.cost.rp - s.rebirthPoints === 1 ? '' : 's'}`, 'error'))
        return false
      }
      set({ rebirthPoints: s.rebirthPoints - v.cost.rp })
    } else if (!get().spendWins(v.cost.wins || 0)) {
      return false
    }
    set({ ownedVillains: [...get().ownedVillains, id], villain: id })
    events.emit('purchase', { kind: 'villain', id })
    events.emit('transform', { id })
    events.emit('feed', { kind: 'villain', id })
    return true
  },

  equipVillain: (id) => {
    const s = get()
    if (!s.ownedVillains.includes(id) || s.villain === id) return
    set({ villain: id })
    events.emit('transform', { id })
  },

  /* --- Treadmills --- */

  buyPad: (id) => {
    const pad = TREADMILL_BY_ID[id]
    const s = get()
    if (!pad?.req.wins || s.ownedPads.includes(id)) return false
    if (!get().spendWins(pad.req.wins)) return false
    set({ ownedPads: [...get().ownedPads, id] })
    events.emit('purchase', { kind: 'pad', id })
    return true
  },

  /* --- Eggs & pets --- */

  /** Hatches `count` of an egg. Returns the pets hatched, or null. */
  hatchEgg: (eggId, count = 1) => {
    const egg = EGG_BY_ID[eggId]
    const s = get()
    if (!egg) return null
    const room = PET_INVENTORY - s.pets.length
    if (room <= 0) {
      events.emit('error')
      set(toastNow('Your pet inventory is full - delete some pets first', 'error'))
      return null
    }
    const n = Math.max(1, Math.min(count, room))
    if (!get().spendWins(egg.cost * n)) return null
    const now = Date.now()
    const after = get()
    const hatched = []
    let uid = after.nextPetUid
    const pets = [...after.pets]
    for (let i = 0; i < n; i += 1) {
      const pet = rollPet(eggId, after, Math.random, now)
      pets.push({ uid, id: pet.id })
      hatched.push(pet.id)
      uid += 1
    }
    // New pets are auto-equipped when they beat what you have on.
    const best = bestPets(pets)
    const better = best.some((u) => !after.equippedPets.includes(u))
    set({
      pets,
      nextPetUid: uid,
      equippedPets: better ? best : after.equippedPets,
      hatch: { egg: eggId, pets: hatched, at: now },
      stats: { ...after.stats, hatched: after.stats.hatched + n },
    })
    events.emit('hatch', { egg: eggId, pets: hatched })
    for (const id of hatched) {
      const rarity = PET_BY_ID[id].rarity
      if (rarity === 'legendary' || rarity === 'mythic' || rarity === 'epic') events.emit('feed', { kind: 'hatch', id })
    }
    return hatched
  },

  equipPet: (uid) => {
    const s = get()
    if (!s.pets.some((p) => p.uid === uid) || s.equippedPets.includes(uid)) return
    const equippedPets = [...s.equippedPets, uid]
    if (equippedPets.length > PET_SLOTS) equippedPets.shift()
    set({ equippedPets })
    events.emit('equip', { pet: uid })
  },

  unequipPet: (uid) => {
    const s = get()
    if (!s.equippedPets.includes(uid)) return
    set({ equippedPets: s.equippedPets.filter((u) => u !== uid) })
    events.emit('ui')
  },

  equipBestPets: () => {
    set({ equippedPets: bestPets(get().pets) })
    events.emit('equip', {})
  },

  deletePet: (uid) => {
    const s = get()
    set({ pets: s.pets.filter((p) => p.uid !== uid), equippedPets: s.equippedPets.filter((u) => u !== uid) })
    events.emit('ui')
  },

  /* --- Boosts --- */

  addBoostMinutes: (id, minutes) => {
    const s = get()
    const from = Math.max(Date.now(), s.boosts[id] || 0)
    set({ boosts: { ...s.boosts, [id]: from + minutes * 60 * 1000 } })
  },

  buyBoost: (id) => {
    const boost = BOOST_BY_ID[id]
    if (!boost) return false
    if (!get().spendWins(boostCost(get()))) return false
    get().addBoostMinutes(id, boost.minutes)
    events.emit('purchase', { kind: 'boost', id })
    set(toastNow(`${boost.name} active for ${boost.minutes} minutes!`, 'good'))
    return true
  },

  /** Pays a reward: { winsPads, boost, boostMinutes }. Returns a description. */
  grantReward: (reward) => {
    const parts = []
    if (reward.winsPads) {
      const wins = padsOfWins(get(), reward.winsPads)
      get().addWins(wins)
      parts.push(`+${wins.toLocaleString()} Wins`)
    }
    if (reward.boost) {
      const minutes = reward.boostMinutes || 15
      get().addBoostMinutes(reward.boost, minutes)
      parts.push(`${minutes} min ${BOOST_BY_ID[reward.boost].name}`)
    }
    return parts.join(' & ')
  },

  /* --- Daily streak & playtime --- */

  claimDaily: () => {
    const s = get()
    const now = Date.now()
    if (now - s.daily.at < DAILY_COOLDOWN_MS) return false
    const streak = now - s.daily.at > DAILY_STREAK_RESET_MS ? 1 : (s.daily.streak % DAILY_REWARDS.length) + 1
    const reward = DAILY_REWARDS[streak - 1]
    set({ daily: { at: now, streak } })
    const text = get().grantReward({ winsPads: reward.winsPads, boost: reward.boost, boostMinutes: 15 })
    events.emit('purchase', { kind: 'daily' })
    set(toastNow(`Day ${streak} reward: ${text}!`, 'good'))
    return true
  },

  claimPlaytime: (index) => {
    const s = get()
    const reward = PLAYTIME_REWARDS[index]
    if (!reward || s.playtimeClaimed.includes(index)) return false
    if (Date.now() - s.sessionStart < reward.minutes * 60 * 1000) return false
    set({ playtimeClaimed: [...s.playtimeClaimed, index] })
    const text = get().grantReward(reward)
    events.emit('purchase', { kind: 'playtime' })
    set(toastNow(`Playtime reward: ${text}!`, 'good'))
    return true
  },

  redeemCode: (input) => {
    const code = String(input || '').trim().toUpperCase()
    const reward = CODES[code]
    const s = get()
    if (!reward) return { ok: false, message: 'That code is not valid.' }
    if (s.codes.includes(code)) return { ok: false, message: 'Code already redeemed.' }
    set({ codes: [...s.codes, code] })
    const text = get().grantReward(reward)
    events.emit('purchase', { kind: 'code' })
    return { ok: true, message: `Redeemed: ${text}` }
  },

  /* --- Tutorial & settings --- */

  setTutorial: (step) => set({ tutorial: step }),
  skipTutorial: () => set({ tutorial: TUTORIAL_DONE }),

  setSetting: (key, value) => set({ settings: { ...get().settings, [key]: value } }),
}))

/* --- Autosave ---------------------------------------------------------------- */

let saveTimer = null

/** Saves at most every 2 seconds, and immediately when the tab hides or closes. */
export function startAutosave() {
  const unsubscribe = useGameStore.subscribe((state, prev) => {
    if (!state.saveKey) return
    const changed = PROGRESS_KEYS.some((key) => state[key] !== prev[key])
    if (!changed || saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      useGameStore.getState().save()
    }, 2000)
  })

  const flush = () => useGameStore.getState().save()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flush)

  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flush)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
  }
}
