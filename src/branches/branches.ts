// Branches: user-made forks of a scenario, in the same shape as a fork file
// (`extends` + steps) so they can be exported straight into scenarios/.
// Pure: no React, stores or DOM.
import type { CardDb } from '../data/cardDb'
import { getCard, locate, tableRules, ZONES, type Action, type BoardState, type Issue, type Player, type Step, type ZoneRef } from '../engine'
import type { ResolvedScenario } from '../scenarios/resolve'
import { ScenarioSchema, type ScenarioFile } from '../scenarios/schema'
import { formatZodError } from '../scenarios/resolve'

export type BranchFile = ScenarioFile & { extends: NonNullable<ScenarioFile['extends']> }

// A new branch at `position` (0 = setup, n = after step n). Branching from a
// branch is flattened onto the same root scenario, so every branch exports as
// a single self-contained fork file.
export function branchFrom(scenario: ResolvedScenario, position: number, takenIds: Iterable<string>): BranchFile {
  const taken = new Set(takenIds)
  const root = scenario.extends ? scenario.extends.scenario : scenario.id
  const rootTitle = scenario.title.replace(/ \(branch.*\)$/, '')
  let n = 1
  while (taken.has(`${root}--branch-${n}`)) n++
  const own = scenario.game.steps.slice(scenario.inheritedSteps, Math.max(position, scenario.inheritedSteps))
  const atStep = scenario.extends && position > scenario.inheritedSteps ? scenario.extends.atStep : position - 1
  return {
    id: `${root}--branch-${n}`,
    title: `${rootTitle} (branch ${n} from step ${position})`,
    extends: { scenario: root, atStep },
    steps: scenario.extends && position > scenario.inheritedSteps ? own : [],
  }
}

export type TryResult = { ok: true; step: Step; warnings: string[] } | { ok: false; error: string }

// Validate a free-play action against the current state and wrap it as a step.
export function tryAction(state: BoardState, action: Action, db: CardDb): TryResult {
  const issues: Issue[] = tableRules.validate(state, action)
  const error = issues.find((i) => i.severity === 'error')
  if (error) return { ok: false, error: error.message }
  return { ok: true, step: { label: describeAction(state, action, db), actions: [action] }, warnings: issues.map((i) => i.message) }
}

const PHASE_NAMES = { draw: 'Draw Phase', standby: 'Standby Phase', main1: 'Main Phase 1', battle: 'Battle Phase', main2: 'Main Phase 2', end: 'End Phase' }

export function describeAction(state: BoardState, action: Action, db: CardDb): string {
  const name = (iid: string) => {
    const card = getCard(state, iid)
    return card.custom?.name ?? (card.cardId !== undefined ? db.byId(card.cardId)?.name : undefined) ?? iid
  }
  const who = (p: Player) => state.players[p].name
  // "You" is the default p1 name, so keep the grammar right for it.
  const whose = (p: Player) => (who(p) === 'You' ? 'your' : `${who(p)}'s`)
  const verb = (p: Player, v: string) => `${who(p)} ${who(p) === 'You' ? v : `${v}s`}`
  const zone = (ref: ZoneRef) => (ref.player ? `${whose(ref.player)} ${ZONES[ref.zone].label}` : ZONES[ref.zone].label)
  switch (action.type) {
    case 'move': {
      if (action.summon) return `${action.summon[0].toUpperCase()}${action.summon.slice(1)} Summon ${name(action.card)}`
      if (action.faceUp === false) return `Set ${name(action.card)}`
      return `${name(action.card)} to ${zone(action.to)}`
    }
    case 'draw':
      return `${verb(action.player, 'draw')}${action.count && action.count > 1 ? ` ${action.count}` : ''}`
    case 'shuffle':
      return `${verb(action.player, 'shuffle')} ${zone({ player: action.player, zone: action.zone })}`
    case 'lp':
      return action.set !== undefined ? `Set ${whose(action.player)} LP to ${action.set}` : `${verb(action.player, action.delta! < 0 ? 'lose' : 'gain')} ${Math.abs(action.delta!)} LP`
    case 'phase':
      return PHASE_NAMES[action.phase]
    case 'nextTurn':
      return `Turn ${state.turn + 1}`
    case 'flip':
      return `Flip ${name(action.card)} ${getCard(state, action.card).faceUp ? 'face-down' : 'face-up'}`
    case 'position':
      return `${name(action.card)} to ${action.position === 'atk' ? 'Attack' : 'Defense'} Position`
    case 'attach':
      return `Attach ${name(action.card)} to ${name(action.to)}`
    case 'detach':
      return `Detach ${name(action.card)}`
    default:
      return action.type
  }
}

// Import: must be a valid fork file. Checks shape only; the caller resolves it.
export function parseBranch(raw: unknown): { ok: true; branch: BranchFile } | { ok: false; errors: string[] } {
  const r = ScenarioSchema.safeParse(raw)
  if (!r.success) return { ok: false, errors: formatZodError('branch', r.error) }
  if (!r.data.extends) return { ok: false, errors: ['branch: only fork files (with "extends") can be imported as branches'] }
  return { ok: true, branch: r.data as BranchFile }
}

// Pick a free id for an imported branch.
export function uniqueId(id: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(id)) return id
  let n = 2
  while (set.has(`${id}-${n}`)) n++
  return `${id}-${n}`
}

export const isMaterial = (state: BoardState, iid: string) => {
  const loc = locate(state, iid)
  return !!loc && 'materialOf' in loc
}
