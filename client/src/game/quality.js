import { create } from 'zustand'

/**
 * Quality presets. Every visual feature reads the active preset before it renders;
 * nothing decides its own cost. LOW is the mobile target: dpr 1, no shadows, no
 * particles, no post-processing (the game uses none at any level), short view distance.
 */
export const PRESETS = {
  LOW: {
    name: 'LOW',
    dpr: 1,
    shadows: false,
    shadowMapSize: 0,
    particles: false,
    debrisPerBreak: 10,
    viewDistance: 130,
    labelDistance: 30,
    clouds: 6,
    aura: false,
    flames: false,
    animatedWater: false,
    textureSize: 256,
  },
  MEDIUM: {
    name: 'MEDIUM',
    dpr: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    particles: true,
    debrisPerBreak: 22,
    viewDistance: 260,
    labelDistance: 42,
    clouds: 12,
    aura: true,
    flames: true,
    animatedWater: true,
    textureSize: 512,
  },
  HIGH: {
    name: 'HIGH',
    dpr: 2,
    shadows: true,
    // Capped at the 1024px desktop texture budget; the shadow box is only 44 m wide.
    shadowMapSize: 1024,
    particles: true,
    debrisPerBreak: 36,
    viewDistance: 420,
    labelDistance: 52,
    clouds: 18,
    aura: true,
    flames: true,
    animatedWater: true,
    textureSize: 1024,
  },
}

const ORDER = ['LOW', 'MEDIUM', 'HIGH']
const STORAGE_KEY = 'villain-evo-quality'

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const coarse =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || Boolean(coarse)
}

/** Mobile or <= 4 cores is LOW, per the performance contract. */
export function detectPreset() {
  const cores = navigator.hardwareConcurrency || 4
  const memory = navigator.deviceMemory || 8
  if (isMobileDevice() || cores <= 4) return 'LOW'
  if (cores <= 8 || memory <= 4) return 'MEDIUM'
  return 'HIGH'
}

function readMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'AUTO' || ORDER.includes(saved)) return saved
  } catch {
    // Storage blocked (private mode): fall through to the default.
  }
  // New players start on LOW (lightest, smoothest); Settings can raise it.
  return 'LOW'
}

const initialMode = readMode()

export const useQuality = create((set, get) => ({
  /** What the player picked in Settings. AUTO lets the monitor move the preset. */
  mode: initialMode,
  /** The preset actually in force. */
  level: initialMode === 'AUTO' ? detectPreset() : initialMode,

  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // Not fatal; the choice just won't survive a reload.
    }
    set({ mode, level: mode === 'AUTO' ? detectPreset() : mode })
  },

  /** Called (outside the frame loop) when the FPS monitor reports a sustained drop. */
  lower: () => {
    const { level, mode } = get()
    if (mode !== 'AUTO') return
    const index = ORDER.indexOf(level)
    if (index > 0) set({ level: ORDER[index - 1] })
  },
}))

/** Hook: the active preset object. */
export const usePreset = () => PRESETS[useQuality((s) => s.level)]

/** Non-reactive read for frame loops and ticks. */
export const getPreset = () => PRESETS[useQuality.getState().level]
