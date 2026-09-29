// Bot duels on the real rules core: after every batch, our board must match
// the core's, and the translated steps must replay as a scenario.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveScenario, type ResolvedScenario } from '../../src/scenarios/resolve'
import type { ScenarioFile } from '../../src/scenarios/schema'
import { repoContext, ROOT } from '../files'
import { botResponse, seededRng } from './bot'
import { OcgGame } from './game'
import { loadOcg, ocgDataDir } from './lib'
import { diffWithCore } from './translate'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

function scenario(seed: number, deck = 'chazz-armed-ojama', opponentDeck = 'super-quant') {
  const file = { id: `bot-${seed}`, title: 'Bots', seed, players: { p1: { name: 'A', deck }, p2: { name: 'B', deck: opponentDeck } }, steps: [] }
  const r = resolveScenario(file, ctx())
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return { file: file as ScenarioFile, resolved: r.scenario as ResolvedScenario }
}

async function playOut(seed: number, maxAnswers = 3000) {
  const ocg = await loadOcg(join(ROOT, ocgDataDir()))
  const { file, resolved } = scenario(seed)
  const game = new OcgGame(ocg, resolved)
  const rng = seededRng(seed)
  const codes = [...new Set(Object.values(game.state.cards).map((c) => c.cardId!))]
  const steps = []
  const diffs: string[] = []
  let p = game.start()
  let attempt = 0
  for (let i = 0; i < maxAnswers && p.prompt; i++) {
    if (attempt > 50) throw new Error(`stuck on ${p.prompt.constructor.name}`)
    steps.push(...p.steps)
    if (!p.retried) {
      const d = diffWithCore(game.state, game.duel)
      if (d.length) diffs.push(`after ${steps.length} steps (${steps.at(-1)?.label}): ${d.join('; ')}`)
    }
    attempt = p.retried ? attempt + 1 : 0
    p = game.respond(botResponse(p.prompt, rng, attempt, codes))
  }
  steps.push(...p.steps)
  return { game, file, steps, diffs, winner: p.winner }
}

describe.skipIf(!hasData)('bot duels on the rules core', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i: translates every batch exactly', async (seed) => {
    const { game, file, steps, diffs, winner } = await playOut(seed)
    expect(game.translator.problems).toEqual([])
    expect(diffs.slice(0, 3)).toEqual([])
    expect(winner).toBeDefined()
    // The steps are a valid scenario that replays to the same board.
    const r = resolveScenario({ ...file, steps }, ctx())
    if (!r.ok) throw new Error(r.errors.slice(0, 5).join('\n'))
    const final = r.scenario.timeline.at(-1)!.state
    expect(final.players).toEqual(game.state.players)
    expect(r.scenario.warnings).toEqual([])
  }, 60_000)

  it('rebuilds from saved answers', async () => {
    const { game, steps } = await playOut(7, 200)
    const ocg = await loadOcg()
    const again = new OcgGame(ocg, scenario(7).resolved)
    const replayed = again.replay(game.duel.responses)
    expect(replayed.steps).toEqual(steps)
    expect(again.state).toEqual(game.state)
  }, 60_000)
})
