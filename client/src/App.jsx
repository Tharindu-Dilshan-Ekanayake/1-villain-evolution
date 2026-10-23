import { useEffect, useRef } from 'react'

import { audioStatus, initAudio } from './audio/sound'
import { useBloxity } from './bloxity/BloxityContext'
import GameScene from './game/GameScene'
import { route as guideRoute } from './game/guidePath'
import { useQuality } from './game/quality'
import { getLabelContainer } from './game/labels'
import { startLeaderboard } from './net/leaderboard'
import { startMultiplayer } from './net/multiplayer'
import { useNetStore } from './net/netStore'
import { respawn, startGameLoop } from './state/gameplay'
import { startAutosave, useGameStore } from './state/gameStore'
import { context, events, player, playerFx, stageRun, trainer } from './state/runtime'
import HUD from './ui/HUD'
import LoadingScreen from './ui/LoadingScreen'

/** After the game is playable, wait this long before connecting to the lobby. */
const NET_START_DELAY_MS = 1200

/** Loads the save that belongs to whoever is playing: the Bloxity user, or the guest. */
function useSaveSlot() {
  const { user, isReady, status } = useBloxity()
  const userId = user?._id || user?.id || user?.legionId
  useEffect(() => {
    // Don't pick the guest slot while the SDK might still report a signed-in user.
    if (!isReady && status !== 'error') return
    useGameStore.getState().loadSave(userId ? `user:${userId}` : 'guest')
  }, [userId, isReady, status])
}

/** Development-only handle for automated play-testing from the browser console. */
if (import.meta.env.DEV) {
  window.__villain = {
    store: useGameStore,
    net: useNetStore,
    quality: useQuality,
    events,
    player,
    playerFx,
    stageRun,
    context,
    trainer,
    respawn,
    audioStatus,
    guideRoute,
  }
}

function App() {
  const labelsRef = useRef(null)
  useSaveSlot()

  useEffect(() => {
    const stopAudio = initAudio()
    const stopLoop = startGameLoop()
    const stopSave = startAutosave()
    return () => {
      stopAudio()
      stopLoop()
      stopSave()
    }
  }, [])

  // Multiplayer joins once the game is playable and the HUD is on screen, so loading
  // and parsing the network code never competes with the first playable frames.
  const sceneReady = useGameStore((s) => s.sceneReady)
  useEffect(() => {
    if (!sceneReady) return undefined
    let stopMultiplayer = null
    let stopLeaderboard = null
    const id = setTimeout(() => {
      stopMultiplayer = startMultiplayer()
      stopLeaderboard = startLeaderboard()
    }, NET_START_DELAY_MS)
    return () => {
      clearTimeout(id)
      stopMultiplayer?.()
      stopLeaderboard?.()
    }
  }, [sceneReady])

  // World labels live in a DOM layer between the canvas and the HUD.
  useEffect(() => {
    const host = labelsRef.current
    const layer = getLabelContainer()
    host?.appendChild(layer)
    return () => layer.remove()
  }, [])

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ fontFamily: 'Fredoka, sans-serif' }}>
      <GameScene />
      <div ref={labelsRef} />
      <HUD />
      <LoadingScreen />
    </div>
  )
}

export default App
