import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScenarioFile } from '../src/scenarios/schema'
import { repoContext, ROOT } from './files'
import { GameService, UNDOS } from './games'
import { ocgDataDir } from './ocg/lib'
import { seededRng } from './ocg/bot'
import { SessionError, SessionService, type SessionStore } from './sessions'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

const saving = () => {
  const files = new Map<string, ScenarioFile>()
  const store: SessionStore = { load: () => [...files.values()], save: (f) => void files.set(f.id, f), remove: (id) => void files.delete(id) }
  return store
}

describe.skipIf(!hasData)('games on the rules engine', () => {
  it('plays a bot game to the end and saves its answers', async () => {
    const sessions = new SessionService(ctx)
    const games = new GameService(sessions, ctx)
    const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 3, bots: ['p1', 'p2'] })
    expect(v.game?.winner).toBeDefined()
    expect(v.game?.waitingFor).toBeUndefined()
    expect(v.file.duel?.responses.length).toBeGreaterThan(10)
    expect(v.steps).toBeGreaterThan(20)
    // Bot steps are paced, not shown at once.
    expect(v.lesson.queued).toBeGreaterThan(0)
  }, 60_000)

  it('stops at a person and refuses free-play steps and undo', async () => {
    const sessions = new SessionService(ctx)
    const games = new GameService(sessions, ctx)
    const v = await games.create({ deck: 'chazz-armed-ojama', seed: 1 })
    expect(v.game).toMatchObject({ bots: ['p2'], waitingFor: 'p1' })
    expect(() => sessions.apply(v.id, { actions: [{ type: 'nextTurn' }] })).toThrow(/rules engine/)
    expect(() => sessions.undo(v.id)).toThrow(/takes a move back instead/)
  }, 60_000)

  it("starts from a scenario's setup, and rebuilds after a restart", async () => {
    const store = saving()
    const games = new GameService(new SessionService(ctx, store), ctx)
    const v = await games.create({ scenario: 'ojama-vs-super-quant-t1-t3' })
    expect(v.file.title).toBe('Practice: Armed Ojama vs Super Quant: turns 1–3')
    expect(v.game).toMatchObject({ waitingFor: 'p1', prompt: { kind: 'idle' } })
    expect(v.state.phase).toBe('main1')
    const hand = v.state.players.p1.zones.hand
    expect(hand).toHaveLength(5)

    const again = new GameService(new SessionService(ctx, store), ctx)
    expect((await again.get(v.id)).state.players.p1.zones.hand).toEqual(hand)
  }, 60_000)

  it.each([1, 2, 3])('seed %i: a person can play a whole game through the questions', async (seed) => {
    const sessions = new SessionService(ctx)
    const games = new GameService(sessions, ctx)
    const rng = seededRng(seed * 7)
    let v = await games.create({ deck: 'super-quant', opponentDeck: 'chazz-armed-ojama', seed })
    const kinds = new Set<string>()
    let rejected = 0
    for (let i = 0; i < 1500 && v.game?.prompt; i++) {
      const p = v.game.prompt
      kinds.add(p.kind)
      expect(p.options.every((o) => o.label && !o.label.includes('undefined'))).toBe(true)
      expect(p.options.every((o) => !o.card || v.state.cards[o.card])).toBe(true)
      const n = p.min + Math.floor(rng() * (Math.min(p.max, p.options.length) - p.min + 1))
      const choices = [...p.options.keys()].sort(() => rng() - 0.5).slice(0, n)
      try {
        v = await games.answer(v.id, 'p1', { id: p.id, choices })
      } catch (e) {
        // Picks that don't add up (sums, tributes) are refused; try again.
        if (!(e instanceof SessionError) || e.status !== 422 || ++rejected > 200) throw e
      }
    }
    expect(v.game?.winner).toBeDefined()
    expect(kinds.has('idle')).toBe(true)
  }, 60_000)

  it('takes back a move, a few times a game', async () => {
    const store = saving()
    const sessions = new SessionService(ctx, store)
    const games = new GameService(sessions, ctx)
    const start = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 1, bots: [] })
    expect(start.game?.undos).toBeUndefined()
    await expect(games.undo(start.id)).rejects.toThrow(/no move of yours/)
    const endTurn = (v: typeof start) => games.answer(v.id, undefined, { id: v.game!.prompt!.id, choices: [v.game!.prompt!.options.findIndex((o) => o.label === 'End turn')] })

    let v = await endTurn(start)
    expect(v.state.activePlayer).toBe('p2')
    expect(v.game?.undos).toBe(UNDOS)
    v = await games.undo(v.id)
    expect(v.state).toEqual(start.state)
    expect(v.steps).toBe(start.steps)
    expect(v.game).toMatchObject({ prompt: start.game!.prompt })
    expect(v.game?.undos).toBeUndefined()

    // A rebuilt game knows its moves and how many were taken back.
    v = await endTurn(v)
    const again = new GameService(new SessionService(ctx, store), ctx)
    await again.get(v.id)
    for (let left = UNDOS - 1; left > 0; left--) {
      v = await again.undo(v.id)
      expect(v.state).toEqual(start.state)
      v = await again.answer(v.id, undefined, { id: v.game!.prompt!.id, choices: [v.game!.prompt!.options.findIndex((o) => o.label === 'End turn')] })
    }
    await expect(again.undo(v.id)).rejects.toThrow(/take-backs are used/)
  }, 60_000)

  it('shuffles each Deck from the seed', async () => {
    const sessions = new SessionService(ctx)
    const games = new GameService(sessions, ctx)
    const hand = async (seed: number) => {
      const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed, bots: [] })
      const { state } = await games.get(v.id)
      return state.players.p1.zones.hand.map((iid) => state.cards[iid].cardId)
    }
    const hands = await Promise.all([1, 2, 3, 4].map(hand))
    expect(new Set(hands.map((h) => h.join())).size).toBeGreaterThan(1)
    expect(await hand(1)).toEqual(hands[0])
  }, 60_000)

  it('rebuilds a game after a restart', async () => {
    const store = saving()
    const before = new SessionService(ctx, store)
    const first = new GameService(before, ctx)
    const v = await first.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 5, bots: ['p1', 'p2'] })
    const played = await first.get(v.id)

    const after = new SessionService(ctx, store)
    const second = new GameService(after, ctx)
    const game = await second.get(v.id)
    expect(game.state).toEqual(played.state)
    expect(after.get(v.id).game?.winner).toEqual(v.game?.winner)
  }, 60_000)
})
