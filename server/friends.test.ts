// @vitest-environment node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AccountService, memoryAccounts } from './accounts'
import { createApp } from './app'
import { repoContext, ROOT } from './files'
import { GameService } from './games'
import { ocgDataDir } from './ocg/lib'
import { SessionService } from './sessions'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

const setup = () => {
  const accounts = new AccountService(memoryAccounts())
  const olly = accounts.ensureAdmin('olly')!
  const sessions = new SessionService(ctx)
  const games = new GameService(sessions, ctx)
  const app = createApp({ sessions, ctx, games, accounts })
  const call = async (key: string | undefined, method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { cookie: `duel-key=${key}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json()) as any, cookie: res.headers.get('set-cookie') }
  }
  return { call, olly, sessions }
}

describe.skipIf(!hasData)('a game against a friend', () => {
  it('invites, joins (making the account), and keeps each hand to its player', async () => {
    const { call, olly, sessions } = setup()
    const invite = await call(olly, 'POST', '/invites', { deck: 'chazz-armed-ojama' })
    expect(invite).toMatchObject({ status: 201, json: { from: { username: 'olly' }, deck: { id: 'chazz-armed-ojama' }, yours: true } })
    const { code } = invite.json

    // Rob opens the link: who it's from, then joins with a new account and a deck.
    expect((await call(undefined, 'GET', `/invites/${code}`)).json).toMatchObject({ from: { name: 'Olly' }, yours: false, playing: false })
    expect((await call(olly, 'POST', `/invites/${code}/join`, { deck: 'super-quant' })).status).toBe(409)
    const joined = await call(undefined, 'POST', `/invites/${code}/join`, { deck: 'super-quant', respond: 'all', account: { username: 'rob', name: 'Rob' } })
    expect(joined).toMatchObject({ status: 200, json: { playing: true, session: expect.any(String) } })
    const rob = joined.cookie!.match(/duel-key=([^;]+)/)![1]
    const id = joined.json.session
    expect((await call(undefined, 'POST', `/invites/${code}/join`, { deck: 'super-quant', account: { username: 'sam', name: 'Sam' } })).status).toBe(409)

    // The game is Olly's, with both seated.
    const real = sessions.get(id)
    const seats = real.file.duel!.seats!
    expect(real.owner).toBe((await call(olly, 'GET', '/me')).json.me.id)
    const robSeat = seats.p1 === real.owner ? 'p2' : 'p1'
    const ollySeat = robSeat === 'p1' ? 'p2' : 'p1'
    expect(real.file.duel!.responds).toEqual({ [robSeat]: 'all' })

    // Each sees themselves as p1, their own hand, and the other's as hidden cards.
    for (const [key, seat] of [
      [olly, ollySeat],
      [rob, robSeat],
    ] as const) {
      const v = (await call(key, 'GET', `/sessions/${id}`)).json
      const other = seat === 'p1' ? 'p2' : 'p1'
      const mine = v.state.players.p1.zones.hand.map((i: string) => v.state.cards[i].cardId)
      expect(mine).toEqual(real.state.players[seat].zones.hand.map((i) => real.state.cards[i].cardId))
      const theirs = v.state.players.p2.zones.hand.map((i: string) => v.state.cards[i])
      expect(theirs).toHaveLength(real.state.players[other].zones.hand.length)
      expect(theirs.every((c: any) => c.custom?.name === 'Hidden card' && c.cardId === undefined)).toBe(true)
      expect(v.file.seed).toBeUndefined()
      expect(v.file.duel.responses).toEqual([])
      // Nothing in their Deck is named either, and their cards' names are only the face-up ones.
      expect(v.state.players.p2.zones.deck.every((i: string) => v.state.cards[i].cardId === undefined)).toBe(true)
      const named = Object.values(v.state.cards as Record<string, any>).filter((c) => c.owner === 'p2' && c.cardId !== undefined)
      expect(named.every((c) => c.faceUp)).toBe(true)
      // Only the table's own routes while it's going.
      expect((await call(key, 'POST', `/sessions/${id}/export`, { id: 'x', title: 'x' })).status).toBe(403)
    }
    // Rename and delete stay the owner's.
    expect((await call(rob, 'PATCH', `/sessions/${id}`, { title: 'Mine' })).status).toBe(403)

    // Only whoever's being asked can answer.
    const asked = real.game!.prompt!
    const [askedKey, otherKey] = asked.player === ollySeat ? [olly, rob] : [rob, olly]
    expect((await call(otherKey, 'POST', `/sessions/${id}/game/answer`, { id: asked.id, choices: [0] })).status).toBe(409)
    expect((await call(askedKey, 'POST', `/sessions/${id}/game/answer`, { id: asked.id, choices: [0] })).status).toBe(200)

    // Giving up ends it, and then everything is shown.
    expect((await call(rob, 'POST', `/sessions/${id}/game/forfeit`)).json.game.winner.player).toBe('p2')
    const after = (await call(rob, 'GET', `/sessions/${id}`)).json
    expect(after.file.seed).toBeDefined()
    // Still from Rob's side of the table.
    expect(after.game.winner.player).toBe('p2')
    expect(after.state.players.p1.name).toBe('Rob')
  }, 60_000)

  it('asks the other player before taking a move back', async () => {
    const { call, olly, sessions } = setup()
    const { code } = (await call(olly, 'POST', '/invites', { deck: 'chazz-armed-ojama' })).json
    const joined = await call(undefined, 'POST', `/invites/${code}/join`, { deck: 'chazz-armed-ojama', account: { username: 'rob', name: 'Rob' } })
    const rob = joined.cookie!.match(/duel-key=([^;]+)/)![1]
    const id = joined.json.session
    const keyOf = (p: string) => (sessions.export(id).duel!.seats![p as 'p1'] === sessions.get(id).owner ? olly : rob)
    // Play until someone has made a move of their own.
    let mover: string | undefined
    for (let i = 0; i < 40 && !mover; i++) {
      const { prompt } = sessions.get(id).game!
      if (!prompt) break
      const before = sessions.export(id).duel!.responses.length
      await call(keyOf(prompt.player), 'POST', `/sessions/${id}/game/answer`, {
        id: prompt.id,
        choices: prompt.options.length > prompt.min ? [prompt.options.length - 1].slice(0, Math.max(prompt.min, 1)) : [...Array(prompt.min).keys()],
      })
      if (sessions.export(id).duel!.responses.length > before && (await call(keyOf(prompt.player), 'POST', `/sessions/${id}/game/undo`)).status === 200) mover = prompt.player
    }
    expect(mover).toBeDefined()
    const otherKey = keyOf(mover === 'p1' ? 'p2' : 'p1')
    expect(sessions.get(id).game!.takeback).toEqual({ by: mover })
    const answers = sessions.export(id).duel!.responses.length
    // The asker can't answer their own request; the other player can say no, or yes.
    expect((await call(keyOf(mover!), 'POST', `/sessions/${id}/game/takeback`, { accept: true })).status).toBe(409)
    expect((await call(otherKey, 'POST', `/sessions/${id}/game/takeback`, { accept: false })).status).toBe(200)
    expect(sessions.get(id).game!.takeback).toEqual({ by: mover, refused: true })
    await call(keyOf(mover!), 'POST', `/sessions/${id}/game/undo`)
    expect((await call(otherKey, 'POST', `/sessions/${id}/game/takeback`, { accept: true })).status).toBe(200)
    expect(sessions.get(id).game!.takeback).toBeUndefined()
    expect(sessions.export(id).duel!.responses.length).toBeLessThan(answers)
  }, 60_000)
})
