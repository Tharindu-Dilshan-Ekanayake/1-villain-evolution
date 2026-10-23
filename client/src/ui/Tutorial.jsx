import { useEffect, useState } from 'react'

import { TUTORIAL_DONE, useGameStore } from '../state/gameStore'
import { events } from '../state/runtime'
import { TUTORIAL_STEP_COUNT, TUTORIAL_STEPS } from '../state/tutorial'
import Icon from './Icon'

const WELCOME_DELAY_MS = 600

function Modal({ title, children, button, onClick, bg = 'bg-purple' }) {
  return (
    <div className="panel-backdrop">
      <div className="panel" style={{ width: 'min(calc(620px * var(--ps)), 92vw)' }}>
        <div className={`panel-head ${bg}`}>
          <span className="title ol">{title}</span>
        </div>
        <div className="panel-body" style={{ alignItems: 'center', textAlign: 'center' }}>
          {children}
          <button
            type="button"
            className="gbtn price-btn bg-green ol"
            style={{ fontSize: 'calc(34px * var(--ps))' }}
            onClick={() => {
              events.emit('ui')
              onClick()
            }}
          >
            {button}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The tutorial's welcome and finish screens (the objective card is TutorialCard). */
export function Tutorial() {
  const step = useGameStore((s) => s.tutorial)
  const setTutorial = useGameStore((s) => s.setTutorial)
  const skipTutorial = useGameStore((s) => s.skipTutorial)
  const sceneReady = useGameStore((s) => s.sceneReady)
  // The welcome card pops in just after the HUD's first paint, not in the same frame.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!sceneReady) return undefined
    const id = setTimeout(() => setShown(true), WELCOME_DELAY_MS)
    return () => clearTimeout(id)
  }, [sceneReady])

  if (!sceneReady || !shown || step === TUTORIAL_DONE) return null

  if (step === 0) {
    return (
      <Modal
        title={
          <>
            <Icon name="villain" /> Become the Greatest Villain!
          </>
        }
        button="Let's go!"
        onClick={() => setTutorial(1)}
      >
        <div className="muted-note" style={{ fontSize: 'calc(24px * var(--ps))' }}>
          <Icon name="shoe" /> Run on treadmills to gain Speed.
          <br />
          <Icon name="boom" /> More Speed = stronger wall smashes.
          <br />
          <Icon name="trophy" /> Step on the WINS pad in each stage.
          <br />
          <Icon name="villain" /> Spend Wins to become stronger villains!
          <br />
          <Icon name="egg" /> Hatch pets · <Icon name="rebirth" /> Rebirth to get even faster!
        </div>
      </Modal>
    )
  }

  if (step === TUTORIAL_STEP_COUNT + 1) {
    return (
      <Modal
        title={
          <>
            You&apos;re a villain now! <Icon name="villain" />
          </>
        }
        button="Awesome!"
        bg="bg-yellow"
        onClick={skipTutorial}
      >
        <div className="muted-note" style={{ fontSize: 'calc(24px * var(--ps))' }}>
          Smash deeper stages for more Wins and stronger villains.
          <br />
          Faster treadmills unlock as you Rebirth, and eggs hatch pets that multiply your Speed!
        </div>
      </Modal>
    )
  }

  return null
}

/** The current tutorial objective, shown in the HUD while the tutorial runs. */
export function TutorialCard() {
  const step = useGameStore((s) => s.tutorial)
  // A primitive selector: the card re-renders only when its progress text changes.
  const progress = useGameStore((s) => TUTORIAL_STEPS[s.tutorial]?.progress?.(s) ?? null)
  const skipTutorial = useGameStore((s) => s.skipTutorial)
  const current = TUTORIAL_STEPS[step]
  if (step === TUTORIAL_DONE || !current) return null
  return (
    <div className="tutorial-card">
      <span className="step ol">
        {step}/{TUTORIAL_STEP_COUNT}
      </span>
      <span className="ol tut-text">{current.text}</span>
      {progress && <span className="prog">{progress}</span>}
      <button type="button" className="gbtn skip bg-grey ol live" onClick={skipTutorial}>
        Skip
      </button>
    </div>
  )
}

export default Tutorial
