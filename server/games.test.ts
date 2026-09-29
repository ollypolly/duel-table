import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScenarioFile } from '../src/scenarios/schema'
import { repoContext, ROOT } from './files'
import { GameService } from './games'
import { ocgDataDir } from './ocg/lib'
import { SessionService, type SessionStore } from './sessions'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

const saving = () => {
  const files = new Map<string, ScenarioFile>()
  const store: SessionStore = { load: () => [...files.values()], save: (f) => void files.set(f.id, f) }
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
    expect(() => sessions.undo(v.id)).toThrow(/can't be undone/)
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
