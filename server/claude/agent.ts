// Claude as a player, behind a small interface so tests can swap in a fake.
// The real one is the Claude Agent SDK with the owner's Claude Code login:
// no built-in tools, no settings or CLAUDE.md from disk, only our duel tools.
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ModelChoice } from '../../src/api/game'
import { MomentSchema, type Moment } from '../../src/api/review'
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
  // In a game: a decklist, and what has happened so far.
  deck?(side: 'yours' | 'opponent'): string
  history?(last?: number): string
  // A coach beside the person: their open question, and a line of theirs tried on a copy of the game.
  options?(): Promise<string>
  tryLine?(picks: number[][]): Promise<string>
  lethal?(): string
  odds?(cards: string[], draws?: number, from?: 'deck' | 'opening'): string
  searchCards?(query: string): string
  rules?(topic?: string): string
  point?(cards: string[]): string
  offerTakeBack?(why: string): string
  flag?(kind: Moment['kind'], title: string): string
  note?(text: string): string
  suggestDeck?(name: string, main: Entry[], extra: Entry[], why: string): string
  botMove?(): string
  evaluate?(): Promise<string>
  setup?(setup: Setup, lp?: Partial<Record<Player, number>>): Promise<string>
  handOver?(player: Player, until: Handover['until']): Promise<string>
  takeBack?(player: Player): string
  ask?(question: string, options?: string[]): string
  // Reviewing a finished game: the table after any step, and marking key moments.
  tableAt?(step: number): string
  mark?(moment: Moment): string
}

type Entry = { name: string; count: number }

export type AgentEvent =
  { type: 'text'; text: string } | { type: 'tool'; name: string; input: unknown } | { type: 'done'; sessionId?: string; costUsd: number; error?: string }

export type AgentRequest = { message: string; system: string; model: ModelChoice; sessionId?: string; tools: DuelTools }
export type AgentRun = { events: AsyncIterable<AgentEvent>; interrupt(): Promise<void> }
export type Agent = (req: AgentRequest) => AgentRun

// Tool calls per run: a turn with a long combo takes a few dozen.
const MAX_TURNS = 60

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export const sdkAgent: Agent = (req) => {
  const { answer, setup, handOver, takeBack, ask, tableAt, mark, deck, history, options, tryLine } = req.tools
  const t = req.tools
  const entries = z.array(z.object({ name: z.string(), count: z.int().min(1).max(3) }))
  // The coach's other tools, each there only when the service gives it.
  const coach = [
    t.lethal && tool('lethal', "The battle sums this turn: the person's attackers against the other side's monsters and LP. Stats only.", {}, async () => text(t.lethal!())),
    t.odds &&
      tool(
        'odds',
        "The chance of drawing at least one of the named cards: from what is left in the person's Deck in the next draws, or in an opening hand from the full list.",
        { cards: z.array(z.string()).min(1), draws: z.int().min(1).max(40).optional().describe('How many cards drawn (default 1 from the Deck, 5 for an opening hand)'), from: z.enum(['deck', 'opening']).optional() },
        async (i) => text(t.odds!(i.cards, i.draws, i.from)),
      ),
    t.searchCards && tool('searchCards', "Find cards by words in their name or text, among the cards this app has.", { query: z.string() }, async (i) => text(t.searchCards!(i.query))),
    t.rules && tool('rules', 'A short rules reference: with no topic, the list of topics; with one, that section.', { topic: z.string().optional() }, async (i) => text(t.rules!(i.topic))),
    t.point && tool('point', "Highlight cards on the person's screen by name while you explain (only ones they can see). An empty list clears it.", { cards: z.array(z.string()) }, async (i) => text(t.point!(i.cards))),
    t.offerTakeBack && tool('offerTakeBack', 'Suggest the person takes back their last move, with a one-line reason. They decide.', { why: z.string() }, async (i) => text(t.offerTakeBack!(i.why))),
    t.flag && tool('flag', 'Flag what just happened as a moment to come back to in the review after the game.', { kind: z.enum(['blunder', 'mistake', 'missed', 'good']), title: z.string().describe('One short line') }, async (i) => text(t.flag!(i.kind, i.title))),
    t.note && tool('note', "Save a short note to the person's notes on this deck (a rule of thumb, a card to cut). You are given the notes at the start of each game.", { text: z.string() }, async (i) => text(t.note!(i.text))),
    t.suggestDeck &&
      tool(
        'suggestDeck',
        'Save a changed decklist as a new deck beside the one being played, for the person to try. Give the whole list.',
        { name: z.string(), main: entries, extra: entries, why: z.string().describe('One or two lines on what changed and why') },
        async (i) => text(t.suggestDeck!(i.name, i.main, i.extra, i.why)),
      ),
    t.botMove && tool('botMove', "The trained bot's latest decision: how sure it was, and its own estimate of its chance to win.", {}, async () => text(t.botMove!())),
    t.evaluate && tool('evaluate', "The trained bot's estimate of the person's chance to win from here, as a second opinion. Only for decks it knows.", {}, async () => text(await t.evaluate!())),
  ].filter((x) => !!x)
  const COACH = ['lethal', 'odds', 'searchCards', 'rules', 'point', 'offerTakeBack', 'flag', 'note', 'suggestDeck', 'botMove', 'evaluate'] as const
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
      ...(deck && history
        ? [
            tool(
              'deck',
              "A decklist: yours with what is still in the Deck, or your opponent's if you have been given it (otherwise just their cards you can see).",
              { side: z.enum(['yours', 'opponent']) },
              async ({ side }) => text(deck(side)),
            ),
            tool('history', 'What has happened in the game so far, oldest first, numbered.', { last: z.int().min(1).optional().describe('How many of the latest events (default 40)') }, async ({ last }) =>
              text(history(last)),
            ),
          ]
        : []),
      ...(options && tryLine
        ? [
            tool('options', "The person's open question and its numbered options, as it stands now.", {}, async () => text(await options())),
            tool(
              'tryLine',
              "Play a line for the person on a copy of the game and see what the rules engine does with it, without touching the real game. Give the picks in order: the first answers their open question, the next the question that follows, and so on. Each pick is the option numbers chosen. The result shows what would happen, the table after it and the next question, so build a longer line by adding a pick and calling again.",
              { picks: z.array(z.array(z.int().min(0))).min(1).max(30) },
              async ({ picks }) => text(await tryLine(picks)),
            ),
          ]
        : []),
      ...coach,
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
      ...(tableAt && mark
        ? [
            tool('tableAt', 'The table after a step (0 for the start), with both sides open.', { step: z.int().min(0) }, async ({ step }) => text(tableAt(step))),
            tool(
              'mark',
              'Mark a key moment of the game: it shows on their timeline and in the list they step through. Marking a step again replaces it.',
              MomentSchema.shape,
              async (input) => text(mark(input)),
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
        ...(deck ? ['mcp__duel__deck', 'mcp__duel__history'] : []),
        ...(tryLine ? ['mcp__duel__options', 'mcp__duel__tryLine'] : []),
        ...COACH.filter((n) => t[n]).map((n) => `mcp__duel__${n}`),
        ...(setup ? ['mcp__duel__setup', 'mcp__duel__handOver', 'mcp__duel__takeBack', 'mcp__duel__ask'] : []),
        ...(mark ? ['mcp__duel__tableAt', 'mcp__duel__mark'] : []),
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
      // An API error arrives as an assistant message too; the result carries it.
      if (m.type === 'assistant' && !m.error) {
        for (const block of m.message.content) {
          if (block.type === 'text' && block.text.trim()) yield { type: 'text', text: block.text }
          if (block.type === 'tool_use') yield { type: 'tool', name: block.name.replace(/^mcp__duel__/, ''), input: block.input }
        }
      }
      if (m.type === 'result') {
        yield { type: 'done', sessionId, costUsd: m.total_cost_usd, ...(m.subtype !== 'success' ? { error: m.subtype } : m.is_error && { error: m.result }) }
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
