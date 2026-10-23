import { useEffect, useState } from 'react'

import { levelProgress } from '../state/economy'
import { useGameStore } from '../state/gameStore'

/** Re-renders every `ms` with the current time - for countdowns. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Level progress towards the next rebirth, recomputed when Speed or rebirths change. */
export function useLevel() {
  const speed = useGameStore((s) => s.speed)
  const rebirths = useGameStore((s) => s.rebirths)
  return levelProgress(speed, rebirths)
}

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
