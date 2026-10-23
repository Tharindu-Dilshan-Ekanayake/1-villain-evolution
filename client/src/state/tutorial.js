import { GATE_Z, PAD_SPOTS, padX, padZ, PEDESTALS, wallZ } from '../game/layout'
import { FIRST_VILLAIN } from './content'
import { TUTORIAL_DONE } from './gameStore'
import { context, player, stageRun } from './runtime'

/**
 * The first-time tutorial: train on the free treadmill, smash Stage 1's wall, collect
 * its 3 Wins from the pad in the left corner, and spend them on the first villain.
 *
 * `done` is polled by the gameplay tick; `target` and `label` feed the 3D guide (the
 * glowing trail on the ground and the marker over the goal).
 */

export const SPEED_GOAL = 10
const firstPad = PAD_SPOTS[0]
const firstVillain = PEDESTALS.find((p) => p.id === FIRST_VILLAIN)

export const TUTORIAL_STEPS = {
  1: {
    text: 'Step on the Rookie Treadmill to train!',
    label: 'TRAIN HERE',
    done: () => player.training && context.pad === firstPad.id,
    target: () => [firstPad.x, firstPad.z],
  },
  2: {
    text: 'Keep running to gain Speed!',
    label: 'KEEP RUNNING',
    progress: (s) => `${Math.min(Math.floor(s.speed), SPEED_GOAL)} / ${SPEED_GOAL}`,
    done: (s) => s.speed >= SPEED_GOAL,
    target: () => [firstPad.x, firstPad.z],
  },
  3: {
    text: 'Run through the STAGES gate!',
    label: 'STAGES',
    done: () => context.zone === 'stage',
    target: () => [0, GATE_Z],
  },
  4: {
    text: 'Run into the Stage 1 wall - your Speed smashes it!',
    label: 'SMASH!',
    done: () => stageRun.broken[0] === 1,
    target: () => [0, wallZ(0) + 1.5],
  },
  5: {
    text: 'Step on the WINS pad in the left corner!',
    label: 'WINS',
    done: (s) => s.wins >= 3 || s.ownedVillains.length > 1,
    target: () => [padX(), padZ(0)],
  },
  6: {
    text: 'Become the Prank Jester for 3 Wins!',
    label: 'BUY',
    done: (s) => s.ownedVillains.includes(FIRST_VILLAIN),
    // The front of the pad: its statue stands on the back half.
    target: () => (firstVillain ? [firstVillain.x - 0.8, firstVillain.z] : null),
  },
}

export const TUTORIAL_STEP_COUNT = 6

/** Moves the tutorial forward when its current goal is met. */
export function advanceTutorial(state) {
  const step = state.tutorial
  if (step === 0 || step > TUTORIAL_STEP_COUNT || step === TUTORIAL_DONE) return step
  // Catch up anyone who is already further along than the tutorial thinks.
  if (state.ownedVillains.includes(FIRST_VILLAIN)) return TUTORIAL_STEP_COUNT + 1
  if (step >= 3 && step <= 5 && state.wins >= 3) return 6
  const current = TUTORIAL_STEPS[step]
  return current?.done(state) ? step + 1 : step
}
