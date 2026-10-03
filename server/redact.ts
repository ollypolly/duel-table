// A game against a friend, as one player may see it while it's going: the
// other side's hidden cards (their hand, Deck and face-down cards) become
// anonymous ones, and nothing that could rebuild them (the seed, the rules
// engine's answers) is sent. The browser replays what it's given as it would
// any game, so the hidden cards never reach it.
//
// For the player in p2 the sides are also swapped, so they sit at the bottom
// of the table as p1 does: the browser always draws its viewer as p1.
import type { BoardState, CardInstance, Iid, Player } from '../src/engine'
import { iidFor } from '../src/engine/setup'
import { isExtraDeckCard } from '../src/data/cardDb'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import type { ScenarioFile } from '../src/scenarios/schema'
import type { SessionView } from './sessions'

const HIDDEN = { name: 'Hidden card', text: '' }
const HIDDEN_EXTRA = { name: 'Extra Deck card', text: '', kind: 'extra' as const }
const other = (p: Player): Player => (p === 'p1' ? 'p2' : 'p1')

// Every string in a value (and every key), mapped.
const mapStrings = <T>(value: T, fn: (s: string) => string): T => {
  if (typeof value === 'string') return fn(value) as T
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), mapStrings(v, fn)])) as T
  return value
}

// The cards of player's that the other side can't see.
const hiddenOf = (state: BoardState, player: Player): Set<Iid> => {
  const hidden = new Set<Iid>()
  for (const [zone, iids] of Object.entries(state.players[player].zones)) for (const iid of iids as (Iid | null)[]) if (iid && (zone === 'hand' || !state.cards[iid].faceUp)) hidden.add(iid)
  for (const iid of state.extraMonster) if (iid && state.cards[iid].owner === player && !state.cards[iid].faceUp) hidden.add(iid)
  return hidden
}

// seat: the viewer's (undefined for someone watching: both sides are hidden).
// hide: the game is going (once it's over, everything is shown, from the
// same side of the table).
export function redactFor(view: SessionView, seat: Player | undefined, ctx: ResolveContext, hide = true): SessionView {
  if (!hide && seat !== 'p2') return view
  const { file, state } = view
  const players = { ...file.players! }
  const rename = new Map<Iid, Iid>()
  const names = new Map<Iid, string>() // a hidden card's real name, scrubbed from step labels
  for (const p of (['p1', 'p2'] as const).filter((p) => hide && p !== seat)) {
    const hidden = hiddenOf(state, p)
    const cards: NonNullable<NonNullable<ScenarioFile['players']>['p1']['cards']> = []
    const copies = new Map<string, number>()
    let n = 0
    let m = 0
    for (const card of Object.values(state.cards).filter((c: CardInstance) => c.owner === p)) {
      const data = card.cardId === undefined ? undefined : ctx.db.byId(card.cardId)
      const name = card.custom?.name ?? data?.name ?? card.iid
      if (hidden.has(card.iid)) {
        const extra = card.custom ? card.custom.kind === 'extra' : !!data && isExtraDeckCard(data)
        rename.set(card.iid, extra ? iidFor(p, HIDDEN_EXTRA.name, ++m) : iidFor(p, HIDDEN.name, ++n))
        names.set(card.iid, name)
        cards.push({ custom: extra ? HIDDEN_EXTRA : HIDDEN })
      } else {
        const copy = (copies.get(name) ?? 0) + 1
        copies.set(name, copy)
        rename.set(card.iid, iidFor(p, name, copy))
        cards.push(card.custom ? { custom: card.custom } : name)
      }
    }
    players[p] = { name: players[p].name, ...(players[p].lp !== undefined && { lp: players[p].lp }), cards }
  }

  const iid = (s: string) => rename.get(s) ?? s
  const steps = file.steps.map((step) => {
    const mapped = mapStrings(step, iid)
    let { label, narration } = mapped
    for (const [old, name] of names)
      if (JSON.stringify(step.actions).includes(`"${old}"`)) {
        label = label?.replaceAll(name, 'a card')
        narration = narration?.replaceAll(name, 'a card')
      }
    return { ...mapped, ...(label !== undefined && { label }), ...(narration !== undefined && { narration }) }
  })
  const { seed: _, duel, ...rest } = file
  let redacted: ScenarioFile = hide ? { ...rest, players, steps, ...(duel && { duel: { ...duel, responses: [], skipped: undefined, asked: undefined } }) } : file
  const game = view.game && (hide ? mapStrings({ ...view.game, prompt: view.game.prompt?.player === seat ? view.game.prompt : undefined, skipped: undefined }, iid) : view.game)
  let out: SessionView = hide ? { ...view, file: redacted, game, lesson: mapStrings(view.lesson, iid), review: undefined } : view

  if (seat === 'p2') {
    const swap = (s: string) => (s === 'p1' ? 'p2' : s === 'p2' ? 'p1' : /^p[12]-/.test(s) ? `${other(s.slice(0, 2) as Player)}${s.slice(2)}` : s)
    out = mapStrings(out, swap)
    // Text stays as it was written (a card called "p1" there isn't).
    out = { ...out, title: view.title, file: { ...out.file, title: view.file.title, steps: out.file.steps.map((s, i) => ({ ...s, label: steps[i].label, narration: steps[i].narration })) } }
    redacted = out.file
  }
  const resolved = resolveScenario(redacted, ctx)
  // Never fall back to the real board.
  if (!resolved.ok) throw new Error(`the game doesn't replay with its hidden cards: ${resolved.errors.slice(0, 3).join('; ')}`)
  return { ...out, state: resolved.scenario.timeline.at(-1)!.state }
}
