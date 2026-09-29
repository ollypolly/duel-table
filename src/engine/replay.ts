// Replay: a scripted game is a setup plus steps. The state at step n is the
// setup with steps 0..n applied, so scrubbing backwards is just recomputing.
import { applyAction } from './actions'
import { createInitialState, type GameSetup } from './setup'
import type { BoardState, EngineEvent, Step } from './types'
import { EngineError } from './zones'

export type ScriptedGame = { setup: GameSetup; steps: Step[] }

export type TimelineEntry = { state: BoardState; events: EngineEvent[] }

export class StepError extends EngineError {
  readonly step: number
  readonly action: number
  constructor(step: number, action: number, message: string) {
    super(`Step ${step + 1}, action ${action + 1}: ${message}`)
    this.step = step
    this.action = action
  }
}

// Per-step presentation (reveals, highlights, arrows) only lasts one step.
export function beginStep(state: BoardState): BoardState {
  return { ...state, revealed: [], highlights: [], arrows: [] }
}

export function applyStep(state: BoardState, step: Step, stepIndex = 0): TimelineEntry {
  let current = beginStep(state)
  const events: EngineEvent[] = []
  step.actions.forEach((action, i) => {
    try {
      const result = applyAction(current, action)
      current = result.state
      events.push(...result.events)
    } catch (e) {
      throw new StepError(stepIndex, i, e instanceof Error ? e.message : String(e))
    }
  })
  return { state: current, events }
}

// Index 0 is the setup state; index n + 1 is the state after step n.
export function timeline(game: ScriptedGame): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ state: createInitialState(game.setup), events: [] }]
  game.steps.forEach((step, i) => entries.push(applyStep(entries[i].state, step, i)))
  return entries
}

// State after step n (n = -1 is the setup state).
export function stateAt(game: ScriptedGame, n: number): BoardState {
  let state = createInitialState(game.setup)
  for (let i = 0; i <= Math.min(n, game.steps.length - 1); i++) state = applyStep(state, game.steps[i], i).state
  return state
}
