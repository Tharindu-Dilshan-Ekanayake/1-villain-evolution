import {
  BELT_LENGTH,
  BELT_WIDTH,
  EGG_SPOTS,
  GATE_Z,
  inStageArea,
  PAD_SIZE,
  PAD_SPOTS,
  padX,
  padZ,
  PEDESTAL_PAD,
  PEDESTALS,
  SPAWN,
  stageAtZ,
  wallZ,
} from '../game/layout'
import { loadStage } from '../game/stageLoader'
import { canRebirth, hitDamage, padWins, rebirthLevel, STAGE_COUNT, treadmillUnlocked } from './economy'
import { TUTORIAL_DONE, useGameStore } from './gameStore'
import {
  context,
  events,
  nowSeconds,
  player,
  requestFlex,
  requestVictory,
  resetRun,
  stageRun,
  trainer,
} from './runtime'
import { advanceTutorial } from './tutorial'

/**
 * Gameplay rules that run outside React's render loop: everything time-based runs on
 * a 10 Hz tick. Store writes happen here and in UI handlers only - never inside
 * useFrame.
 */

/* --- Walls ------------------------------------------------------------------- */

/** True if a slam with the player's current Speed would break stage `s`'s wall. */
export function slamBreaks(s) {
  return !stageRun.broken[s] && stageRun.hp[s] <= hitDamage(useGameStore.getState())
}

/**
 * One slam into stage `s`'s wall, dealing the player's Speed as damage. A wall with
 * more HP than that just loses that much: 10 HP hit by 3 Speed is left on 7 (and the
 * villain bounces off).
 */
export function hitWall(s) {
  if (s < 0 || s >= STAGE_COUNT || stageRun.broken[s]) return
  const state = useGameStore.getState()
  const max = stageRun.maxHp[s]
  stageRun.hp[s] = Math.max(0, stageRun.hp[s] - hitDamage(state))
  stageRun.damage[s] = 1 - stageRun.hp[s] / max
  stageRun.hitAt[s] = nowSeconds()

  if (stageRun.hp[s] <= 0) {
    stageRun.broken[s] = 1
    stageRun.damage[s] = 1
    events.emit('wallBreak', { index: s, impactX: player.x, x: player.x, z: wallZ(s) })
    state.recordWallBreak()
    return
  }

  // Cracks spread at 25 / 50 / 75 % damage, each with its own crack sound.
  const crackStage = Math.min(3, Math.floor(stageRun.damage[s] * 4))
  if (crackStage > stageRun.crackStage[s]) {
    stageRun.crackStage[s] = crackStage
    events.emit('wallCrack', { index: s, stage: crackStage })
  }
  events.emit('wallHit', { index: s, x: player.x })
}

/* --- Respawn ------------------------------------------------------------------- */

/** Back to the lobby, with every wall rebuilt. */
export function respawn() {
  resetRun()
  useGameStore.getState().setRebuildAt(0)
  events.emit('teleport', SPAWN)
}

/* --- Prompts ----------------------------------------------------------------------- */

function onPad(x, z, spot) {
  return Math.abs(x - spot.x) < BELT_LENGTH / 2 - 0.25 && Math.abs(z - spot.z) < BELT_WIDTH / 2 + 0.05
}

function findPrompt(state, x, z) {
  for (const ped of PEDESTALS) {
    if (Math.abs(x - ped.x) < PEDESTAL_PAD / 2 + 0.3 && Math.abs(z - ped.z) < PEDESTAL_PAD / 2 + 0.3) {
      return { key: `villain:${ped.id}`, kind: 'villain', id: ped.id }
    }
  }
  for (const spot of EGG_SPOTS) {
    if (Math.abs(x - spot.padX) < 1.6 && Math.abs(z - spot.padZ) < 1.6) return { key: `egg:${spot.id}`, kind: 'egg', id: spot.id }
  }
  for (const spot of PAD_SPOTS) {
    if (onPad(x, z, spot) && !treadmillUnlocked(state, spot.id)) return { key: `pad:${spot.id}`, kind: 'pad', id: spot.id }
  }
  return null
}

/* --- Tick ------------------------------------------------------------------------- */

/** Seconds of victory pose on a WINS pad before the player is sent home. */
const VICTORY_SECONDS = 1.6

/** Seconds back in the lobby before broken walls rebuild. */
const REBUILD_SECONDS = 10

/** Collects stage `s`'s Wins and sends the player home; the walls rebuild. */
function claimPad(s, state) {
  if (stageRun.claimed) return
  stageRun.claimed = true
  const wins = padWins(s, state)
  state.addWins(wins)
  events.emit('padClaim', { wins, stage: s })
  requestVictory()
  setTimeout(() => {
    respawn()
    // Back in the lobby: the claimed Wins fly into the counter (ui/winsFlight.js).
    events.emit('winsHome', { wins })
  }, VICTORY_SECONDS * 1000)
}

/** Starts the 10 Hz gameplay tick. Returns a stop function. */
export function startGameLoop() {
  let last = performance.now()
  let playAcc = 0
  let lobbyFor = 0
  let lastStage = -2
  let stagePrefetched = false
  let readyFor = 0
  let wasRebirthReady = true

  const offRebirth = events.on('rebirth', () => {
    respawn()
    // Let the teleport land before the flex.
    setTimeout(requestFlex, 150)
  })

  const tick = () => {
    const now = performance.now()
    const dt = Math.min(0.5, (now - last) / 1000)
    last = now
    if (!player.ready) return

    const state = useGameStore.getState()
    const { x, z } = player

    // --- Zone & lazy stage mount ------------------------------------------------
    const inStage = inStageArea(x, z)
    const zone = inStage ? 'stage' : 'lobby'
    if (zone !== context.zone) {
      context.zone = zone
      events.emit('zone', { zone })
    }
    // The stage chunk loads once the lobby is up (never during the initial load), and
    // mounts once the HUD is on screen; the gate then shows Stage 1's wall from the lobby.
    if (state.sceneReady) {
      readyFor += dt
      if (!stagePrefetched) {
        stagePrefetched = true
        loadStage().catch(() => {
          stagePrefetched = false
        })
      }
      if (readyFor > 1.6 && !state.stageActive) state.setStageActive(true)
    }

    // Which stage the player is in; being past a wall counts as reaching that stage.
    const stage = inStage ? stageAtZ(z) : -1
    if (stage !== lastStage) {
      lastStage = stage
      state.setStageHere(stage)
      if (stage >= 0) state.reachStage(stage)
    }

    // Back in the lobby with walls broken: they rebuild after 10 seconds.
    if (!inStage && z > GATE_Z + 2 && stageRun.broken[0] && !stageRun.claimed) {
      if (lobbyFor === 0) state.setRebuildAt(Date.now() + REBUILD_SECONDS * 1000)
      lobbyFor += dt
      if (lobbyFor >= REBUILD_SECONDS) {
        lobbyFor = 0
        resetRun()
        state.setRebuildAt(0)
      }
    } else if (lobbyFor > 0) {
      lobbyFor = 0
      state.setRebuildAt(0)
    }

    // --- WINS pads ----------------------------------------------------------------
    if (stage >= 0 && !stageRun.claimed && stageRun.broken[stage]) {
      const reach = PAD_SIZE / 2 + 0.35
      if (Math.abs(x - padX()) < reach && Math.abs(z - padZ(stage)) < reach) claimPad(stage, state)
    }

    // --- Treadmills ------------------------------------------------------------------
    context.pad = null
    if (!inStage) {
      for (const spot of PAD_SPOTS) {
        if (onPad(x, z, spot) && treadmillUnlocked(state, spot.id)) {
          context.pad = spot.id
          context.padYaw = spot.yaw
          break
        }
      }
    }

    // --- Footsteps -> Speed (one store write per tick) ---------------------------------
    if (trainer.steps > 0) {
      const steps = trainer.steps
      trainer.steps = 0
      const padId = player.training ? context.pad : null
      const gain = useGameStore.getState().addSteps(steps, padId)
      events.emit('gain', { gain, steps, pad: padId })
    }

    // --- Prompt ------------------------------------------------------------------
    const prompt = findPrompt(state, x, z)
    const current = useGameStore.getState().prompt
    if ((prompt?.key || null) !== (current?.key || null)) useGameStore.getState().setPrompt(prompt)

    // --- Rebirth ready: celebrate once ---------------------------------------------
    const fresh = useGameStore.getState()
    const ready = canRebirth(fresh)
    if (ready && !wasRebirthReady) {
      requestFlex()
      fresh.showToast(`Level ${rebirthLevel(fresh.rebirths)}! Rebirth is ready - open Rebirth to multiply your Speed`, 'good')
    }
    wasRebirthReady = ready

    // --- Play time & tutorial -----------------------------------------------------
    playAcc += dt
    if (playAcc >= 5) {
      fresh.addPlayTime(Math.floor(playAcc))
      playAcc -= Math.floor(playAcc)
    }
    if (fresh.tutorial !== TUTORIAL_DONE) {
      const next = advanceTutorial(fresh)
      if (next !== fresh.tutorial) {
        fresh.setTutorial(next)
        events.emit('ui')
      }
    }
  }

  const id = setInterval(tick, 100)
  return () => {
    clearInterval(id)
    offRebirth()
  }
}
