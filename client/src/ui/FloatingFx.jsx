import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { VILLAIN_BY_ID } from '../state/content'
import { formatNumber } from '../state/economy'
import { cameraHandle, events, player } from '../state/runtime'
import { icon } from './icons'

const ORB_POOL = 24
const _v = new Vector3()

/** The running shoe on every "+Speed" pop, as in the reference. */
const SHOE = `<span class="orb-icon">${icon('shoe')}</span>`

/** Screen position of a point near the player's head, or null if the camera isn't up. */
function playerScreen() {
  const cam = cameraHandle.camera
  if (!cam) return null
  _v.set(player.x, player.y + 1, player.z).project(cam)
  if (_v.z > 1) return null
  return [((_v.x + 1) / 2) * cameraHandle.width, ((1 - _v.y) / 2) * cameraHandle.height]
}

/**
 * DOM effects driven by gameplay events: pooled "👟 +N" Speed pops around the
 * villain, the big "+N Wins!" pop, level-up, wall-smash and rebirth callouts. Every
 * node is reused; the motion is pure CSS animation, so none of this touches the
 * frame loop.
 */
export function FloatingFx() {
  const layerRef = useRef(null)

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return undefined

    const orbs = Array.from({ length: ORB_POOL }, () => {
      const el = document.createElement('div')
      el.className = 'orb ol'
      layer.appendChild(el)
      return el
    })
    let nextOrb = 0
    const winPop = document.createElement('div')
    winPop.className = 'win-pop ol'
    const callout = document.createElement('div')
    callout.className = 'big-callout ol'
    const flash = document.createElement('div')
    flash.className = 'flash'
    layer.append(winPop, callout, flash)

    const restart = (el, cls = 'play') => {
      el.classList.remove(cls)
      // Force a reflow so the animation restarts on a reused node.
      void el.offsetWidth
      el.classList.add(cls)
    }

    let lastOrbAt = 0
    const offs = [
      events.on('gain', ({ gain } = {}) => {
        if (!gain) return
        const now = performance.now()
        if (now - lastOrbAt < 60) return
        lastOrbAt = now
        const pos = playerScreen()
        if (!pos) return
        const el = orbs[nextOrb]
        nextOrb = (nextOrb + 1) % ORB_POOL
        el.innerHTML = `${SHOE}<span>+${formatNumber(gain)}</span>`
        el.style.setProperty('--x', `${pos[0] + (Math.random() - 0.5) * 220}px`)
        el.style.setProperty('--y', `${pos[1] + (Math.random() - 0.5) * 140}px`)
        el.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`)
        restart(el)
      }),
      events.on('padClaim', ({ wins }) => {
        winPop.textContent = `+${formatNumber(wins)} Wins!`
        restart(winPop)
      }),
      events.on('levelUp', ({ level }) => {
        callout.textContent = `Level ${level}!`
        callout.style.color = '#7fe3ff'
        restart(callout)
      }),
      events.on('transform', ({ id }) => {
        const v = VILLAIN_BY_ID[id]
        if (!v) return
        callout.textContent = v.id === 'bloxity' ? 'Back to you!' : `${v.name}!`
        callout.style.color = v.aura?.color || v.fx?.color || '#ffffff'
        restart(callout)
      }),
      events.on('rebirth', ({ rebirths }) => {
        callout.textContent = `REBIRTH ${rebirths}!`
        callout.style.color = '#ffd23f'
        restart(callout)
        restart(flash)
      }),
      events.on('wallBreak', ({ index }) => {
        callout.textContent = `Stage ${index + 1} wall smashed!`
        callout.style.color = '#ffffff'
        restart(callout)
      }),
    ]

    return () => {
      offs.forEach((off) => off())
      layer.innerHTML = ''
    }
  }, [])

  return <div ref={layerRef} className="fx-layer" />
}

export default FloatingFx
