import { describe, expect, it } from 'vitest'
import { repoContext } from '../files'
import { GameService } from '../games'
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

  it('plays an example out in a hidden game, which goes with the chat', async () => {
    const sessions = new SessionService(ctx)
    const requests: AgentRequest[] = []
    const agent: Agent = (req) => {
      requests.push(req)
      async function* run() {
        yield { type: 'done' as const, costUsd: 0 }
      }
      return { events: run(), interrupt: async () => {} }
    }
    const home = new HomeService({ ctx, sessions, games: new GameService(sessions, ctx), agent, system: () => 'home' })
    const { id } = home.start('Show me how my deck opens')
    await home.idle(id)
    const { demo, answer, table } = requests[0].tools

    expect(await demo!({ title: 'Nope', deck: 'no-such-deck' })).toMatch(/no deck/)
    const first = await demo!({ title: 'An opening hand', deck: 'super-quant' })
    const shown = home.view(id).chat.at(-1)!.demo!
    expect(shown.title).toBe('An opening hand')
    expect(sessions.list().map((s) => s.id)).not.toContain(shown.session)
    expect(table!()).toContain('Hand')

    const question = Number(/Question (\d+)/.exec(first)![1])
    expect(await answer!(question + 1, [0])).toMatch(/isn't open/)
    expect(await answer!(question, [0], false, 'The first move.')).not.toMatch(/Not accepted/)
    expect(Object.values(home.view(id).chat.at(-1)!.demo!.captions ?? {})).toEqual(['The first move.'])

    await home.remove(id)
    expect(sessions.has(shown.session)).toBe(false)
  })

  it('lays an example out by hand, with cards that were never printed', async () => {
    const sessions = new SessionService(ctx)
    const requests: AgentRequest[] = []
    const agent: Agent = (req) => {
      requests.push(req)
      async function* run() {
        yield { type: 'done' as const, costUsd: 0 }
      }
      return { events: run(), interrupt: async () => {} }
    }
    const home = new HomeService({ ctx, sessions, agent, system: () => 'home' })
    const { id } = home.start('Show me an anime card')
    await home.idle(id)
    const { board } = requests[0].tools
    const custom = [{ name: 'Sword of the Example', text: 'Destroy 1 monster.', kind: 'spell' as const }]
    const setup = { p1: { hand: ['Sword of the Example'] }, p2: { monster: [{ name: 'Ojama Yellow', position: 'def' as const }] } }

    expect(await board!({ title: 'Nope', setup: { p1: { hand: ['Not A Card At All'] } }, moves: [{ label: 'x', do: [{ do: 'nextTurn' }] }] })).toMatch(/no such card/)
    expect(await board!({ title: 'Nope', custom, setup, moves: [{ label: 'Play it', do: [{ do: 'move', card: 'Ojama Green', to: 'gy' }] }] })).toMatch(/Move 1 \(Play it\): Ojama Green isn't on the table/)
    expect(sessions.list()).toEqual([])

    const shown = await board!({
      title: 'A made-up Spell',
      custom,
      setup,
      lp: { p2: 500 },
      moves: [
        { label: 'Activate Sword of the Example', say: 'It goes to the Spell & Trap Zone.', do: [{ do: 'move', card: 'Sword of the Example', to: 'spellTrap' }] },
        { label: 'Ojama Yellow is destroyed', do: [{ do: 'move', card: 'Ojama Yellow', to: 'gy' }, { do: 'move', card: 'Sword of the Example', to: 'gy' }, { do: 'lp', player: 'p2', delta: -500 }] },
      ],
    })
    expect(shown).toMatch(/^Shown, in 2 steps/)
    const demo = home.view(id).chat.at(-1)!.demo!
    const file = sessions.export(demo.session)
    expect(file.steps.map((s) => s.narration)).toEqual(['It goes to the Spell & Trap Zone.', undefined])
    const { state } = sessions.get(demo.session)
    expect(state.players.p2.lp).toBe(0)
    expect(state.players.p2.zones.gy).toHaveLength(1)
    expect(state.players.p1.zones.gy).toHaveLength(1)
    expect(sessions.list()).toEqual([])
  })
})
