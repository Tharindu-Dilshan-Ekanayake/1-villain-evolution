import { useEffect, useRef } from 'react'

import { useGameStore } from '../state/gameStore'
import AuthHUD from './AuthHUD'
import BottomBar from './BottomBar'
import FloatingFx from './FloatingFx'
import HatchOverlay from './HatchOverlay'
import { useNow } from './hooks'
import { useHudLayout } from './layout'
import LeftMenu, { StatsCard } from './LeftMenu'
import Panels from './Panels'
import Prompt from './Prompt'
import RightPromos, { Feed } from './RightPromos'
import TopBar from './TopBar'
import { ActionButtons, Joystick } from './TouchControls'
import Tutorial, { TutorialCard } from './Tutorial'
import { startWinsFlight } from './winsFlight'
import './hud.css'
import './villain.css'

/** Layer over the whole HUD where claimed trophies fly into the Wins counter. */
function TrophyLayer() {
  const ref = useRef(null)
  useEffect(() => (ref.current ? startWinsFlight(ref.current) : undefined), [])
  return <div ref={ref} className="trophy-layer" aria-hidden />
}

function Toast() {
  const toast = useGameStore((s) => s.toast)
  // Ticks only while a toast could be showing.
  const now = useNow(toast ? 250 : 60000)
  if (!toast || now - toast.at > 2400) return null
  return (
    <div key={toast.at} className={`toast ${toast.tone} ol`}>
      {toast.text}
    </div>
  )
}

/**
 * Everything drawn over the 3D view, laid out as a grid (see hud.css) so no two
 * pieces can ever overlap, on any screen:
 *
 *   landscape                         portrait
 *   [logo]   [top bar]   [name tag]   [logo]            [name tag]
 *   [left]   [centre]    [right]      [top bar - full width     ]
 *   [stick]  [level bar] [actions]    [tutorial - full width    ]
 *                                     [left]            [right  ]
 *                                     [prompt - full width      ]
 *                                     [level bar - full width   ]
 *                                     [stick]           [actions]
 *
 * The top-left "logo" cell is always left empty for the game site's own logo; the
 * player's name tag sits top right. Modals, toasts and callouts are overlays above
 * the grid.
 */
export function HUD() {
  const ready = useGameStore((s) => s.sceneReady)
  const { touch } = useHudLayout()

  // The moment the game is actually playable: the HUD is on screen.
  useEffect(() => {
    if (!ready) return undefined
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => performance.mark('villain:hud-painted'))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [ready])
  return (
    <>
      <FloatingFx />
      {ready && (
        <>
          <div className="hud">
            <div className="hud-logo" aria-hidden />
            <div className="hud-top">
              <TopBar />
            </div>
            <div className="hud-auth">
              <AuthHUD />
            </div>
            <div className="hud-left">
              <StatsCard />
              <LeftMenu />
            </div>
            <div className="hud-tut">
              <TutorialCard />
            </div>
            <div className="hud-prompt">
              <Prompt />
            </div>
            <div className="hud-right">
              <RightPromos />
              <Feed />
            </div>
            <div className="hud-ctl-l">{touch && <Joystick />}</div>
            <div className="hud-bottom">
              <BottomBar />
            </div>
            <div className="hud-ctl-r">{touch && <ActionButtons />}</div>
          </div>
          <TrophyLayer />
          <div className="hud-overlays">
            <Toast />
            <HatchOverlay />
            <Tutorial />
            <Panels />
          </div>
        </>
      )}
    </>
  )
}

export default HUD
