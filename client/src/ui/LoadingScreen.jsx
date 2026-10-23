import { useProgress } from '@react-three/drei'
import { useEffect, useState } from 'react'

import { useGameStore } from '../state/gameStore'
import Icon from './Icon'

const HINTS = [
  'Every step makes you faster - treadmills multiply it!',
  'More Speed = stronger wall smashes.',
  'Each stage has a WINS pad in its left corner.',
  'Rebirth to multiply your Speed and unlock faster treadmills.',
  'Pets from eggs boost your Speed multiplier.',
  'Use code VISITS500K for free rewards!',
]

/**
 * Loading screen. Progress comes from drei's useProgress (every three.js loader:
 * the avatar rig, skins, parts); it stays up until the avatar is assembled and the
 * first frame is on screen.
 */
export function LoadingScreen() {
  const { progress, active } = useProgress()
  const ready = useGameStore((s) => s.sceneReady)
  const [hint] = useState(() => HINTS[Math.floor(Math.random() * HINTS.length)])
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!ready) return undefined
    const id = setTimeout(() => setGone(true), 600)
    return () => clearTimeout(id)
  }, [ready])

  if (gone) return null
  const shown = ready ? 100 : Math.max(8, active ? progress * 0.9 : 90)

  return (
    <div className={`loading ${ready ? 'done' : ''}`}>
      <div>
        <div className="logo ol">
          <small>
            <Icon name="villain" /> +1
          </small>
          Villain Evolution
        </div>
        <div className="bar">
          <div style={{ width: `${shown}%` }} />
        </div>
        <div className="hint">{hint}</div>
      </div>
    </div>
  )
}

export default LoadingScreen
