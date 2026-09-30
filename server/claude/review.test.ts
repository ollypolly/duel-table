import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatEntry } from '../../src/api/game'
import { createApp } from '../app'
import { repoContext, ROOT } from '../files'
import { GameService } from '../games'
import { ocgDataDir } from '../ocg/lib'
import { SessionService } from '../sessions'
import type { Agent, AgentRequest } from './agent'
import type { ClaudeService } from './service'
import { ReviewService } from './review'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

// Replies with a fixed line, keeping what it was sent.
async function setup(played?: { player: 'p2'; chat: ChatEntry[] }) {
  const requests: AgentRequest[] = []
  const agent: Agent = (req) => {
    requests.push(req)
    async function* run() {
      yield { type: 'text' as const, text: 'You could have attacked first.' }
      yield { type: 'done' as const, sessionId: 'review-session', costUsd: 0.02 }
    }
    return { events: run(), interrupt: async () => {} }
  }
  const sessions = new SessionService(ctx)
  const games = new GameService(sessions, ctx)
  const review = new ReviewService({ sessions, db: () => ctx().db, agent, system: () => 'review', played: () => played })
  // Bots on both sides play it to the end.
  const { id } = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 3, bots: ['p1', 'p2'] })
  return { requests, sessions, games, review, id }
}

describe.skipIf(!hasData)('reviewing a game with Claude', () => {
  it('primes Claude with the whole game and its chat, then tells it only what you are looking at', async () => {
    const chat: ChatEntry[] = [
      { from: 'you', text: 'Good luck!' },
      { from: 'move', text: 'Normal Summon' },
    ]
    const { requests, sessions, review, id } = await setup({ player: 'p2', chat })
    const { steps } = sessions.export(id)
    const labelled = steps.flatMap((s, i) => (s.label ? [{ n: i + 1, label: s.label }] : []))

    review.start(id)
    expect(sessions.get(id).review).toMatchObject({ status: 'idle', chat: [] })
    review.chat(id, 'What should I have done here?', 5)
    await review.idle(id)

    const first = requests[0].message
    expect(first).toContain('You played p2 against the person.')
    expect(first).toMatch(/won, on turn \d+/)
    expect(first).toContain('The person: Good luck!')
    expect(first).toContain('Claude played: Normal Summon')
    // Every step, to the end: the game's over.
    expect(first).toContain(`Step ${labelled[0].n}: ${labelled[0].label}`)
    expect(first).toContain(`Step ${labelled.at(-1)!.n}: ${labelled.at(-1)!.label}`)
    expect(first).toContain(`They're looking at step 5`)
    expect(first).toContain('They ask: What should I have done here?')
    expect(requests[0].tools.answer).toBeUndefined()
    // Both hands are open.
    expect(first).not.toContain('hidden')

    // Scrubbed back: the table there, and nothing retold.
    review.chat(id, 'And at the start?', 0)
    await review.idle(id)
    const second = requests[1].message
    expect(second).toContain("They're looking at the start, before step 1")
    expect(second).not.toContain('Good luck!')
    expect(second).not.toContain(`Step ${labelled.at(-1)!.n}: `)
    expect(requests[1].sessionId).toBe('review-session')
    expect(requests[1].tools.table()).toBe(requests[1].tools.table())
    expect(requests[1].tools.table()).toMatch(/^Turn 1:/)
    expect(sessions.get(id).review?.chat.map((e) => e.from)).toEqual(['you', 'claude', 'you', 'claude'])
    expect(sessions.get(id).review?.costUsd).toBeCloseTo(0.04)
  }, 60_000)

  it('closes and reopens with the chat kept, and starts over when cleared', async () => {
    const { requests, sessions, review, id } = await setup()
    review.start(id)
    review.chat(id, 'How did I lose?', 3)
    await review.idle(id)
    expect(requests[0].message).toContain('against a bot')
    expect(requests[0].message).not.toContain('The chat during the game')

    review.close(id)
    expect(sessions.get(id).review).toBeUndefined()
    review.start(id)
    expect(sessions.get(id).review?.chat).toHaveLength(2)

    await review.clear(id)
    expect(sessions.get(id).review?.chat).toEqual([])
    review.chat(id, 'Again?', 3)
    await review.idle(id)
    expect(requests[1].sessionId).toBeUndefined()
    expect(requests[1].message).toContain('The steps (position n is the table after step n)')
  }, 60_000)

  it("won't review a game that's still going", async () => {
    const sessions = new SessionService(ctx)
    const games = new GameService(sessions, ctx)
    const review = new ReviewService({ sessions, db: () => ctx().db, agent: () => ({ events: (async function* () {})(), interrupt: async () => {} }), system: () => '' })
    const { id } = await games.create({ deck: 'chazz-armed-ojama', seed: 1 })
    expect(() => review.start(id)).toThrow(/until the game is over/)
    expect(() => review.chat(id, 'hi', 0)).toThrow(/start one first/)
  }, 60_000)

  it('is served over HTTP and carried in the session', async () => {
    const { sessions, games, review, id } = await setup()
    const account = async () => ({ email: 'me@example.com' })
    const app = createApp({ sessions, ctx, games, claude: { service: {} as ClaudeService, account }, review })
    const res = await app.request(`/api/sessions/${id}/review`, { method: 'POST' })
    expect(res.status).toBe(200)
    const asked = await app.request(`/api/sessions/${id}/review/chat`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Why?', position: 2 }),
      headers: { 'content-type': 'application/json' },
    })
    expect(await asked.json()).toMatchObject({ chat: [{ from: 'you', text: 'Why?' }] })
    await review.idle(id)
    const got = (await (await app.request(`/api/sessions/${id}`)).json()) as { review: { chat: unknown[] } }
    expect(got.review.chat).toHaveLength(2)

    const without = createApp({ sessions, ctx, games, review })
    expect((await without.request(`/api/sessions/${id}/review`, { method: 'POST' })).status).toBe(501)
  }, 60_000)
})
