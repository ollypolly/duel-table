// Bot duels on the real rules core: after every batch, our board must match
// the core's, and the translated steps must replay as a scenario.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveScenario, type ResolvedScenario } from '../../src/scenarios/resolve'
import type { ScenarioFile } from '../../src/scenarios/schema'
import { repoContext, ROOT } from '../files'
import { botResponse, seededRng } from './bot'
import { OcgGame } from './game'
import { LOC, loadOcg, M, ocgDataDir } from './lib'
import { diffWithCore } from './translate'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

function scenario(seed: number, deck = 'chazz-armed-ojama', opponentDeck = 'super-quant') {
  const file = { id: `bot-${seed}`, title: 'Bots', seed, players: { p1: { name: 'A', deck }, p2: { name: 'B', deck: opponentDeck } }, steps: [] }
  return resolved(file)
}

// A lesson's kind of start: both hands and fields set up, mid-duel.
const POSITION = {
  id: 'position',
  title: 'Position',
  seed: 3,
  players: { p1: { name: 'A', deck: 'yuma-utopia' }, p2: { name: 'B', deck: 'yugi-dark-magician', lp: 3000 } },
  setup: {
    p1: {
      hand: ['Gagaga Magician', 'Goblindbergh'],
      monster: [null, { name: 'Number 39: Utopia', materials: ['Zubaba Knight', 'Gagaga Girl'] }],
      spellTrap: [{ name: 'Mirror Force', faceUp: false }],
      gy: ['Kagetokage'],
      deck: ['Dark Hole'],
    },
    p2: {
      hand: ['Ash Blossom & Joyous Spring'],
      monster: [null, null, { name: 'Dark Magician', faceUp: false, position: 'def' }],
      fieldSpell: ['Dark Magical Circle'],
      banished: ['Effect Veiler'],
    },
    extraMonster: [{ player: 'p1', name: 'Gagaga Cowboy', position: 'def' }],
  },
  start: { phase: 'main1' },
  steps: [],
}

function resolved(file: object) {
  const r = resolveScenario(file as ScenarioFile, ctx())
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return { file: file as ScenarioFile, resolved: r.scenario as ResolvedScenario }
}

async function playOut(seed: number, maxAnswers = 3000, { file, resolved } = scenario(seed)) {
  const ocg = await loadOcg(join(ROOT, ocgDataDir()))
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

  describe('from a position', () => {
    it('starts where the setup is, in Main Phase 1, able to attack', async () => {
      const ocg = await loadOcg()
      const game = new OcgGame(ocg, resolved(POSITION).resolved)
      const p = game.start()
      expect(game.translator.problems).toEqual([])
      expect(diffWithCore(game.state, game.duel)).toEqual([])
      expect(p.steps).toEqual([]) // no opening hands, no Draw or Standby Phase
      expect(p.waitingFor).toBe('p1')
      expect(p.prompt).toBeInstanceOf(M.YGOProMsgSelectIdleCmd)
      expect((p.prompt as InstanceType<typeof M.YGOProMsgSelectIdleCmd>).canBp).toBeTruthy()
      expect(game.duel.lp('p2')).toBe(3000)
      // The stacked card is on top of the Deck.
      expect(game.duel.fieldCards('p1', LOC.deck, 1).at(-1)?.code).toBe([...ocg.cards()].find((c) => c.name === 'Dark Hole')?.code)
    })

    it.each([1, 2, 3])('seed %i: plays on and translates every batch exactly', async (seed) => {
      const { game, diffs } = await playOut(seed, 400, resolved({ ...POSITION, seed }))
      expect(game.translator.problems).toEqual([])
      expect(diffs.slice(0, 3)).toEqual([])
    }, 60_000)

    it('starts a preset lesson from its setup', async () => {
      const file = JSON.parse(readFileSync(join(ROOT, 'scenarios/ojama-vs-super-quant-t1-t3.json'), 'utf8'))
      const { game, diffs } = await playOut(1, 400, resolved({ ...file, steps: [] }))
      expect(game.translator.problems).toEqual([])
      expect(diffs.slice(0, 3)).toEqual([])
    }, 60_000)
  })
})
