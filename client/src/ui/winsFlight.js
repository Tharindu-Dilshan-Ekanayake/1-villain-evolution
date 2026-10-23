import { create } from 'zustand'
import { Vector3 } from 'three'

import { play } from '../audio/sound'
import { cameraHandle, events, player } from '../state/runtime'
import { icon } from './icons'

/**
 * Trophy flight: claimed Wins don't just appear in the counter. Back in the lobby a
 * stream of trophies flies off the villain and lands in the Wins badge, and the counter
 * climbs with each one.
 *
 * The Wins are saved the moment they're claimed; only the number on screen waits.
 * `held` is the part of the total still "in flight" - the card shows wins - held.
 */
export const useWinsHeld = create(() => ({ held: 0 }))

const POOL = 14
/** Wait after the respawn so the camera has settled on the villain. */
const LAUNCH_DELAY_MS = 750
const STAGGER_MS = 75
const FLIGHT_MS = 950
/** Whatever happens (hidden tab, missing badge), the counter catches up by then. */
const SAFETY_MS = 6000

const _v = new Vector3()
let layer = null
const nodes = []
let next = 0
let safety = null

function release(amount) {
  useWinsHeld.setState((s) => ({ held: Math.max(0, s.held - amount) }))
}

function releaseAll() {
  clearTimeout(safety)
  safety = null
  useWinsHeld.setState({ held: 0 })
}

function playerScreen() {
  const cam = cameraHandle.camera
  if (!cam) return null
  _v.set(player.x, player.y + 0.6, player.z).project(cam)
  if (_v.z > 1) return null
  return [((_v.x + 1) / 2) * cameraHandle.width, ((1 - _v.y) / 2) * cameraHandle.height]
}

/** Centre of the Wins badge on screen, or null if it isn't shown. */
function badgeCentre() {
  const r = document.querySelector('.stat-wins .stat-badge')?.getBoundingClientRect()
  if (!r || r.width < 1) return null
  return [r.left + r.width / 2, r.top + r.height / 2]
}

/** Points along a curved path from `a` to `b`, bowed sideways and up. */
function arc(a, b, bow, lift, steps = 10) {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  // Control point: off to one side of the straight line, and pulled upwards.
  const cx = mx + (-dy / len) * bow
  const cy = my + (dx / len) * bow - lift
  const pts = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]])
  }
  return pts
}

/** Brief glow on the badge as a trophy lands. */
function hitBadge() {
  const badge = document.querySelector('.stat-wins .stat-badge')
  if (!badge) return
  badge.classList.remove('hit')
  void badge.offsetWidth
  badge.classList.add('hit')
}

function launch(wins) {
  const start = playerScreen()
  const end = badgeCentre()
  if (!layer || !start || !end) {
    releaseAll()
    return
  }
  // More Wins, more trophies (6 to 14); the Wins are shared out between them.
  const count = Math.min(POOL, 6 + Math.floor(Math.log10(wins + 1) * 2))
  const share = Math.floor(wins / count)
  let left = wins
  for (let i = 0; i < count; i += 1) {
    const el = nodes[next]
    next = (next + 1) % POOL
    const amount = i === count - 1 ? left : share
    left -= amount
    const from = [start[0] + (Math.random() - 0.5) * 70, start[1] + (Math.random() - 0.5) * 50]
    const pts = arc(from, end, (Math.random() - 0.5) * 260, 120 + Math.random() * 140)
    const spin = (Math.random() - 0.5) * 540
    const keyframes = pts.map(([x, y], k) => {
      const t = k / (pts.length - 1)
      // Pops out big, then shrinks into the badge.
      const scale = t < 0.15 ? 0.3 + (t / 0.15) * 1.2 : 1.5 - (t - 0.15) * 1.25
      return { transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${spin * t}deg) scale(${scale})`, opacity: t > 0.96 ? 0 : 1 }
    })
    const anim = el.animate(keyframes, {
      duration: FLIGHT_MS + Math.random() * 200,
      delay: i * STAGGER_MS,
      easing: 'cubic-bezier(0.45, 0, 0.9, 0.55)',
      fill: 'both',
    })
    const last = i === count - 1
    anim.onfinish = () => {
      el.style.opacity = '0'
      release(amount)
      hitBadge()
      play('trophy', { volume: 0.55, rate: 1 + (i / count) * 0.6, detune: 0 })
      if (last) releaseAll()
    }
  }
}

/**
 * Mounts the flight layer and listens for claims. Call once (from the HUD); returns
 * a stop function.
 */
export function startWinsFlight(container) {
  layer = container
  for (let i = 0; i < POOL; i += 1) {
    const el = document.createElement('div')
    el.className = 'trophy-fly'
    el.innerHTML = icon('trophy')
    el.style.opacity = '0'
    layer.appendChild(el)
    nodes.push(el)
  }
  const offs = [
    // Claimed: hold the new Wins back until the trophies bring them in.
    events.on('padClaim', ({ wins }) => {
      useWinsHeld.setState((s) => ({ held: s.held + wins }))
      clearTimeout(safety)
      safety = setTimeout(releaseAll, SAFETY_MS)
    }),
    // Home in the lobby: send them flying.
    events.on('winsHome', ({ wins }) => {
      setTimeout(() => launch(wins), LAUNCH_DELAY_MS)
    }),
  ]
  return () => {
    offs.forEach((off) => off())
    nodes.forEach((n) => n.remove())
    nodes.length = 0
    layer = null
    releaseAll()
  }
}
