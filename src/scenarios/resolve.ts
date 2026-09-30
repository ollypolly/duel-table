// Validates scenario files and resolves them into engine input: card names
// become passcodes, decks are expanded, forks are flattened onto their parent,
// and the whole thing is dry-run so bad steps fail here with a clear message.
// Pure: callers pass in the raw JSON, decks and card DB.
import { z } from 'zod'
import type { CardDb } from '../data/cardDb'
import { isExtraDeckCard, levenshtein } from '../data/cardDb'
import {
  createInitialState,
  StepError,
  tableRules,
  timeline as buildTimeline,
  validateStep,
  type GameSetup,
  type Issue,
  type Placement,
  type Player,
  type PlayerSetup,
  type ScriptedGame,
  type SetupCard,
  type TimelineEntry,
} from '../engine'
import { DeckSchema, ScenarioSchema, type DeckFile, type ScenarioFile } from './schema'

export type ResolvedScenario = {
  id: string
  title: string
  description?: string
  extends?: { scenario: string; atStep: number }
  inheritedSteps: number // steps that come from the parent (forks)
  game: ScriptedGame
  timeline: TimelineEntry[]
  warnings: string[]
  file: ScenarioFile
}

export type ResolveResult = { ok: true; scenario: ResolvedScenario } | { ok: false; id: string; errors: string[] }

export type ResolveContext = {
  db: CardDb
  decks: Record<string, unknown> // raw deck JSON by id
  scenarios: Record<string, unknown> // raw scenario JSON by id (for extends)
}

export class ScenarioError extends Error {
  readonly errors: string[]
  constructor(errors: string[]) {
    super(errors.join('\n'))
    this.errors = errors
  }
}

export function formatZodError(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${prefix}${i.path.length ? ` at ${i.path.join('.')}` : ''}: ${i.message}`)
}

export function parseDeck(raw: unknown, where = 'deck'): DeckFile {
  const r = DeckSchema.safeParse(raw)
  if (!r.success) throw new ScenarioError(formatZodError(where, r.error))
  return r.data
}

export function resolveScenario(raw: unknown, ctx: ResolveContext): ResolveResult {
  const id = (raw as { id?: unknown })?.id
  const idStr = typeof id === 'string' ? id : '(no id)'
  try {
    return { ok: true, scenario: resolve(raw, ctx, []) }
  } catch (e) {
    return { ok: false, id: idStr, errors: e instanceof ScenarioError ? e.errors : [String(e instanceof Error ? e.message : e)] }
  }
}

export function resolveAll(ctx: ResolveContext): ResolveResult[] {
  return Object.values(ctx.scenarios).map((raw) => resolveScenario(raw, ctx))
}

function resolve(raw: unknown, ctx: ResolveContext, chain: string[]): ResolvedScenario {
  const parsed = ScenarioSchema.safeParse(raw)
  if (!parsed.success) throw new ScenarioError(formatZodError('scenario', parsed.error))
  const file = parsed.data

  let setup: GameSetup
  let inherited: ScriptedGame['steps'] = []
  if (file.extends) {
    const { scenario: parentId, atStep } = file.extends
    if (chain.includes(parentId) || parentId === file.id) {
      throw new ScenarioError([`extends loops: ${[...chain, file.id, parentId].join(' → ')}`])
    }
    const parentRaw = ctx.scenarios[parentId]
    if (!parentRaw) throw new ScenarioError([`extends unknown scenario "${parentId}"`])
    const parent = resolve(parentRaw, ctx, [...chain, file.id])
    if (atStep >= parent.game.steps.length) {
      throw new ScenarioError([`extends ${parentId} at step ${atStep}, but it only has steps 0-${parent.game.steps.length - 1}`])
    }
    setup = parent.game.setup
    inherited = parent.game.steps.slice(0, atStep + 1)
  } else {
    setup = buildSetup(file, ctx)
  }

  const game: ScriptedGame = { setup, steps: [...inherited, ...file.steps] }
  const { timeline, warnings } = dryRun(game)
  return {
    id: file.id,
    title: file.title,
    description: file.description,
    extends: file.extends,
    inheritedSteps: inherited.length,
    game,
    timeline,
    warnings,
    file,
  }
}

function buildSetup(file: ScenarioFile, ctx: ResolveContext): GameSetup {
  const errors: string[] = []
  const players = file.players!
  const lookup = (name: string, where: string): SetupCard | undefined => {
    const card = ctx.db.byName(name)
    if (card) return { name: card.name, cardId: card.id, extra: isExtraDeckCard(card) }
    const close = ctx.db.closeMatches(name)
    errors.push(
      `${where}: unknown card "${name}"${close.length ? `. Did you mean ${close.map((c) => `"${c}"`).join(', ')}?` : ' (run npm run fetch-cards if it is a real card)'}`,
    )
    return undefined
  }

  const setupPlayer = (player: Player): PlayerSetup => {
    const p = players[player]
    const pool: SetupCard[] = []
    if (p.deck) {
      const rawDeck = ctx.decks[p.deck]
      if (!rawDeck) errors.push(`players.${player}.deck: unknown deck "${p.deck}" (known: ${Object.keys(ctx.decks).join(', ') || 'none'})`)
      else {
        const deck = parseDeck(rawDeck, `deck ${p.deck}`)
        for (const e of [...deck.main, ...deck.extra]) {
          const card = lookup(e.name, `deck ${p.deck}`)
          if (card) for (let i = 0; i < e.count; i++) pool.push(card)
        }
      }
    }
    for (const ref of p.cards ?? []) {
      if (typeof ref === 'string') {
        const card = lookup(ref, `players.${player}.cards`)
        if (card) pool.push(card)
      } else {
        pool.push({ name: ref.custom.name, custom: ref.custom, extra: ref.custom.kind === 'extra' })
      }
    }

    // Placement names can be written loosely; normalise them to the pool's spelling.
    const canonical = (name: string, where: string) => {
      const exact = pool.find((c) => c.name === name)
      if (exact) return exact.name
      const viaDb = ctx.db.byName(name)?.name
      if (viaDb && pool.some((c) => c.name === viaDb)) return viaDb
      errors.push(`${where}: "${name}" isn't one of ${player}'s cards`)
      return name
    }
    const placed: PlayerSetup['placed'] = {}
    for (const [zone, entries] of Object.entries(file.setup?.[player] ?? {})) {
      placed[zone as keyof typeof placed] = entries!.map((e, i): Placement | null => {
        if (e === null) return null
        const where = `setup.${player}.${zone}[${i}]`
        const p = typeof e === 'string' ? { name: e } : e
        return { ...p, name: canonical(p.name, where), ...(p.materials && { materials: p.materials.map((m) => canonical(m, `${where}.materials`)) }) }
      })
    }
    return { name: p.name, lp: p.lp, ...(p.deck && { deck: p.deck }), pool, placed }
  }

  const setup: GameSetup = {
    seed: file.seed ?? 1,
    players: { p1: setupPlayer('p1'), p2: setupPlayer('p2') },
    ...(file.setup?.extraMonster && {
      extraMonster: file.setup.extraMonster.map((e) => (e ? { ...e, name: ctx.db.byName(e.name)?.name ?? e.name } : null)),
    }),
    ...file.start,
  }
  if (errors.length) throw new ScenarioError(errors)
  return setup
}

// Replay every step once so broken steps are reported at load time, with
// suggestions for mistyped iids, and collect tableRules warnings.
function dryRun(game: ScriptedGame): { timeline: TimelineEntry[]; warnings: string[] } {
  let timeline: TimelineEntry[]
  try {
    timeline = buildTimeline(game)
  } catch (e) {
    if (!(e instanceof StepError)) throw new ScenarioError([`setup: ${e instanceof Error ? e.message : String(e)}`])
    const label = game.steps[e.step]?.label
    let message = `${e.message}${label ? ` (step "${label}")` : ''}`
    const unknown = /Unknown card "([^"]+)"/.exec(e.message)?.[1]
    if (unknown) {
      const iids = Object.keys(createInitialState(game.setup).cards)
      const close = closeIids(unknown, iids)
      if (close.length) message += `. Did you mean ${close.join(', ')}?`
    }
    throw new ScenarioError([message])
  }
  const warnings: string[] = []
  game.steps.forEach((step, i) => {
    const issues: Issue[] = validateStep(tableRules, timeline[i].state, step.actions)
    for (const issue of issues) {
      if (issue.severity === 'warning') warnings.push(`Step ${i + 1}, action ${(issue.action ?? 0) + 1}: ${issue.message}`)
    }
  })
  return { timeline, warnings }
}

function closeIids(target: string, iids: string[]): string[] {
  return iids
    .map((iid) => ({ iid, d: levenshtein(target, iid) }))
    .filter((x) => x.d <= Math.max(3, target.length / 3))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.iid)
}
