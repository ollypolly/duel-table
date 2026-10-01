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

// Replies with a fixed line, keeping what it was sent. On its first look it
// marks two moments, and tries one past the end.
async function setup(played?: { player: 'p2'; chat: ChatEntry[] }) {
  const requests: AgentRequest[] = []
  const marked: string[] = []
  const agent: Agent = (req) => {
    requests.push(req)
    async function* run() {
      if (req.message.includes('find its key moments')) {
        marked.push(req.tools.mark!({ step: 4, kind: 'blunder', player: 'p1', title: 'Set into nothing' }))
        marked.push(req.tools.mark!({ step: 2, kind: 'good', player: 'p2', title: 'Opened well' }))
        marked.push(req.tools.mark!({ step: 99999, kind: 'good', player: 'p2', title: 'Too far' }))
      }
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
  return { requests, marked, sessions, games, review, id }
}

describe.skipIf(!hasData)('reviewing a game with Claude', () => {
  it('starts by marking the key moments, with the whole game and its chat, then tells Claude only what you are looking at', async () => {
    const chat: ChatEntry[] = [
      { from: 'you', text: 'Good luck!' },
      { from: 'move', text: 'Normal Summon' },
    ]
    const { requests, marked, sessions, review, id } = await setup({ player: 'p2', chat })
    const { steps } = sessions.export(id)
    const labelled = steps.flatMap((s, i) => (s.label ? [{ n: i + 1, label: s.label }] : []))

    review.start(id)
    expect(sessions.get(id).review).toMatchObject({ status: 'thinking', chat: [], scanned: false })
    await review.idle(id)
    const first = requests[0].message
    expect(first).toContain('find its key moments')
    expect(first).toContain('The table at the end')
    expect(marked).toEqual(['Marked step 4.', 'Marked step 2.', `There are only ${steps.length} steps.`])
    expect(sessions.get(id).review).toMatchObject({
      status: 'idle',
      scanned: true,
      moments: [{ step: 2, kind: 'good' }, { step: 4, kind: 'blunder' }],
      chat: [{ from: 'claude', text: 'You could have attacked first.' }],
    })
    expect(requests[0].tools.tableAt!(0)).toMatch(/^Turn 1:/)

    // Reopened, it doesn't look again.
    review.close(id)
    review.start(id)
    await review.idle(id)
    expect(requests).toHaveLength(1)

    review.chat(id, 'What should I have done here?', 5)
    await review.idle(id)
    const asked = requests[1].message
    expect(first).toContain('You played p2 against the person.')
    expect(first).toMatch(/won, on turn \d+/)
    expect(first).toContain('The person: Good luck!')
    expect(first).toContain('Claude played: Normal Summon')
    // Every step, to the end: the game's over.
    expect(first).toContain(`Step ${labelled[0].n}: ${labelled[0].label}`)
    expect(first).toContain(`Step ${labelled.at(-1)!.n}: ${labelled.at(-1)!.label}`)
    expect(requests[0].tools.answer).toBeUndefined()
    // Both hands are open.
    expect(first).not.toContain('hidden')
    expect(asked).toContain(`They're looking at step 5`)
    expect(asked).toContain('They ask: What should I have done here?')
    expect(asked).not.toContain('Good luck!')

    // Scrubbed back: the table there, and nothing retold.
    review.chat(id, 'And at the start?', 0)
    await review.idle(id)
    const second = requests[2].message
    expect(second).toContain("They're looking at the start, before step 1")
    expect(second).not.toContain(`Step ${labelled.at(-1)!.n}: `)
    expect(requests[2].sessionId).toBe('review-session')
    expect(requests[2].tools.table()).toBe(requests[2].tools.table())
    expect(requests[2].tools.table()).toMatch(/^Turn 1:/)

    // Taken through a moment, from just before it.
    review.moment(id, 4)
    await review.idle(id)
    expect(requests[3].message).toContain("They've gone to the moment you marked at step 4, a blunder by p1")
    expect(requests[3].message).toContain(`They're looking at step 3`)
    // The note and Claude's replies carry the moment, so the app can find them again.
    expect(sessions.get(id).review!.chat.filter((e) => e.moment === 4).map((e) => e.from)).toEqual(['note', 'claude'])
    expect(() => review.moment(id, 3)).toThrow(/didn't mark step 3/)
    expect(sessions.get(id).review?.chat.map((e) => e.from)).toEqual(['claude', 'you', 'claude', 'you', 'claude', 'note', 'claude'])
    expect(sessions.get(id).review?.costUsd).toBeCloseTo(0.08)
  }, 60_000)

  it('closes and reopens with the chat kept, and starts over when cleared', async () => {
    const { requests, sessions, review, id } = await setup()
    review.start(id)
    await review.idle(id)
    review.chat(id, 'How did I lose?', 3)
    await review.idle(id)
    expect(requests[0].message).toContain('against a bot')
    expect(requests[0].message).not.toContain('The chat during the game')

    review.close(id)
    expect(sessions.get(id).review).toBeUndefined()
    review.start(id)
    expect(sessions.get(id).review?.chat).toHaveLength(3)

    // Cleared, it looks through the game afresh.
    await review.clear(id)
    await review.idle(id)
    expect(sessions.get(id).review?.chat.map((e) => e.from)).toEqual(['claude'])
    expect(requests[2].sessionId).toBeUndefined()
    expect(requests[2].message).toContain('find its key moments')
    expect(requests[2].message).toContain('The steps (position n is the table after step n)')
    expect(sessions.get(id).review?.moments).toHaveLength(2)
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
    await review.idle(id)
    const asked = await app.request(`/api/sessions/${id}/review/chat`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Why?', position: 2 }),
      headers: { 'content-type': 'application/json' },
    })
    expect(await asked.json()).toMatchObject({ chat: [{ from: 'claude' }, { from: 'you', text: 'Why?' }] })
    await review.idle(id)
    const led = await app.request(`/api/sessions/${id}/review/moment`, {
      method: 'POST',
      body: JSON.stringify({ step: 2 }),
      headers: { 'content-type': 'application/json' },
    })
    expect(led.status).toBe(200)
    await review.idle(id)
    const got = (await (await app.request(`/api/sessions/${id}`)).json()) as { review: { chat: unknown[]; moments: unknown[] } }
    // The first look, the question, and the moment.
    expect(got.review.chat).toHaveLength(5)
    expect(got.review.moments).toHaveLength(2)

    const without = createApp({ sessions, ctx, games, review })
    expect((await without.request(`/api/sessions/${id}/review`, { method: 'POST' })).status).toBe(501)
  }, 60_000)
})
