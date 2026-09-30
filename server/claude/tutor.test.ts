import { describe, expect, it } from 'vitest'
import { repoContext } from '../files'
import type { Agent, AgentRequest } from './agent'
import { TutorService } from './tutor'

const ctx = repoContext()
const LESSON = 'armed-ojama-links-vs-super-quant'
const steps = (ctx().scenarios[LESSON] as { steps: { label: string; narration: string }[] }).steps

// Replies with a fixed line, keeping what it was sent.
function setup() {
  const requests: AgentRequest[] = []
  const agent: Agent = (req) => {
    requests.push(req)
    async function* run() {
      yield { type: 'text' as const, text: 'Good question.' }
      yield { type: 'done' as const, sessionId: 'tutor-session', costUsd: 0.01 }
    }
    return { events: run(), interrupt: async () => {} }
  }
  return { requests, tutor: new TutorService({ ctx, agent, system: () => 'tutor' }) }
}

describe('Claude as a tutor', () => {
  it('reads the lesson up to your step and no further', async () => {
    const { requests, tutor } = setup()
    tutor.ask(LESSON, 3, 'Why Impermanence first?')
    await tutor.idle(LESSON)
    const first = requests[0].message
    expect(first).toContain(steps[0].label)
    expect(first).toContain(steps[2].narration)
    expect(first).not.toContain(steps[3].narration)
    expect(first).toContain('They ask: Why Impermanence first?')
    expect(requests[0].tools.answer).toBeUndefined()

    tutor.ask(LESSON, 5, 'And this?')
    await tutor.idle(LESSON)
    const second = requests[1].message
    expect(second).not.toContain(steps[2].narration)
    expect(second).toContain(steps[4].narration)
    expect(second).not.toContain(steps[5].narration)
    expect(requests[1].sessionId).toBe('tutor-session')
    expect(tutor.view(LESSON).chat.map((e) => e.from)).toEqual(['you', 'claude', 'you', 'claude'])
  })

  it('shows the table at your step, and starts over when cleared', async () => {
    const { requests, tutor } = setup()
    tutor.ask(LESSON, 1, 'What does Magnacarrier do?')
    await tutor.idle(LESSON)
    expect(requests[0].tools.table()).toContain('Super Quantal Mech Ship Magnacarrier')
    await tutor.clear(LESSON)
    expect(tutor.view(LESSON).chat).toEqual([])
    tutor.ask(LESSON, 1, 'Again?')
    await tutor.idle(LESSON)
    expect(requests[1].sessionId).toBeUndefined()
    expect(requests[1].message).toContain(steps[0].narration)
  })

  it("won't chat about a scenario that doesn't exist", () => {
    expect(() => setup().tutor.view('nope')).toThrow(/no scenario/)
  })
})
