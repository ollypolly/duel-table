import { describe, expect, it } from 'vitest'
import { repoContext } from '../files'
import { SessionService } from '../sessions'
import type { Agent, AgentRequest } from './agent'
import { HomeService } from './home'

const ctx = repoContext()

// Replies with a fixed line, keeping what it was sent.
function setup() {
  const requests: AgentRequest[] = []
  const saved: string[] = []
  const agent: Agent = (req) => {
    requests.push(req)
    async function* run() {
      yield { type: 'text' as const, text: 'Try Blue-Eyes.' }
      yield { type: 'done' as const, sessionId: 'home-session', costUsd: 0.01 }
    }
    return { events: run(), interrupt: async () => {} }
  }
  const home = new HomeService({
    ctx,
    sessions: new SessionService(ctx),
    agent,
    system: () => 'home',
    notes: (deck) => (deck === 'super-quant' ? '- Keep Magnus for last' : ''),
    saveDeck: async (id) => {
      saved.push(id)
      return id
    },
  })
  return { requests, home, saved }
}

describe('Claude on the home page', () => {
  it('starts a chat named after the first message, with your decks in it', async () => {
    const { requests, home } = setup()
    const { id, title } = home.start('What deck should I learn next?')
    await home.idle(id)
    expect(title).toBe('What deck should I learn next?')
    expect(requests[0].message).toContain('- super-quant: ')
    expect(requests[0].message).toContain('What deck should I learn next?')
    expect(requests[0].model).toBe('haiku')

    home.ask(id, 'Why?')
    await home.idle(id)
    expect(requests[1].message).toBe('Why?')
    expect(requests[1].sessionId).toBe('home-session')
    expect(home.view(id).chat.map((e) => e.from)).toEqual(['you', 'claude', 'you', 'claude'])
  })

  it('keeps chats apart, newest first, and deletes one', async () => {
    const { requests, home } = setup()
    const a = home.start('First')
    await home.idle(a.id)
    const b = home.start('Second', 'sonnet')
    await home.idle(b.id)
    expect(requests[1].sessionId).toBeUndefined()
    expect(requests[1].model).toBe('sonnet')
    expect(home.list().map((t) => t.title)).toEqual(['Second', 'First'])
    await home.remove(b.id)
    expect(home.list().map((t) => t.title)).toEqual(['First'])
    expect(() => home.view(b.id)).toThrow(/no chat/)
  })

  it('reads a deck with your notes, works out odds from it, and saves a deck', async () => {
    const { requests, home, saved } = setup()
    const { id } = home.start('Hi')
    await home.idle(id)
    const { decks, odds, suggestDeck, table } = requests[0].tools
    expect(table).toBeUndefined()
    expect(decks!('super-quant')).toMatch(/Main Deck \(\d+\):[\s\S]*Keep Magnus for last/)
    expect(decks!('nope')).toContain('No deck')
    expect(odds!(['Super Quantum Red Layer'], 5, 'opening', 'super-quant')).toMatch(/At least one in 5 draws: \d/)
    expect(await suggestDeck!('My New Deck', [{ name: 'Super Quantum Red Layer', count: 3 }], [], 'to try')).toContain('Saved as my-new-deck')
    expect(saved).toEqual(['my-new-deck'])
    expect(home.view(id).chat.at(-1)).toMatchObject({ from: 'note' })
  })
})
