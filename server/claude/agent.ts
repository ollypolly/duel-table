// Claude as a player, behind a small interface so tests can swap in a fake.
// The real one is the Claude Agent SDK with the owner's Claude Code login:
// no built-in tools, no settings or CLAUDE.md from disk, only our duel tools.
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ModelChoice } from '../../src/api/game'

export const MODELS: Record<ModelChoice, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' }

// What the tools do; the service implements them against the game. A lesson
// has nothing to answer, so no answer tool.
export type DuelTools = {
  table(): string
  answer?(question: number, choices: number[]): Promise<string>
  card(name: string): string
}

export type AgentEvent =
  { type: 'text'; text: string } | { type: 'tool'; name: string; input: unknown } | { type: 'done'; sessionId?: string; costUsd: number; error?: string }

export type AgentRequest = { message: string; system: string; model: ModelChoice; sessionId?: string; tools: DuelTools }
export type AgentRun = { events: AsyncIterable<AgentEvent>; interrupt(): Promise<void> }
export type Agent = (req: AgentRequest) => AgentRun

// Tool calls per run: a turn with a long combo takes a few dozen.
const MAX_TURNS = 60

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export const sdkAgent: Agent = (req) => {
  const answer = req.tools.answer
  const server = createSdkMcpServer({
    name: 'duel',
    version: '1.0.0',
    tools: [
      tool('table', 'The table as you see it now: life points, each zone, both GYs, the chain.', {}, async () => text(req.tools.table())),
      ...(answer
        ? [
            tool(
              'answer',
              'Answer the open question by the numbers of the options you pick. Returns what happened, and the next question if it is yours.',
              { question: z.number().int().describe('The question number'), choices: z.array(z.number().int().min(0)).describe('Option numbers') },
              async ({ question, choices }) => text(await answer(question, choices)),
            ),
          ]
        : []),
      tool('card', "A card's full text and stats, by name.", { name: z.string() }, async ({ name }) => text(req.tools.card(name))),
    ],
  })
  const q = query({
    prompt: req.message,
    options: {
      model: MODELS[req.model],
      systemPrompt: req.system,
      mcpServers: { duel: server },
      tools: [],
      allowedTools: ['mcp__duel__table', 'mcp__duel__card', ...(answer ? ['mcp__duel__answer'] : [])],
      settingSources: [],
      maxTurns: MAX_TURNS,
      ...(req.sessionId && { resume: req.sessionId }),
    },
  })
  return {
    events: translate(q),
    interrupt: () => q.interrupt().then(() => undefined),
  }
}

async function* translate(messages: AsyncIterable<SDKMessage>): AsyncIterable<AgentEvent> {
  let sessionId: string | undefined
  try {
    for await (const m of messages) {
      sessionId = m.session_id ?? sessionId
      if (m.type === 'assistant') {
        for (const block of m.message.content) {
          if (block.type === 'text' && block.text.trim()) yield { type: 'text', text: block.text }
          if (block.type === 'tool_use') yield { type: 'tool', name: block.name.replace(/^mcp__duel__/, ''), input: block.input }
        }
      }
      if (m.type === 'result') {
        yield { type: 'done', sessionId, costUsd: m.total_cost_usd, ...(m.subtype !== 'success' && { error: m.subtype }) }
        return
      }
    }
  } catch (e) {
    yield { type: 'done', sessionId, costUsd: 0, error: (e as Error).message }
  }
}

// Whether a Claude login is available, and whose. Starts the CLI without
// sending a prompt, so it costs nothing.
export type ClaudeAccount = { email?: string; plan?: string }

export async function claudeAccount(): Promise<ClaudeAccount | undefined> {
  // A prompt stream that never sends: the CLI starts up and waits.
  const idle: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
  const q = query({ prompt: idle, options: { tools: [], settingSources: [], persistSession: false } })
  try {
    const a = await q.accountInfo()
    if (a.apiProvider && a.apiProvider !== 'firstParty') return { plan: a.apiProvider }
    return a.email || a.apiKeySource ? { email: a.email, plan: a.subscriptionType } : undefined
  } catch {
    return undefined
  } finally {
    q.close()
  }
}
