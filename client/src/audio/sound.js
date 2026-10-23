import { useGameStore } from '../state/gameStore'
import { events, player } from '../state/runtime'
import { renderEffects, renderLoops, toAudioBuffer } from './synth'

/**
 * Game audio.
 *
 * All sounds are synthesized in a Web Worker once the scene has loaded (see synth.js),
 * so nothing ships as an audio file and nothing stalls the main thread. The
 * AudioContext itself is only created inside the first tap / key press, as browsers
 * require; the rendered samples are wrapped into AudioBuffers at that point.
 */

let ctx = null
let master = null
let sfxBus = null
let musicBus = null
let ambienceBus = null
let effects = null
let musicSource = null
let unlockStarted = false

/** Raw rendered sample sets from the worker, waiting for an AudioContext. */
const rendered = { effects: null, loops: null }
let synthesisStarted = false

/** Sound synthesis starts this long after the game is playable. */
const SYNTH_DELAY_MS = 1500

const MUSIC_VOLUME = 0.32
const AMBIENCE_VOLUME = 0.22
const SFX_VOLUME = 0.9

/** Per-sound throttle, so a burst of events can't stack 20 copies of one sample. */
const lastPlayed = new Map()
const MIN_GAP = { click: 0.05, step: 0.12, whoosh: 0.04, wallHit: 0.05, punch: 0.1, shatter: 0.08, ui: 0.03 }

export function play(name, { volume = 1, rate = 1, detune = 0.04 } = {}) {
  if (!ctx || !effects || ctx.state !== 'running') return
  const buffer = effects[name]
  if (!buffer) return
  const now = ctx.currentTime
  const gap = MIN_GAP[name] ?? 0.02
  if (now - (lastPlayed.get(name) ?? -1) < gap) return
  lastPlayed.set(name, now)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * detune)
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.connect(gain).connect(sfxBus)
  source.start()
  source.onended = () => gain.disconnect()
}

function startLoop(buffer, bus) {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  source.connect(bus)
  source.start()
  return source
}

/** The breeze is full in the lobby, quieter out on the stage line. */
let ambienceLevel = 1

function applySettings() {
  if (!ctx) return
  const { settings } = useGameStore.getState()
  const t = ctx.currentTime
  sfxBus.gain.setTargetAtTime(settings.sfx ? SFX_VOLUME : 0, t, 0.05)
  musicBus.gain.setTargetAtTime(settings.music ? MUSIC_VOLUME : 0, t, 0.3)
  ambienceBus.gain.setTargetAtTime(settings.music ? AMBIENCE_VOLUME * ambienceLevel : 0, t, 0.5)
}

/** Wraps whatever the worker has delivered so far into AudioBuffers and starts loops. */
function attachRendered() {
  if (!ctx) return
  if (rendered.effects && !effects) {
    effects = {}
    for (const [name, data] of Object.entries(rendered.effects)) effects[name] = toAudioBuffer(ctx, data)
  }
  if (rendered.loops && !musicSource) {
    musicSource = startLoop(toAudioBuffer(ctx, rendered.loops.music), musicBus)
    startLoop(toAudioBuffer(ctx, rendered.loops.ambience), ambienceBus)
    applySettings()
  }
}

/** Starts rendering every sound in a worker (falls back to the main thread). */
function startSynthesis() {
  if (synthesisStarted) return
  synthesisStarted = true
  try {
    const worker = new Worker(new URL('./synth.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      rendered[data.kind] = data.set
      attachRendered()
      if (data.kind === 'loops') worker.terminate()
    }
    worker.onerror = (err) => {
      console.warn('[audio] synth worker failed; rendering on the main thread', err)
      worker.terminate()
      renderOnMainThread()
    }
    worker.postMessage('render')
  } catch {
    renderOnMainThread()
  }
}

function renderOnMainThread() {
  setTimeout(() => {
    rendered.effects = rendered.effects || renderEffects()
    attachRendered()
    setTimeout(() => {
      rendered.loops = rendered.loops || renderLoops()
      attachRendered()
    }, 500)
  }, 0)
}

function unlock() {
  if (unlockStarted) return
  unlockStarted = true
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  try {
    ctx = new AudioContextClass({ latencyHint: 'interactive' })
  } catch (err) {
    console.warn('[audio] AudioContext unavailable', err)
    return
  }
  master = ctx.createGain()
  master.gain.value = 0.85
  // A gentle limiter keeps a shatter plus a win chime from clipping.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.knee.value = 6
  limiter.ratio.value = 8
  limiter.attack.value = 0.003
  limiter.release.value = 0.15
  master.connect(limiter).connect(ctx.destination)

  sfxBus = ctx.createGain()
  musicBus = ctx.createGain()
  ambienceBus = ctx.createGain()
  musicBus.gain.value = 0
  ambienceBus.gain.value = 0
  sfxBus.connect(master)
  musicBus.connect(master)
  ambienceBus.connect(master)

  ctx.resume?.()
  applySettings()
  // A tap before the scene finished loading: start rendering now.
  startSynthesis()
  attachRendered()
}

/**
 * Installs the first-gesture unlock, the store and visibility listeners, and maps
 * gameplay events onto sounds. Returns a cleanup function.
 */
export function initAudio() {
  const gestures = ['pointerdown', 'keydown', 'touchstart']
  const onGesture = () => {
    unlock()
    for (const g of gestures) window.removeEventListener(g, onGesture, true)
  }
  for (const g of gestures) window.addEventListener(g, onGesture, true)

  // Render the sounds a moment after the game is up, so synthesis never competes with
  // loading or the first playable frames.
  let synthTimer = null
  const startSoon = () => {
    if (!synthTimer) synthTimer = setTimeout(startSynthesis, SYNTH_DELAY_MS)
  }
  if (useGameStore.getState().sceneReady) startSoon()
  const unsubscribeStore = useGameStore.subscribe((s, prev) => {
    if (s.sceneReady && !prev.sceneReady) startSoon()
    if (s.settings !== prev.settings) applySettings()
  })

  const onVisibility = () => {
    if (!ctx) return
    if (document.visibilityState === 'hidden') ctx.suspend?.()
    else ctx.resume?.()
  }
  document.addEventListener('visibilitychange', onVisibility)

  let combo = 0
  let lastClick = 0
  const offs = [
    // Every Speed payout pops, pitching up while you keep running.
    events.on('gain', ({ pad } = {}) => {
      const now = performance.now()
      combo = now - lastClick < 600 ? Math.min(combo + 1, 14) : 0
      lastClick = now
      play('click', { volume: pad ? 0.26 : 0.14, rate: 1 + combo * 0.035, detune: 0.01 })
    }),
    // Body slam: a meaty thump on impact; a whoosh as the wall throws you back.
    events.on('slam', ({ broke } = {}) => play('punch', { volume: broke ? 1 : 0.85, rate: broke ? 0.7 : 0.85 })),
    events.on('knockback', () => play('whoosh', { volume: 0.55, rate: 0.7 })),
    events.on('wallHit', ({ heavy } = {}) => play('wallHit', { volume: heavy ? 0.95 : 0.7, rate: heavy ? 0.85 : 1 })),
    events.on('wallCrack', () => play('crack', { volume: 0.85 })),
    events.on('wallBreak', () => play('shatter', { volume: 1, detune: 0.06 })),
    events.on('padClaim', () => play('win', { volume: 0.8 })),
    events.on('hatch', () => play('hatch', { volume: 0.85, detune: 0 })),
    // Another player's smash: quieter the further away it is.
    events.on('remoteBreak', ({ x, z }) => {
      const d = Math.hypot(x - player.x, z - player.z)
      if (d < 70) play('shatter', { volume: 0.55 * (1 - d / 70) })
    }),
    events.on('levelUp', () => play('levelUp', { volume: 0.55 })),
    events.on('rebirth', () => play('rebirth', { volume: 0.95, detune: 0 })),
    events.on('purchase', () => play('buy', { volume: 0.7 })),
    events.on('equip', () => play('equip', { volume: 0.65 })),
    events.on('transform', () => play('transform', { volume: 0.85, detune: 0 })),
    // Taunts: an evil laugh (higher for the women), a swish for the hair flip.
    events.on('taunt', ({ kind, gender } = {}) => {
      if (kind === 'laugh') play('laugh', { volume: 0.55, rate: gender === 'f' ? 1.45 : 0.92, detune: 0.03 })
      else if (kind === 'hairflip') play('whoosh', { volume: 0.4, rate: 1.4 })
      else play('equip', { volume: 0.45 })
    }),
    events.on('error', () => play('error', { volume: 0.5, detune: 0 })),
    events.on('ui', () => play('ui', { volume: 0.4 })),
    events.on('step', () => play('step', { volume: 0.35, detune: 0.12 })),
    events.on('jump', () => play('jump', { volume: 0.4 })),
    events.on('land', () => play('land', { volume: 0.45 })),
    events.on('zone', ({ zone }) => {
      ambienceLevel = zone === 'stage' ? 0.25 : 1
      applySettings()
    }),
  ]

  return () => {
    for (const g of gestures) window.removeEventListener(g, onGesture, true)
    clearTimeout(synthTimer)
    unsubscribeStore()
    document.removeEventListener('visibilitychange', onVisibility)
    offs.forEach((off) => off())
  }
}

/** Snapshot for development tooling: is audio unlocked and synthesized yet? */
export const audioStatus = () => ({
  state: ctx?.state || 'locked',
  effects: effects ? Object.keys(effects).length : 0,
  loops: Boolean(musicSource),
})
