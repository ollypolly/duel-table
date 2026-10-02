import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScenarioFile } from '../src/scenarios/schema'
import { repoContext, ROOT } from './files'
import { GameService, UNDOS } from './games'
import { ocgDataDir } from './ocg/lib'
import { agentCodes } from './ocg/agentBot'
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

  it('carries a free-play board into a game with the rules on, and a game back out to free play', async () => {
    const sessions = new SessionService(ctx)
    const games = new GameService(sessions, ctx)
    const table = sessions.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 5 })
    const [a, b, c] = table.state.players.p1.zones.deck
    const theirs = table.state.players.p2.zones.deck[0]
    sessions.apply(table.id, {
      label: 'Lay it out',
      author: 'user',
      actions: [
        { type: 'move', card: a, to: { player: 'p1', zone: 'hand' } },
        { type: 'move', card: b, to: { player: 'p1', zone: 'gy' } },
        { type: 'move', card: c, to: { player: 'p1', zone: 'monster', slot: 2 } },
        { type: 'move', card: theirs, to: { player: 'p2', zone: 'spellTrap', slot: 0 }, faceUp: false },
        { type: 'lp', player: 'p2', delta: -3000 },
      ],
    })
    const where = (v: { state: typeof table.state }) => {
      const id = (iid: string | null) => (iid ? v.state.cards[iid].cardId : null)
      const { p1, p2 } = v.state.players
      return { hand: p1.zones.hand.map(id), gy: p1.zones.gy.map(id), monster: p1.zones.monster.map(id), set: p2.zones.spellTrap.map(id), deck: p1.zones.deck.length, lp: p2.lp }
    }
    const laid = where(sessions.get(table.id))

    const game = await games.fromTable(table.id)
    expect(game.id).not.toBe(table.id)
    expect(game.file.duel).toBeDefined()
    expect(where(game)).toEqual(laid)
    expect(game.state.cards[game.state.players.p2.zones.spellTrap[0]!].faceUp).toBe(false)
    expect(game.state.phase).toBe('main1')
    expect(game.game?.prompt?.player).toBe('p1')

    const back = games.toTable(game.id)
    expect(back.file.duel).toBeUndefined()
    expect(where(back)).toEqual(laid)
    // Free again: anything moves.
    expect(sessions.apply(back.id, { label: 'Anything', author: 'user', actions: [{ type: 'move', card: back.state.players.p1.zones.deck[0], to: { player: 'p1', zone: 'banished' } }] }).ok).toBe(true)
    await expect(games.fromTable(game.id)).rejects.toThrow(/already a game/)
    expect(() => games.toTable(table.id)).toThrow(/isn't a game/)
  }, 60_000)

  it('plays the trained bot only with decks it knows, and falls back to the random bot when it has no pick', async () => {
    // A stand-in for ygo-agent that is up but never has a prediction.
    let calls = 0
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v0/duels') return void res.end(JSON.stringify({ duelId: 'd1', index: 0 }))
      if (req.method === 'POST') calls++
      res.statusCode = req.method === 'POST' ? 500 : 200
      res.end('{}')
    }).listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const sessions = new SessionService(ctx)
      const games = new GameService(sessions, ctx, undefined, { url, codes: agentCodes(ROOT) })
      await games.loadAgent()
      expect(games.agentDecks()).toContain('trained-blue-eyes')
      expect(games.agentDecks()).not.toContain('chazz-armed-ojama')
      await expect(games.create({ deck: 'trained-blue-eyes', opponentDeck: 'chazz-armed-ojama', bot: 'agent' })).rejects.toThrow(/only knows its own decks/)
      const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'trained-blue-eyes', seed: 2, bots: ['p1', 'p2'], bot: 'agent' })
      expect(v.game).toMatchObject({ bot: 'agent' })
      expect(v.game?.winner).toBeDefined()
      expect(v.file.duel?.bot).toBe('agent')
      expect(sessions.list().find((s) => s.id === v.id)?.opponent).toBe('trained')
      expect(calls).toBeGreaterThan(0)
      expect(games.agentMisses(v.id).length).toBeGreaterThan(0)
      // Not offered at all when its service is down.
      const down = new GameService(new SessionService(ctx), ctx, undefined, { url: 'http://127.0.0.1:9', codes: agentCodes(ROOT) })
      await expect(down.create({ deck: 'chazz-armed-ojama', opponentDeck: 'trained-blue-eyes', bot: 'agent' })).rejects.toThrow(/isn't running/)
    } finally {
      server.close()
    }
  }, 120_000)

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

  it('is given up with a forfeit, which a rebuilt game remembers', async () => {
    const store = saving()
    const sessions = new SessionService(ctx, store)
    const games = new GameService(sessions, ctx)
    const start = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 1 })
    expect(start.game?.prompt).toBeDefined()

    const v = await games.forfeit(start.id)
    expect(v.game).toMatchObject({ winner: { player: 'p2', reason: 0 } })
    expect(v.game?.prompt).toBeUndefined()
    expect(v.steps).toBe(start.steps)
    expect(sessions.export(v.id).duel).toMatchObject({ forfeit: 'p1', winner: 'p2' })
    expect(sessions.list().find((t) => t.id === v.id)?.winner).toBe('p2')
    await expect(games.forfeit(v.id)).rejects.toThrow(/already over/)
    await expect(games.answer(v.id, undefined, { id: start.game!.prompt!.id, choices: [0] })).rejects.toThrow(/nothing is being asked/)

    const again = new GameService(new SessionService(ctx, store), ctx)
    expect((await again.get(v.id)).duel.result).toEqual({ player: 'p2', reason: 0 })
    await expect(again.forfeit(v.id)).rejects.toThrow(/already over/)
  }, 60_000)

  it('passes chances to respond for you by level, and reopens one when asked', async () => {
    // A person who picks at random, until a chance has been passed for them
    // (or, when looking for advice, until Claude's view comes with a question).
    const play = async (games: GameService, respond: 'claude' | 'advise', seed: number) => {
      const rng = seededRng(seed)
      let v = await games.create({ deck: 'trained-blue-eyes', opponentDeck: 'trained-hero', seed, respond })
      const passes: string[] = []
      for (let i = 0; i < 400 && !v.game?.winner; i++) {
        const p = v.game!.prompt!
        if (p.kind === 'chain' && p.options.some((o) => o.group === 'Pass')) passes.push(p.message)
        if (respond === 'advise' ? p.advice : v.game?.skipped?.some((s) => (respond === 'claude') === (s.by === 'claude'))) break
        const n = p.min + Math.floor(rng() * (Math.min(p.max, p.options.length) - p.min + 1))
        const choices = [...p.options.keys()].sort(() => rng() - 0.5).slice(0, n)
        v = await games.answer(v.id, undefined, { id: p.id, choices }).catch((e) => {
          if (!(e instanceof SessionError) || e.status !== 422) throw e
          return v
        })
      }
      return { v, passes }
    }
    const sessions = new SessionService(ctx, saving())
    const games = new GameService(sessions, ctx)

    // Claude passes the ones it wouldn't take, with its reason.
    const asked: string[] = []
    games.adviser = async (_id, _player, prompt) => {
      asked.push(prompt.message)
      return { stop: false, why: 'nothing worth hitting yet' }
    }
    const claude = await play(games, 'claude', 5)
    const skipped = claude.v.game!.skipped!.at(-1)!
    expect(skipped).toMatchObject({ by: 'claude', why: 'nothing worth hitting yet' })
    expect(skipped.cards.length).toBeGreaterThan(0)
    expect(claude.passes).toEqual([])
    expect(asked.length).toBeGreaterThan(0)
    expect(sessions.export(claude.v.id).duel).toMatchObject({ respond: 'claude' })
    // Asked after all: back at that chance, which is no longer listed as passed.
    const back = await games.reopen(claude.v.id, skipped.at)
    expect(back.game?.prompt).toMatchObject({ id: skipped.at, kind: 'chain' })
    expect(back.game?.skipped?.some((s) => s.at === skipped.at) ?? false).toBe(false)
    expect(back.file.duel?.responses).toHaveLength(skipped.at)
    await expect(games.reopen(claude.v.id, skipped.at)).rejects.toThrow(/no passed chance/)
    // Or it only says what it thinks.
    const advise = await play(games, 'advise', 5)
    expect(advise.v.game!.prompt).toMatchObject({ kind: 'chain', advice: 'Claude would pass: nothing worth hitting yet' })
    expect((await games.setRespond(advise.v.id, 'all')).game?.respond).toBe('all')
  }, 120_000)

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
