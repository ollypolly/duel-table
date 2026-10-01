// Reading a game's steps for the plays in them: which card a step plays, and
// what a player has done so far this turn.
import type { Iid, Player, Step } from '../engine'

// The card a step plays (a summon, an activation, an attack, a Set), and
// whether its face shows. Phases, resolutions and effects' outcomes aren't plays.
export function played(step: Step): { card: Iid; shown: boolean } | undefined {
  const i = step.intent
  if (i && i.type !== 'declarePhase' && i.type !== 'endTurn') return { card: i.type === 'attack' ? i.attacker : i.card, shown: i.type !== 'set' }
  const set = /^Set a /.test(step.label ?? '') && step.actions.find((a) => a.type === 'move')
  return set ? { card: set.card, shown: false } : undefined
}

export const isTurnStart = (step: Step) => /^Turn \d+$/.test(step.label ?? '')

// A card's owner is the start of its iid. Who a step is put down to isn't
// always who played it, so plays go by whose card it is.
export const playedBy = (step: Step, player: Player) => !!played(step)?.card.startsWith(`${player}-`)

// What player has done since the turn began: how many plays, and whether the
// turn's Normal Summon or Set has gone.
export function turnSoFar(steps: Step[], player: Player): { plays: number; normalUsed: boolean } {
  const mine = steps.slice(steps.findLastIndex(isTurnStart) + 1).filter((s) => playedBy(s, player))
  const normal = (s: Step) => s.intent?.type === 'normalSummon' || s.intent?.type === 'tributeSummon' || s.label === 'Set a monster'
  return { plays: mine.length, normalUsed: mine.some(normal) }
}
