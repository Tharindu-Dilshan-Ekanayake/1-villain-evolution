import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useRef, useState } from 'react'

import { createLabel } from '../labels'

import { useGameStore } from '../../state/gameStore'
import { player } from '../../state/runtime'
import { AREA_SIGNS, GATE_Z } from '../layout'
import { getPreset } from '../quality'
import Boards from './Boards'
import Eggs from './Eggs'
import FlowArrows from './FlowArrows'
import Gate from './Gate'
import Ground from './Ground'
import Pedestals from './Pedestals'
import Treadmills from './Treadmills'

/** Looking back from the stages, the lobby props hide once beyond this share of the view distance. */
const DETAIL_SHARE = 0.55

/** Lobby parts after the ground, mounted one per step once the game is playable. */
const STAGED = [Gate, Treadmills, Pedestals, Eggs, Boards]
/** Let the HUD's first frame paint before any of it is built. */
const FIRST_DELAY_MS = 250
const STEP_MS = 120

/** Runs `fn` when the main thread is idle (or after `timeout` ms at the latest). */
function whenIdle(fn, timeout = 400) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 0)
  return () => clearTimeout(id)
}

/**
 * The always-loaded lobby. The stage line is a separate lazy chunk.
 *
 * Only the ground is needed to start playing, so everything else is built after the
 * player is in: once the HUD has painted, one piece per idle slot. That keeps the
 * procedural geometry (statues, eggs, boards) out of the time to playable.
 */
export function Lobby() {
  const groupRef = useRef(null)
  const detailRef = useRef(null)
  const ready = useGameStore((s) => s.sceneReady)
  const [mounted, setMounted] = useState(0)

  useEffect(() => {
    if (!ready) return undefined
    let count = 0
    let timer = null
    let cancelIdle = null
    const step = () => {
      cancelIdle = whenIdle(() => {
        count += 1
        setMounted(count)
        if (count < STAGED.length) timer = setTimeout(step, STEP_MS)
      })
    }
    timer = setTimeout(step, FIRST_DELAY_MS)
    return () => {
      clearTimeout(timer)
      cancelIdle?.()
    }
  }, [ready])

  // Big floating signs over each area (DOM labels: no draw calls).
  useEffect(() => {
    if (!ready) return undefined
    const signs = AREA_SIGNS.map((a) =>
      createLabel({
        position: [a.x, a.y, a.z],
        className: 'area-label',
        html: `<div class="area-title${a.small ? ' small' : ''}" style="color:${a.color}">${a.title}</div>`,
        lobby: true,
        far: true,
        maxDistance: 95,
        refDistance: 22,
        minScale: 0.5,
        maxScale: 1.1,
      }),
    )
    return () => signs.forEach((l) => l.remove())
  }, [ready])

  // Distance culling: a visibility flip, not a store update.
  useFrame(() => {
    const group = groupRef.current
    const detail = detailRef.current
    if (!group || !detail) return
    const range = getPreset().viewDistance
    const pastGate = GATE_Z - player.z
    const visible = pastGate < range
    const detailVisible = pastGate < range * DETAIL_SHARE
    if (group.visible !== visible) group.visible = visible
    if (detail.visible !== detailVisible) detail.visible = detailVisible
  })

  // The culled groups hold visuals only; colliders keep working.
  return (
    <>
      <Ground />
      <FlowArrows />
      <group ref={groupRef}>
        {mounted >= 1 && <Gate />}
        {mounted >= 5 && <Boards />}
        <group ref={detailRef}>
          {mounted >= 2 && <Treadmills />}
          {mounted >= 3 && (
            <Suspense fallback={null}>
              <Pedestals />
            </Suspense>
          )}
          {mounted >= 4 && <Eggs />}
        </group>
      </group>
    </>
  )
}

export default Lobby
