import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { useBloxity } from '../bloxity/BloxityContext'
import { useGameStore } from '../state/gameStore'
import FollowCamera from './FollowCamera'
import Guide from './fx/Guide'
import Particles from './fx/Particles'
import Pets from './pets/Pets'
import SpeedLines from './fx/SpeedLines'
import WindStreaks from './fx/WindStreaks'
import Trail from './fx/Trail'
import LabelLayer from './LabelLayer'
import Lighting from './Lighting'
import Player from './Player'
import RemotePlayers from './RemotePlayers'
import { usePreset, useQuality } from './quality'
import { FOG, SKY } from './sceneStyle'
import Sky from './Sky'
import { StageWorld } from './stageLoader'
import Lobby from './world/Lobby'

const QUERY = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const PERF_REQUESTED = Boolean(QUERY?.has('perf'))

/**
 * r3f-perf overlay: development only, with ?r3fperf in the URL. Kept apart from the
 * ?perf probe: r3f-perf resets the renderer's counters itself, so the probe would
 * read zeros next to it.
 */
const Perf =
  import.meta.env.DEV && QUERY?.has('r3fperf') ? lazy(() => import('r3f-perf').then((m) => ({ default: m.Perf }))) : null

/**
 * Publishes last-frame renderer stats on window.__villainPerf (dev, or ?perf in any
 * build) so automated checks can read draw calls and triangles. A plain object write.
 */
function PerfProbe() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const stats = useRef({ frames: 0, elapsed: 0 })
  useEffect(() => {
    window.__villainPerf = { calls: 0, triangles: 0, points: 0, textures: 0, geometries: 0, programs: 0, fps: 0 }
    window.__villainScene = scene
    return () => {
      delete window.__villainScene
      delete window.__villainPerf
    }
  }, [scene])
  useFrame((_state, delta) => {
    const out = window.__villainPerf
    if (!out) return
    // gl.info resets at the start of each render, so this is the previous frame.
    out.calls = gl.info.render.calls
    out.triangles = gl.info.render.triangles
    out.points = gl.info.render.points
    out.textures = gl.info.memory.textures
    out.geometries = gl.info.memory.geometries
    out.programs = gl.info.programs?.length || 0
    const s = stats.current
    s.frames += 1
    s.elapsed += delta
    if (s.elapsed >= 1) {
      out.fps = Math.round(s.frames / s.elapsed)
      s.frames = 0
      s.elapsed = 0
    }
  })
  return null
}

/**
 * Fires once after the renderer has actually drawn a frame. The callback is deferred
 * out of the frame loop because it updates the store.
 */
function FirstFrameSignal({ onFirstFrame }) {
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    performance.mark('villain:first-frame')
    setTimeout(onFirstFrame, 0)
  })
  return null
}

/**
 * True a moment after the game is playable, once the browser is idle: the effects
 * that compile their own shaders mount then, not in the frame the HUD first paints.
 */
function useAfterReady(delayMs) {
  const ready = useGameStore((s) => s.sceneReady)
  const [after, setAfter] = useState(false)
  useEffect(() => {
    if (!ready || after) return undefined
    let idle = null
    const timer = setTimeout(() => {
      const go = () => setAfter(true)
      idle = window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 600 }) : setTimeout(go, 0)
    }, delayMs)
    return () => {
      clearTimeout(timer)
      if (idle !== null) (window.cancelIdleCallback || clearTimeout)(idle)
    }
  }, [ready, after, delayMs])
  return after
}

function World() {
  const preset = usePreset()
  const stageActive = useGameStore((s) => s.stageActive)
  const ready = useAfterReady(400)

  return (
    <>
      <fog attach="fog" args={[FOG.color, Math.min(FOG.near, preset.viewDistance * 0.4), preset.viewDistance]} />
      <Sky />
      <Lighting />
      <Lobby />
      {stageActive && (
        <Suspense fallback={null}>
          <StageWorld />
        </Suspense>
      )}
      {preset.particles && <Particles />}
      {/* After the HUD has painted: their shaders stay out of the time to playable. */}
      {ready && <Trail />}
      {ready && <SpeedLines />}
      {ready && preset.particles && <WindStreaks />}
      {ready && <Pets />}
      <Guide />
    </>
  )
}

/**
 * The 3D scene. The Canvas is keyed so a lost WebGL context can be recovered by
 * rebuilding it from scratch; game progress lives outside it and survives.
 */
export function GameScene() {
  const { game } = useBloxity()
  const preset = usePreset()
  const lower = useQuality((s) => s.lower)
  const [avatarReady, setAvatarReady] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const [contextLost, setContextLost] = useState(false)
  const loadingEnded = useRef(false)
  const [initialPreset] = useState(preset.name)

  const handleAvatarReady = useCallback(() => {
    performance.mark('villain:avatar-ready')
    setAvatarReady(true)
  }, [])

  const finishLoading = useCallback(() => {
    if (loadingEnded.current || !avatarReady) return
    loadingEnded.current = true
    performance.mark('villain:scene-ready')
    game.loadingEnd()
    useGameStore.setState({ sceneReady: true })
  }, [avatarReady, game])

  // The avatar usually finishes after the first frame, so close the loading screen
  // from here too.
  useEffect(() => {
    finishLoading()
  }, [finishLoading])

  useEffect(() => {
    game.loadingStep('Preparing the lobby…')
  }, [game])

  /**
   * WebGL context loss. three.js rebuilds its GPU state in place when the browser
   * restores the context, so a restore only hides the overlay. If the browser never
   * restores it, the Canvas is remounted to get a fresh context. A remounted canvas's
   * old element is "retired": its late events (disposing it fires one more `lost`)
   * are ignored.
   */
  const handleCreated = useCallback(({ gl }) => {
    gl.setClearColor(SKY.horizon)
    // Shader error checks query each program synchronously, stalling the first frames
    // on compile. Keep them for development only.
    gl.debug.checkShaderErrors = import.meta.env.DEV
    const canvas = gl.domElement
    let retired = false
    let fallback = null
    const retire = () => {
      retired = true
      clearTimeout(fallback)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
    function onLost(event) {
      if (retired) return
      // Tells the browser we intend to restore; otherwise the context is gone for good.
      event.preventDefault()
      setContextLost(true)
      clearTimeout(fallback)
      fallback = setTimeout(() => {
        retire()
        setContextLost(false)
        setCanvasKey((k) => k + 1)
      }, 4000)
    }
    function onRestored() {
      if (retired) return
      clearTimeout(fallback)
      setContextLost(false)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    if (import.meta.env.DEV || PERF_REQUESTED) window.__villainGL = gl
  }, [])

  return (
    <>
      <Canvas
        key={canvasKey}
        shadows={preset.shadows ? 'percentage' : false}
        // No tone mapping: the template's palette is chosen to look right without it.
        flat
        dpr={preset.dpr === 1 ? 1 : [1, preset.dpr]}
        gl={{
          antialias: initialPreset !== 'LOW',
          powerPreference: 'high-performance',
          stencil: false,
        }}
        camera={{ position: [0, 6, 20], fov: 60, near: 0.25, far: 1000 }}
        onCreated={handleCreated}
      >
        {/* Sustained FPS below 45 steps the preset down (outside the frame loop). */}
        <PerformanceMonitor
          bounds={() => [45, 1000]}
          flipflops={2}
          onDecline={() => setTimeout(lower, 0)}
        />
        {/* Separate boundaries: the lobby builds (and compiles its shaders) while the
            avatar rig is still downloading, instead of waiting for it. */}
        <Suspense fallback={null}>
          <World />
        </Suspense>
        <Suspense fallback={null}>
          <Player onAvatarReady={handleAvatarReady} />
        </Suspense>
        <Suspense fallback={null}>
          <RemotePlayers />
        </Suspense>
        <FollowCamera />
        <LabelLayer />
        <FirstFrameSignal onFirstFrame={finishLoading} />
        {(import.meta.env.DEV || PERF_REQUESTED) && <PerfProbe />}
        {Perf && (
          <Suspense fallback={null}>
            {/* Bottom right: the top-left corner is kept empty for the site's logo. */}
            <Perf position="bottom-right" minimal />
          </Suspense>
        )}
      </Canvas>
      {contextLost && (
        <div className="context-lost">
          <div className="context-lost-card">Graphics are restarting…</div>
        </div>
      )}
    </>
  )
}

export default GameScene
