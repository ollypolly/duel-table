// Claude as a player, behind a small interface so tests can swap in a fake.
// The real one is the Claude Agent SDK with the owner's Claude Code login:
// no built-in tools, no settings or CLAUDE.md from disk, only our duel tools.
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ModelChoice } from '../../src/api/game'
import type { Player } from '../../src/engine'
import { PlayerSchema, SetupSchema, type Setup } from '../../src/scenarios/schema'
import type { Handover } from './service'

export const MODELS: Record<ModelChoice, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' }

// What the tools do; the service implements them against the game. A tutor
// on a scripted lesson has nothing to answer, so no answer tool; a lesson
// Claude runs on the rules engine also sets up positions, hands players over
// and asks the person questions.
export type DuelTools = {
  table(): string
  answer?(question: number, choices: number[], batch?: boolean): Promise<string>
  card(name: string): string
  setup?(setup: Setup, lp?: Partial<Record<Player, number>>): Promise<string>
  handOver?(player: Player, until: Handover['until']): Promise<string>
  takeBack?(player: Player): string
  ask?(question: string, options?: string[]): string
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
  const { answer, setup, handOver, takeBack, ask } = req.tools
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
              {
                question: z.number().int().describe('The question number'),
                choices: z.array(z.number().int().min(0)).describe('Option numbers'),
                // Lessons stop after each move unless Claude batches it.
                ...(setup && {
                  batch: z
                    .boolean()
                    .optional()
                    .describe('Keep playing after this move instead of stopping for the person, for routine moves you will sum up together afterwards'),
                }),
              },
              async ({ question, choices, batch }) => text(await answer(question, choices, batch)),
            ),
          ]
        : []),
      tool('card', "A card's full text and stats, by name.", { name: z.string() }, async ({ name }) => text(req.tools.card(name))),
      ...(setup && handOver && takeBack && ask
        ? [
            tool(
              'setup',
              "Start the duel over from a position you choose, on p1's turn in Main Phase 1. Place cards by name, zone by zone, for each player; anything you don't place stays in their Deck, shuffled. A card a deck doesn't have (or not enough copies of) is added for this position.",
              {
                setup: SetupSchema.describe(
                  'Zones per player: hand, monster and spellTrap (5 slots, left to right; null for an empty slot), fieldSpell, gy, banished, deck (its top cards, top first), extraDeck. A monster can be { name, position: "atk" | "def", faceUp, materials }. extraMonster holds the two Extra Monster Zones, left to right.',
                ),
                lp: z.object({ p1: z.int().optional(), p2: z.int().optional() }).optional().describe('Life points, if not 8000'),
              },
              async (input) => text(await setup(input.setup, input.lp)),
            ),
            tool(
              'handOver',
              "Let the person play a player: until they've answered one question, until the end of this turn, or until you take it back.",
              { player: PlayerSchema, until: z.enum(['answer', 'turn', 'takeBack']) },
              async (input) => text(await handOver(input.player, input.until)),
            ),
            tool('takeBack', 'Play a player you handed over again.', { player: PlayerSchema }, async (input) => text(takeBack(input.player))),
            tool(
              'ask',
              'Ask the person a question to check they have followed: give options for multiple choice, or none for a written answer. Their answer comes as a message.',
              { question: z.string(), options: z.array(z.string()).max(6).optional() },
              async (input) => text(ask(input.question, input.options)),
            ),
          ]
        : []),
    ],
  })
  const q = query({
    prompt: req.message,
    options: {
      model: MODELS[req.model],
      systemPrompt: req.system,
      mcpServers: { duel: server },
      tools: [],
      allowedTools: [
        'mcp__duel__table',
        'mcp__duel__card',
        ...(answer ? ['mcp__duel__answer'] : []),
        ...(setup ? ['mcp__duel__setup', 'mcp__duel__handOver', 'mcp__duel__takeBack', 'mcp__duel__ask'] : []),
      ],
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
