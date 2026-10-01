import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardFace } from '../../src/view/boardView'
import { repoContext, ROOT } from '../files'
import { GameService } from '../games'
import { seededRng } from '../ocg/bot'
import { ocgDataDir } from '../ocg/lib'
import { SessionError, SessionService } from '../sessions'
import type { Agent, AgentEvent, AgentRequest } from './agent'
import { ClaudeService, memoryClaudeStore } from './service'
import { seenBy } from './view'

const hasData = existsSync(join(ROOT, ocgDataDir(), 'cards.cdb'))
const ctx = repoContext()

const lastQuestion = (text: string) => {
  const m = [...text.matchAll(/Question (\d+): .*\((pick one|pick (\d+)|pick (\d+) to (\d+))\)\n((?: {2}\d+\. .*\n?)*)/g)].at(-1)
  if (!m) return undefined
  const options = m[6].trim().split('\n').length
  const [min, max] = m[2] === 'pick one' ? [1, 1] : m[3] ? [+m[3], +m[3]] : [+m[4], +m[5]]
  return { id: +m[1], min, max: Math.min(max, options), options }
}

// Plays like the random bot, through the same tools and text Claude gets.
// Every message and tool result it's shown goes to onSeen as it arrives.
function fakeAgent(seed: number, onSeen: (text: string) => void = () => {}) {
  const rng = seededRng(seed)
  const requests: AgentRequest[] = []
  const agent: Agent = (req) => {
    requests.push(req)
    onSeen(req.message)
    async function* run(): AsyncIterable<AgentEvent> {
      let text = req.message
      yield { type: 'text', text: 'Hello from the fake.' }
      onSeen(req.tools.table())
      for (let tries = 0; tries < 400; tries++) {
        const q = lastQuestion(text)
        if (!q) break
        const n = q.min + Math.floor(rng() * (q.max - q.min + 1))
        const choices = [...Array(q.options).keys()].sort(() => rng() - 0.5).slice(0, n)
        const result = await req.tools.answer!(q.id, choices)
        onSeen(result)
        if (!result.startsWith('Not accepted')) text = result
      }
      yield { type: 'done', sessionId: 'fake-session', costUsd: 0.01 }
    }
    return { events: run(), interrupt: async () => {} }
  }
  return { agent, requests }
}

const setup = (agent: Agent, store = memoryClaudeStore()) => {
  const sessions = new SessionService(ctx)
  const games = new GameService(sessions, ctx)
  const claude = new ClaudeService({ games, sessions, db: () => ctx().db, agent, system: ({ coach, character, lesson, watch }) => (lesson ? 'lesson' : watch ? 'beside' : [coach ? 'coach' : 'play', character?.name].filter(Boolean).join(' as ')), store })
  return { sessions, games, claude }
}

describe.skipIf(!hasData)('Claude as a player', () => {
  it.each([1, 2])(
    'seed %i: plays a whole game through its tools, seeing only its side',
    async (seed) => {
      // Text shown before the check exists (at the very start) waits for it.
      const early: string[] = []
      let inspect: (text: string) => void = (text) => void early.push(text)
      const fake = fakeAgent(seed, (text) => inspect(text))
      const { sessions, games, claude } = setup(fake.agent)
      const db = ctx().db
      let v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed, claude: 'p2', model: 'sonnet' })
      const id = v.id
      const rng = seededRng(seed * 13)
      const leaks: string[] = []
      const allIids = Object.keys(v.state.cards)
      // Checked against the board as it is when Claude is shown the text.
      const check = (raw: string) => {
        const state = games['games'].get(id)!.game.state
        const visible = new Set<string>()
        const hidden = new Set<string>()
        // Claude knows its own decklist; the person's hidden cards are the secret.
        for (const iid of Object.keys(state.cards))
          (seenBy(state, iid, 'p2', db) || state.cards[iid].owner === 'p2' ? visible : hidden).add(cardFace(state, iid, db).name)
        const secret = [...hidden].filter((n) => !visible.has(n))
        // Card texts name other cards ("Special Summoned by X"); those aren't leaks.
        const descs = [...new Set(Object.keys(state.cards).map((iid) => cardFace(state, iid, db).name))].flatMap((n) => db.byName(n)?.desc ?? [])
        const text = descs.reduce((t, d) => t.split(d).join(''), raw)
        for (const n of secret) if (text.includes(n)) leaks.push(`${n} in: ${text}`)
        for (const iid of allIids) if (text.includes(iid)) leaks.push(`${iid} in: ${text}`)
      }
      inspect = check
      early.splice(0).forEach(check)
      for (let i = 0; i < 1500; i++) {
        await claude.idle(id)
        v = sessions.get(id)
        if (v.game?.winner) break
        const p = v.game?.prompt
        if (!p) {
          await new Promise((r) => setTimeout(r, 5))
          continue
        }
        expect(p.player).toBe('p1')
        const n = p.min + Math.floor(rng() * (Math.min(p.max, p.options.length) - p.min + 1))
        const choices = [...p.options.keys()].sort(() => rng() - 0.5).slice(0, n)
        try {
          await games.answer(id, 'p1', { id: p.id, choices })
        } catch (e) {
          if (!(e instanceof SessionError) || e.status !== 422) throw e
        }
      }
      expect(v.game?.winner).toBeDefined()
      expect(leaks).toEqual([])
      const c = v.game?.claude
      expect(c).toMatchObject({ player: 'p2', model: 'sonnet', coach: true, status: 'idle' })
      expect(c!.chat.some((e) => e.from === 'move')).toBe(true)
      expect(c!.costUsd).toBeGreaterThan(0)
      expect(fake.requests.at(-1)?.sessionId).toBe('fake-session')
      expect(fake.requests.every((r) => r.system === 'coach' && r.model === 'sonnet')).toBe(true)
    },
    120_000,
  )

  it('stops on an error, and tries again with what you said when resumed', async () => {
    const fake = fakeAgent(1)
    let failing = true
    const requests: AgentRequest[] = []
    const agent: Agent = (req) => {
      requests.push(req)
      if (!failing) return fake.agent(req)
      async function* run(): AsyncIterable<AgentEvent> {
        yield { type: 'done', costUsd: 0, error: 'API Error: 529 Overloaded' }
      }
      return { events: run(), interrupt: async () => {} }
    }
    const { sessions, games, claude } = setup(agent)
    const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 1, claude: 'p2' })
    await claude.idle(v.id)
    claude.chat(v.id, 'good luck!')
    await claude.idle(v.id)
    const c = sessions.get(v.id).game!.claude!
    expect(requests).toHaveLength(1)
    expect(c.status).toBe('stopped')
    expect(c.chat.at(-1)).toMatchObject({ from: 'note', text: 'Claude stopped with an error: API Error: 529 Overloaded' })

    failing = false
    claude.resume(v.id)
    await claude.idle(v.id)
    expect(requests.at(-1)!.message).toContain('Your opponent says: good luck!')
    expect(sessions.get(v.id).game!.claude!.status).toBe('idle')
  })

  it('replies to chat, and the browser never sees its question', async () => {
    const fake = fakeAgent(1)
    const { sessions, games, claude } = setup(fake.agent)
    // Claude goes second: the person's first question is open.
    const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 1, claude: 'p2' })
    await claude.idle(v.id)
    claude.chat(v.id, 'good luck!')
    await claude.idle(v.id)
    const last = fake.requests.at(-1)!
    expect(last.message).toContain('Your opponent says: good luck!')
    const chat = sessions.get(v.id).game!.claude!.chat
    expect(chat.slice(-2)).toMatchObject([
      { from: 'you', text: 'good luck!' },
      { from: 'claude', text: 'Hello from the fake.' },
    ])
    expect(chat.at(-1)!.at).toBeGreaterThan(0)
    expect(sessions.get(v.id).game?.prompt?.player ?? 'p1').toBe('p1')
    // Talking while they have a decision shows Claude their question, like a hint.
    expect(last.message).toContain('showing you their hidden cards')
    expect(last.message).toMatch(/Your opponent is being asked/)

    // Shown the person's cards, Claude gets their side and their question.
    claude.settings(v.id, { share: true })
    claude.chat(v.id, 'what should I do?')
    await claude.idle(v.id)
    const shared = fake.requests.at(-1)!.message
    const hand = sessions.get(v.id).state.players.p1.zones.hand.map((iid) => cardFace(sessions.get(v.id).state, iid, ctx().db).name)
    expect(shared).toContain('showing you their hidden cards')
    for (const n of hand) expect(shared).toContain(n)
    expect(shared).toMatch(/Your opponent is being asked/)
    // Each card's text is given once.
    expect(fake.requests[0].message).toContain('Card texts')
    expect(shared.match(/Card texts/g)?.length ?? 0).toBeLessThanOrEqual(1)
  }, 60_000)

  it('sits beside you against a bot: sees your side, answers nothing, and tries a line on a copy', async () => {
    const requests: AgentRequest[] = []
    const seen: Record<string, string> = {}
    const agent: Agent = (req) => {
      requests.push(req)
      async function* run(): AsyncIterable<AgentEvent> {
        const { tools } = req
        seen.options = await tools.options!()
        const end = /(\d+)\. End turn/.exec(seen.options)
        seen.line = await tools.tryLine!([[Number(end![1])]])
        seen.mine = tools.deck!('yours')
        seen.theirs = tools.deck!('opponent')
        seen.history = tools.history!()
        seen.lethal = tools.lethal!()
        seen.odds = tools.odds!(['Ojama Yellow'], 5, 'opening')
        seen.search = await tools.searchCards!('ojama yellow')
        seen.flag = tools.flag!('mistake', 'Passed with plays left')
        yield { type: 'text', text: 'Set a monster and pass.' }
        yield { type: 'done', sessionId: 'fake-session', costUsd: 0.01 }
      }
      return { events: run(), interrupt: async () => {} }
    }
    const store = memoryClaudeStore()
    const { sessions, games, claude } = setup(agent, store)
    const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 1, watch: true })
    expect(v.game).toMatchObject({ bots: ['p2'], bot: 'random', waitingFor: 'p1', claude: { player: 'p1', watch: true, knowsDeck: true, chat: [] } })
    // Nothing runs until you ask, and your question stays yours.
    await claude.idle(v.id)
    expect(requests).toHaveLength(0)
    expect(v.game?.prompt?.player).toBe('p1')
    const answers = sessions.export(v.id).duel!.responses.length

    claude.chat(v.id, 'What do I do?')
    await claude.idle(v.id)
    const [req] = requests
    expect(req.system).toBe('beside')
    expect(req.tools.answer).toBeUndefined()
    expect(req.message).toContain('The person says: What do I do?')
    expect(req.message).toMatch(/The person is being asked .*: "Your move"/)
    // Their hand by name; the bot's stays hidden.
    const hand = sessions.get(v.id).state.players.p1.zones.hand.map((iid) => cardFace(sessions.get(v.id).state, iid, ctx().db).name)
    for (const name of hand) expect(req.message).toContain(name)
    expect(req.message).toMatch(/Your opponent's side: 8000 LP\n {2}Hand \(5\): 5 hidden/)

    expect(seen.options).toContain('The person is being asked: "Your move"')
    expect(seen.line).toContain('- Turn 2')
    expect(seen.line).toContain("It stops here: the next decision is the bot's.")
    expect(seen.line).toContain('Nothing was played in the real game.')
    expect(sessions.export(v.id).duel!.responses).toHaveLength(answers)
    expect(seen.mine).toMatch(/^Your deck: .*\nMain Deck \(\d+\): .*\nExtra Deck .*\nStill in the Deck \(35/)
    expect(seen.theirs).toMatch(/^Your opponent's deck: .*\nMain Deck .*\nExtra Deck .*\nNot seen yet/)
    expect(sessions.get(v.id).game?.claude?.chat.map((e) => e.from)).toEqual(['you', 'claude'])
    expect(seen.lethal).toContain('Their LP: 8000. Your attackers: none')
    expect(seen.odds).toMatch(/1 of the 40 cards in the Main Deck are Ojama Yellow\. At least one in 5 draws: 12\.5%/)
    expect(seen.search).toContain('- Ojama Yellow (')
    expect(claude.played(v.id)?.flags).toMatchObject([{ kind: 'mistake', player: 'p1' }])

    // Without the bot's decklist, only what's on show.
    claude.settings(v.id, { knowsDeck: false })
    claude.chat(v.id, 'And now?')
    await claude.idle(v.id)
    expect(seen.theirs).toContain("You haven't been given your opponent's decklist.")
    expect(requests[1].sessionId).toBe('fake-session')

    // After a restart it is still beside you, not playing your side.
    const again = new ClaudeService({ games, sessions, db: () => ctx().db, agent, system: () => 'beside', store })
    expect(again.played(v.id)).toMatchObject({ player: 'p1', watch: true })
    expect(sessions.get(v.id).game).toMatchObject({ claude: { watch: true, knowsDeck: false }, prompt: { player: 'p1' } })
  }, 60_000)

  it("plays as its deck's character", async () => {
    const fake = fakeAgent(1)
    const { sessions, games, claude } = setup(fake.agent)
    const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'kaiba-blue-eyes', seed: 1, claude: 'p2', coach: false })
    await claude.idle(v.id)
    claude.chat(v.id, 'hi')
    await claude.idle(v.id)
    expect(sessions.get(v.id).players.p2.name).toBe('Seto Kaiba')
    expect(fake.requests.at(-1)!.system).toBe('play as Seto Kaiba')
  }, 60_000)

  it('stops mid-run, and a question left unanswered gets a default pick', async () => {
    let interrupted = 0
    let release = () => {}
    const quiet: Agent = () => ({
      events: (async function* () {
        await new Promise<void>((r) => (release = r))
        yield { type: 'done', costUsd: 0 } as AgentEvent
      })(),
      interrupt: async () => {
        interrupted++
        release()
      },
    })
    const { sessions, games, claude } = setup(quiet)
    // Claude as p1, which moves first.
    const v = await games.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', seed: 2, claude: 'p1' })
    await new Promise((r) => setTimeout(r, 20))
    expect(sessions.get(v.id).game?.claude?.status).toBe('thinking')
    await claude.stop(v.id)
    await claude.idle(v.id)
    expect(interrupted).toBe(1)
    expect(sessions.get(v.id).game?.claude?.status).toBe('stopped')

    // Resumed, it ignores the question twice more, then the first option is taken.
    const asked = (await games.asking(v.id, 'p1'))!.id
    claude.resume(v.id)
    const noted = () => sessions.get(v.id).game!.claude!.chat.some((e) => e.from === 'note')
    for (let i = 0; i < 50 && !noted(); i++) {
      await new Promise((r) => setTimeout(r, 20))
      release()
    }
    await claude.stop(v.id)
    await claude.idle(v.id)
    expect(sessions.get(v.id).game!.claude!.chat.some((e) => e.from === 'note' && e.text.includes(`question ${asked}`))).toBe(true)
    expect((await games.asking(v.id, 'p1'))?.id).not.toBe(asked)
  }, 60_000)

  it('runs a lesson a move at a time: sets up, waits for Next, plays, hands you p1, then asks you something', async () => {
    const results: string[] = []
    const batched: string[] = []
    const requests: AgentRequest[] = []
    const plans: string[] = []
    const lessonAgent: Agent = (req) => {
      requests.push(req)
      async function* run(): AsyncIterable<AgentEvent> {
        if (requests.length === 1) {
          plans.push(req.tools.plan!(), req.tools.plan!(['Summoning it', 'What it brings out']), req.tools.plan!(), req.tools.plan!())
          results.push(
            await req.tools.setup!(
              {
                p1: { hand: ['Goblindbergh', 'Gagaga Magician', 'Dark Magician'] },
                p2: { monster: [null, null, { name: 'Dark Magician', position: 'def', faceUp: false }] },
              },
              { p2: 4000 },
            ),
          )
          // Playing on straight after a setup waits.
          results.push(await req.tools.answer!(0, [0]))
          yield { type: 'text', text: 'Here is the position.' }
        } else if (requests.length === 2) {
          // Normal Summon Goblindbergh, then give p1 to the person.
          const summon = /Question (\d+):[^]*?\n {2}(\d+)\. Goblindbergh: Normal Summon/.exec(req.message)!
          results.push(await req.tools.answer!(+summon[1], [+summon[2]]))
          results.push(await req.tools.handOver!('p1', 'answer'))
          yield { type: 'text', text: 'Your go.' }
        } else if (requests.length === 3) {
          results.push(req.tools.ask!('What does Goblindbergh summon?', ['A Level 4 or lower monster', 'Anything']))
          results.push(await req.tools.answer!(0, [0]))
          yield { type: 'text', text: 'Nice.' }
        } else if (requests.length === 6) {
          // A few routine moves in a batch, without stopping.
          let last = req.message
          for (let i = 0; i < 3; i++) {
            const q = /Question (\d+):/.exec(last)
            if (!q) break
            last = await req.tools.answer!(+q[1], [0], true)
            batched.push(last)
          }
          yield { type: 'text', text: 'Those were routine.' }
        } else yield { type: 'text', text: 'Right.' }
        yield { type: 'done', sessionId: 'fake-lesson', costUsd: 0.01 }
      }
      return { events: run(), interrupt: async () => {} }
    }
    const { sessions, games, claude } = setup(lessonAgent)
    const v = await games.create({ deck: 'yuma-utopia', opponentDeck: 'yugi-dark-magician', lesson: true, topic: 'Teach me Goblindbergh', seed: 1 })
    // A lesson prompt is answered once the steps before it have shown.
    const shown = async () => {
      while (sessions.get(v.id).lesson.queued) await new Promise((r) => setTimeout(r, 20))
    }
    await claude.idle(v.id)
    expect(requests[0].system).toBe('lesson')
    // The plan is kept in view, on the point Claude has reached.
    expect(plans).toEqual([
      'There is no plan yet: give its points first.',
      'The person sees: 1 of 2, Summoning it.',
      'The person sees: 2 of 2, What it brings out.',
      'The plan is done: wrap up with two or three takeaways.',
    ])
    expect(sessions.get(v.id).game?.claude?.plan).toEqual({ points: ['Summoning it', 'What it brings out'], now: 2 })
    expect(requests[0].message).toContain('The person says: Teach me Goblindbergh')
    expect(results[0]).toMatch(/^Set up\./)
    expect(results[0]).toContain('For p1')
    expect(results[1]).toMatch(/^Wait:/)

    // Started over from the position: a card the deck lacks was added for it.
    let s = sessions.get(v.id)
    expect(s.state.players.p1.zones.hand.map((i) => s.state.cards[i].cardId)).toContain(ctx().db.byName('Dark Magician')!.id)
    expect(s.state.players.p2.lp).toBe(4000)
    expect(s.file.players?.p1.cards).toEqual(['Dark Magician'])
    // It stopped to explain. p1 is Claude's until it hands it over, so the person isn't asked.
    expect(requests.length).toBe(1)
    expect(s.lesson.prompt).toMatchObject({ type: 'ack', button: 'Next' })
    expect(s.game?.prompt).toBeUndefined()

    await shown()
    sessions.answer(v.id, { id: s.lesson.prompt!.id })
    await claude.idle(v.id)
    expect(requests[1].message).toContain('The person pressed Next')
    expect(results[2]).toContain('Wait:')
    s = sessions.get(v.id)
    // Goblindbergh's trigger may ask p1 more, but the person is asked now.
    expect(s.game?.claude?.holds).toEqual(['p2'])
    expect(s.game?.prompt?.player).toBe('p1')
    expect(s.lesson.prompt).toBeUndefined()
    expect(s.game?.claude?.chat.map((e) => e.text)).toContain("Your go: you're playing You for one question.")

    await games.answer(v.id, undefined, { id: s.game!.prompt!.id, choices: [0] })
    await claude.idle(v.id)
    s = sessions.get(v.id)
    expect(s.game?.claude?.holds).toEqual(['p2', 'p1'])
    expect(requests.length).toBe(3)
    expect(requests[2].message).toContain('Since you last looked')
    // It asked something, so it waits for the answer rather than a Next.
    expect(results.at(-1)).toMatch(/^Wait:/)
    expect(s.lesson.prompt).toMatchObject({ type: 'choice', message: 'What does Goblindbergh summon?' })

    await shown()
    sessions.answer(v.id, { id: s.lesson.prompt!.id, choice: 0 })
    await claude.idle(v.id)
    expect(requests.length).toBe(4)
    expect(requests[3].message).toContain('The person answered your question "What does Goblindbergh summon?": A Level 4 or lower monster')
    // Its question is still open, so it gets a Next again, and chatting withdraws it.
    s = sessions.get(v.id)
    expect(s.lesson.prompt).toMatchObject({ type: 'ack' })
    claude.chat(v.id, 'Why Goblindbergh?')
    expect(sessions.get(v.id).lesson.prompt).toBeUndefined()
    await claude.idle(v.id)
    expect(requests.length).toBe(5)

    claude.chat(v.id, 'Play on.')
    await claude.idle(v.id)
    expect(batched).toHaveLength(3)
    for (const r of batched) expect(r).not.toContain('Wait:')
  }, 60_000)

  it('lets you take back your own move in a lesson, and Claude can try a move on a copy first', async () => {
    const requests: AgentRequest[] = []
    const tried: string[] = []
    const agent: Agent = (req) => {
      requests.push(req)
      async function* run(): AsyncIterable<AgentEvent> {
        if (requests.length === 1) {
          tried.push(await req.tools.tryLine!([[0]]))
          await req.tools.handOver!('p1', 'turn')
        }
        yield { type: 'text', text: 'Right.' }
        yield { type: 'done', sessionId: 'fake-lesson', costUsd: 0.01 }
      }
      return { events: run(), interrupt: async () => {} }
    }
    const { sessions, games, claude } = setup(agent)
    const v = await games.create({ deck: 'yuma-utopia', opponentDeck: 'yugi-dark-magician', lesson: true, topic: 'Anything', seed: 1 })
    await claude.idle(v.id)
    let s = sessions.get(v.id)
    const steps = s.steps
    // Trying a move played nothing, and there's no move of yours to take back yet.
    expect(tried[0]).toContain('Nothing was played in the real game')
    expect(s.game?.undos).toBeUndefined()

    const open = s.game!.prompt!
    await games.answer(v.id, undefined, { id: open.id, choices: [0] })
    await claude.idle(v.id)
    s = sessions.get(v.id)
    expect(s.game?.undos).toBeGreaterThan(0)
    await games.undo(v.id)
    await claude.idle(v.id)
    s = sessions.get(v.id)
    expect(s.steps).toBe(steps)
    expect(s.game?.prompt?.options.map((o) => o.label)).toEqual(open.options.map((o) => o.label))
    expect(requests.at(-1)!.message).toContain('took back their last move')
  }, 60_000)

})
