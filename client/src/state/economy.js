import {
  BOOST_BY_ID,
  EGG_BY_ID,
  PET_BY_ID,
  PET_SLOTS,
  PETS_BY_EGG,
  TREADMILL_BY_ID,
  TREADMILL_OP,
  TREADMILLS,
  VILLAIN_BY_ID,
  VILLAIN_SPEED,
} from './content'

/**
 * Pure game-balance formulas. No state lives here, so the store, the HUD and the
 * gameplay tick all agree on every number.
 *
 * The loop: every step your villain takes pays Speed (more on a treadmill). Speed is
 * also your power: slamming into a stage wall hits it for your Speed, and a wall with
 * more HP than that just loses that much (10 HP hit by 3 Speed is left on 7) and
 * knocks you back for another run at it. Break a
 * stage's wall, step on its WINS pad, and the Wins buy stronger villains, treadmills
 * and eggs. Your Speed also sets your Level: reach Level 10 to rebirth (then 20, 30 ...),
 * which starts you again from Level 1 with a permanent multiplier.
 *
 * The curves were tuned with a greedy-player simulation (real pet odds included):
 * Stage 5 in ~2 minutes, Stage 20 in ~30, Stage 30 in ~70, then a long climb - Stage 40
 * in ~2 hours, Stage 50 in ~4 - of efficient play (2-3x that for a normal player). Past
 * rebirth 15 each rebirth costs x5 but multiplies the bonus by x2.5, so every late
 * rebirth takes a little longer than the one before.
 */

/** Rounds to two significant figures (4,512 -> 4,500), so prices read cleanly. */
export function nice(value) {
  if (!Number.isFinite(value)) return value
  if (value < 100) return Math.round(value)
  const p = 10 ** (Math.floor(Math.log10(value)) - 1)
  return Math.round(value / p) * p
}

/* --- Stages ------------------------------------------------------------- */

/** World 1: fifty stages in one long line, one wall and one WINS pad each. */
export const STAGE_COUNT = 50

/**
 * HP of stage `s`'s wall (0-based): 10 for Stage 1, then x3.35 a stage, x2.8 after
 * Stage 20 and x2.3 after Stage 30 (where the late game would otherwise stall):
 * 120, 400, 1.3K, 4.5K ...
 */
export function wallHp(s) {
  if (s <= 0) return 10
  const early = 3.35 ** Math.min(s - 1, 19)
  const mid = 2.8 ** Math.min(9, Math.max(0, s - 20))
  const late = 2.3 ** Math.max(0, s - 29)
  return nice(120 * early * mid * late)
}

/**
 * Wins on stage `s`'s pad: 3 on Stage 1 (exactly the first villain), nearly doubling
 * every stage, so pushing deeper before cashing in pays. Each rebirth adds +20%.
 */
export function padWins(s, state, now = Date.now()) {
  const base = 3 * 1.9 ** Math.max(0, s) * (1 + 0.2 * (state?.rebirths || 0))
  return Math.max(1, Math.round(base * boostMultiplier(state, 'wins', now)))
}

/** A wall hit deals your Speed, never less than 1 so a fresh player can start. */
export const hitDamage = (state) => Math.max(1, Math.floor(state.speed))


/* --- Levels ------------------------------------------------------------- */

/**
 * Levels count up to the next rebirth: Rebirth 1 at Level 10, Rebirth 2 at Level 20,
 * Rebirth 3 at Level 30 ... and every rebirth starts you again from Level 1.
 *
 * A level is a Speed milestone inside the current rebirth: Level 2 at 1/2500 of the
 * rebirth's Speed, the top level exactly at it, spaced evenly on a log scale between.
 * Speed grows by multiplying (villains, treadmills, pets), so level-ups arrive at a
 * steady pace; later rebirths have more levels, so they come quicker.
 */
export const LEVELS_PER_REBIRTH = 10
const FIRST_LEVEL_SHARE = 1 / 2500

/** The level that unlocks the next rebirth: 10, 20, 30 ... */
export const rebirthLevel = (rebirths) => LEVELS_PER_REBIRTH * (rebirths + 1)

/** Speed at which Level 2 starts in this rebirth. */
const firstLevelSpeed = (rebirths) => Math.max(10, rebirthCost(rebirths) * FIRST_LEVEL_SHARE)

/** Speed at which `level` starts, in rebirth `rebirths`. */
export function levelSpeed(level, rebirths) {
  if (level <= 1) return 0
  const top = rebirthLevel(rebirths)
  const cost = rebirthCost(rebirths)
  if (level >= top) return cost
  const first = firstLevelSpeed(rebirths)
  return first * (cost / first) ** ((level - 2) / (top - 2))
}

export function levelFromSpeed(speed, rebirths) {
  const top = rebirthLevel(rebirths)
  const cost = rebirthCost(rebirths)
  if (speed >= cost) return top
  const first = firstLevelSpeed(rebirths)
  if (speed < first) return 1
  const raw = 2 + Math.floor((Math.log(speed / first) / Math.log(cost / first)) * (top - 2) + 1e-9)
  return Math.min(top - 1, Math.max(2, raw))
}

export const levelOf = (state) => levelFromSpeed(state.speed, state.rebirths)

/** Everything the level bar needs: the level, the rebirth level, Speed to the next level. */
export function levelProgress(speed, rebirths) {
  const level = levelFromSpeed(speed, rebirths)
  const top = rebirthLevel(rebirths)
  const isMax = level >= top
  const start = levelSpeed(level, rebirths)
  const next = isMax ? start : levelSpeed(level + 1, rebirths)
  const fraction = isMax ? 1 : Math.min(1, Math.max(0, (speed - start) / (next - start)))
  return { level, top, isMax, next, fraction }
}

/** Levels climbed over every rebirth so far plus this one: 10 + 20 + ... + the current. */
export const totalLevel = (state) => 5 * state.rebirths * (state.rebirths + 1) + levelOf(state)

/**
 * Running speed in m/s: a little faster with every level ever climbed (so a rebirth
 * back to Level 1 never leaves you slower), and every villain up the list runs a
 * little quicker. Capped so the camera can keep up.
 */
export function moveSpeed(state) {
  return state.settings?.normalSpeed ? NORMAL_RUN_SPEED : powerRunSpeed(state)
}

/** Your own running pace from levels and villain, whatever the Normal Speed switch says. */
export function powerRunSpeed(state) {
  const villain = VILLAIN_SPEED[state.villain] || 1
  return Math.min(43, (10.8 + 0.108 * (totalLevel(state) - 1)) * villain)
}

/** The Normal Speed switch: everyone runs at this plain pace (m/s). */
export const NORMAL_RUN_SPEED = 8

/* --- Speed gain ------------------------------------------------------------ */

/** x1.5 per rebirth for the first fifteen; after that each one multiplies it by x2.5. */
export const rebirthMultiplier = (rebirths) => (1 + 0.5 * rebirths) * 2.5 ** Math.max(0, rebirths - 15)

/** Pets add their boosts: three +0.5 pets make 2.5x. */
export function petMultiplier(state) {
  let sum = 0
  for (const uid of state.equippedPets || []) {
    const pet = state.pets?.find((p) => p.uid === uid)
    if (pet) sum += PET_BY_ID[pet.id]?.boost || 0
  }
  return 1 + sum
}

export function boostActive(state, id, now = Date.now()) {
  return (state?.boosts?.[id] || 0) > now
}

export function boostMultiplier(state, id, now = Date.now()) {
  return boostActive(state, id, now) ? BOOST_BY_ID[id].mult : 1
}

/** True during Treadmill OP. Allocation-free, for frame loops. */
export const isTreadmillOp = (now = Date.now()) => now % TREADMILL_OP.periodMs < TREADMILL_OP.durationMs

/** Treadmill OP: a shared 2-minute window every 15 minutes, from the wall clock. */
export function treadmillOp(now = Date.now()) {
  const into = now % TREADMILL_OP.periodMs
  const active = into < TREADMILL_OP.durationMs
  return {
    active,
    endsIn: active ? TREADMILL_OP.durationMs - into : 0,
    startsIn: active ? 0 : TREADMILL_OP.periodMs - into,
    mult: active ? TREADMILL_OP.mult : 1,
  }
}

/** The "Multiplier x1.73" figure: rebirths x pets x the Speed boost. */
export function speedMultiplier(state, now = Date.now()) {
  return rebirthMultiplier(state.rebirths) * petMultiplier(state) * boostMultiplier(state, 'speed', now)
}

export const basePerStep = (state) => VILLAIN_BY_ID[state.villain]?.perStep || 1

/** Speed for one step, optionally on a treadmill (which Treadmill OP doubles). */
export function speedPerStep(state, padId = null, now = Date.now()) {
  const pad = padId ? TREADMILL_BY_ID[padId] : null
  const padMult = pad ? pad.mult * treadmillOp(now).mult : 1
  return basePerStep(state) * padMult * speedMultiplier(state, now)
}

/* --- Treadmills -------------------------------------------------------------- */

export function treadmillUnlocked(state, padId) {
  const pad = TREADMILL_BY_ID[padId]
  if (!pad) return false
  if (pad.req.rebirths) return state.rebirths >= pad.req.rebirths
  if (pad.req.wins) return state.ownedPads.includes(padId)
  return true
}

/* --- Villains ---------------------------------------------------------------- */

export function canAffordVillain(state, id) {
  const v = VILLAIN_BY_ID[id]
  if (!v) return false
  if (v.cost.rp) return state.rebirthPoints >= v.cost.rp
  return state.wins >= (v.cost.wins || 0)
}

/* --- Rebirth ------------------------------------------------------------------ */

/** Speed needed for rebirth `r + 1`: 25K, then x5 a rebirth (x4 from ten, x5 from fifteen). */
export function rebirthCost(rebirths) {
  const early = 5 ** Math.min(rebirths, 10)
  const mid = 4 ** Math.min(5, Math.max(0, rebirths - 10))
  const late = 5 ** Math.max(0, rebirths - 15)
  return nice(25000 * early * mid * late)
}

/** Rebirth unlocks at the top level of this rebirth (10, 20, 30 ...). */
export const canRebirth = (state) => levelOf(state) >= rebirthLevel(state.rebirths)

/** The next treadmill a rebirth count unlocks, if any. */
export function treadmillUnlockedAt(rebirths) {
  return TREADMILLS.find((t) => t.req.rebirths === rebirths) || null
}

/* --- Eggs ----------------------------------------------------------------------- */

/**
 * Rolls one pet out of `eggId`. Lucky Hatch doubles the weight of everything but the
 * egg's most common pet.
 */
export function rollPet(eggId, state, rand = Math.random, now = Date.now()) {
  const pool = PETS_BY_EGG[eggId] || []
  const lucky = boostActive(state, 'luck', now)
  const weights = pool.map((p, i) => p.chance * (lucky && i > 0 ? 2 : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/** The chance shown in the egg's list, accounting for Lucky Hatch. */
export function petChance(eggId, petId, state, now = Date.now()) {
  const pool = PETS_BY_EGG[eggId] || []
  const lucky = boostActive(state, 'luck', now)
  const weights = pool.map((p, i) => p.chance * (lucky && i > 0 ? 2 : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const i = pool.findIndex((p) => p.id === petId)
  return i < 0 ? 0 : (weights[i] / total) * 100
}

export const eggCost = (eggId) => EGG_BY_ID[eggId]?.cost ?? Infinity

/** The best `PET_SLOTS` pets in an inventory, by boost. */
export function bestPets(pets) {
  return [...pets]
    .sort((a, b) => (PET_BY_ID[b.id]?.boost || 0) - (PET_BY_ID[a.id]?.boost || 0))
    .slice(0, PET_SLOTS)
    .map((p) => p.uid)
}

/* --- Rewards ------------------------------------------------------------------- */

/** "N win pads of Wins": rewards scale with the best stage you have reached. */
export function padsOfWins(state, count) {
  const best = Math.max(0, (state.stats?.bestStage || 1) - 1)
  return Math.max(3, Math.round(count * 3 * 1.9 ** best * (1 + 0.2 * (state.rebirths || 0))))
}

/** Price of a 15-minute boost: four win pads of your best stage, at least 20. */
export function boostCost(state) {
  return Math.max(20, nice(padsOfWins(state, 4)))
}

export const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000
/** Miss more than this and the daily streak starts again from day 1. */
export const DAILY_STREAK_RESET_MS = 48 * 60 * 60 * 1000

/* --- Formatting ------------------------------------------------------------------ */

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

/** 7 -> "7", 21.6 -> "21.6", 738 -> "738", 1130 -> "1.13K", 362900 -> "362.9K". */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return '∞'
  const n = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (n < 100) return sign + String(Math.floor(n * 10) / 10)
  if (n < 1000) return sign + String(Math.floor(n))
  let tier = Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(n) / 3))
  let scaled = n / 1000 ** tier
  // 999.95K must read 1M, not 1000K.
  if (Math.floor(scaled * 100) / 100 >= 1000 && tier < SUFFIXES.length - 1) {
    tier += 1
    scaled = n / 1000 ** tier
  }
  const digits = scaled < 10 ? 2 : 1
  const k = 10 ** digits
  const rounded = Math.floor(scaled * k) / k
  return sign + String(rounded) + SUFFIXES[tier]
}

export function formatMultiplier(value) {
  if (value < 100) return `x${Math.round(value * 100) / 100}`
  return `x${formatNumber(value)}`
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v) => String(v).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}:${pad(s)}`
}

/** Pet slots that hold a pet, in slot order. */
export function equippedPetIds(state) {
  return (state.equippedPets || [])
    .map((uid) => state.pets?.find((p) => p.uid === uid)?.id)
    .filter(Boolean)
}
