import { useEffect, useState } from 'react'

import { isTouchDevice } from './hooks'

/**
 * Works out how the HUD should be laid out for this screen, and publishes it:
 *  - classes on <html>: `hud-compact` (phones, small windows, any touch screen),
 *    `hud-portrait`, `touch-ui`;
 *  - CSS variables: `--s` (HUD scale, ~1 on a big monitor down to ~0.5 on a phone)
 *    and `--ps` (panel / prompt scale, never below readable).
 *
 * The HUD itself is a CSS grid (ui/hud.css), so whatever the size its regions can't
 * overlap; this only decides how big things are and which grid arrangement applies.
 */
function measure(touch) {
  const w = window.innerWidth
  const h = window.innerHeight
  const portrait = h > w * 1.05
  const raw = portrait ? Math.min(w / 760, h / 1350) : Math.min(w / 1500, h / 860)
  const s = Math.max(0.46, Math.min(1, raw))
  const compact = touch || w < 1000 || h < 620
  return { w, h, portrait, compact, touch, s, ps: Math.max(s, 0.66) }
}

function apply(layout) {
  const root = document.documentElement
  root.classList.toggle('hud-compact', layout.compact)
  root.classList.toggle('hud-portrait', layout.portrait)
  root.classList.toggle('touch-ui', layout.touch)
  root.style.setProperty('--s', layout.s.toFixed(3))
  root.style.setProperty('--ps', layout.ps.toFixed(3))
}

export function useHudLayout() {
  const [touch, setTouch] = useState(() => isTouchDevice())
  const [layout, setLayout] = useState(() => measure(touch))

  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setLayout(measure(touch)))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [touch])

  // A touch on a laptop with a touchscreen switches the touch layout on.
  useEffect(() => {
    if (touch) return undefined
    const onTouch = () => setTouch(true)
    window.addEventListener('touchstart', onTouch, { once: true })
    return () => window.removeEventListener('touchstart', onTouch)
  }, [touch])

  useEffect(() => {
    apply(layout)
  }, [layout])

  useEffect(
    () => () => {
      const root = document.documentElement
      root.classList.remove('hud-compact', 'hud-portrait', 'touch-ui')
    },
    [],
  )

  return layout
}
