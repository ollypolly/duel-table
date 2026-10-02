// Claude as a player, behind a small interface so tests can swap in a fake.
// The real one is the Claude Agent SDK with the owner's Claude Code login:
// no built-in tools, no settings or CLAUDE.md from disk, only our duel tools.
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ModelChoice } from '../../src/api/game'
import { MomentSchema, type Moment } from '../../src/api/review'
import type { Player, ZoneRef } from '../../src/engine'
import { BoardSchema, type Board } from './board'
import { PlayerSchema, SetupSchema, ZoneRefSchema, type Setup } from '../../src/scenarios/schema'
import type { Handover } from './service'

export const MODELS: Record<ModelChoice, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5-20251001' }

// What the tools do; the service implements them against the game. A tutor
// on a scripted lesson has nothing to answer, so no answer tool; a lesson
// Claude runs on the rules engine also sets up positions, hands players over
// and asks the person questions.
export type DuelTools = {
  table?(): string
  answer?(question: number, choices: number[], batch?: boolean, say?: string): Promise<string>
  card(name: string): string | Promise<string>
  // In a game: a decklist, and what has happened so far.
  deck?(side: 'yours' | 'opponent'): string
  history?(last?: number): string
  // A coach beside the person: their open question, and a line of theirs tried on a copy of the game.
  options?(): Promise<string>
  tryLine?(picks: number[][], show?: string): Promise<string>
  lethal?(): string
  odds?(cards: string[], draws?: number, from?: 'deck' | 'opening', deck?: string): string
  searchCards?(query: string): Promise<string>
  rules?(topic?: string): string
  point?(cards: string[], arrows?: { from: string; to: string }[], zones?: ZoneRef[]): string
  lookBack?(step?: number): string
  spotlight?(cards: string[], say?: string, phrases?: string[]): string
  offerTakeBack?(why: string): string
  flag?(kind: Moment['kind'], title: string): string
  note?(text: string): string
  suggestDeck?(name: string, main: Entry[], extra: Entry[], why: string): Promise<string>
  botMove?(): string
  evaluate?(): Promise<string>
  setup?(setup: Setup, lp?: Partial<Record<Player, number>>): Promise<string>
  handOver?(player: Player, until: Handover['until'], goal?: string): Promise<string>
  takeBack?(player: Player): string
  ask?(question: string, options?: string[], cards?: string[], correct?: number): string
  plan?(points?: string[], now?: number): string
  // Reviewing a finished game: the table after any step, and marking key moments.
  tableAt?(step: number): string
  mark?(moment: Moment): string
  goTo?(step: number): string
  // The chat on the home page: the person's decks and games, and starting a game for them.
  decks?(id?: string): string
  games?(): string
  startGame?(game: StartGame): Promise<string>
  startLesson?(lesson: StartLesson): Promise<string>
  startFreePlay?(table: StartFreePlay): string
  demo?(demo: DemoStart): Promise<string>
  board?(board: Board): Promise<string>
}

type Entry = { name: string; count: number }
const entries = z.array(z.object({ name: z.string(), count: z.int().min(1).max(3) }))
const brief = z.string().optional().describe('For the Claude in it, who has not seen this chat: what the person wants from it and what you two worked out, in a few lines. They see it too')
const StartGameSchema = z.object({
  deck: z.string().describe("The person's deck, by id"),
  opponentDeck: z.string().optional().describe('By id; the same deck if not given'),
  opponent: z.enum(['bot', 'trained', 'claude']).describe('bot: picks at random. trained: the trained bot, only with a deck it knows. claude: Claude plays and coaches'),
  brief,
})
export type StartGame = z.infer<typeof StartGameSchema>
const StartLessonSchema = z.object({
  deck: z.string().describe('The deck to teach, by id'),
  opponentDeck: z.string().optional().describe('By id; the same deck if not given'),
  topic: z.string().describe('What it should teach, as the person would ask for it'),
  brief,
})
export type StartLesson = z.infer<typeof StartLessonSchema>
const StartFreePlaySchema = z.object({ deck: z.string().describe("The person's deck, by id"), opponentDeck: z.string().optional().describe('By id; the same deck if not given') })
export type StartFreePlay = z.infer<typeof StartFreePlaySchema>
const side = z.union([z.string(), z.object({ name: z.string(), main: entries, extra: entries })])
const DemoSchema = z.object({
  title: z.string().describe('What the example shows, in a few words'),
  deck: side.describe("p1's deck: the id of one of the person's decks, or a list of your own"),
  opponentDeck: side.optional().describe("p2's deck; the same as p1's if not given"),
  setup: SetupSchema.optional().describe(
    'A position to start from, on p1\'s turn in Main Phase 1. Zones per player: hand, monster and spellTrap (5 slots, left to right; null for an empty slot), fieldSpell, gy, banished, deck (its top cards, top first), extraDeck. A monster can be { name, position: "atk" | "def", faceUp, materials }. Anything not placed stays in their Deck, shuffled; a card a deck doesn\'t have is added.',
  ),
  lp: z.object({ p1: z.int().min(1).optional(), p2: z.int().min(1).optional() }).optional().describe('Life points, with a setup (8000 each if not given)'),
  again: z.boolean().optional().describe('Your last example went wrong: take it out of the chat and show this one in its place'),
})
export type DemoStart = z.infer<typeof DemoSchema>

export type AgentEvent =
  { type: 'text'; text: string } | { type: 'tool'; name: string; input: unknown } | { type: 'done'; sessionId?: string; costUsd: number; error?: string }

export type AgentRequest = { message: string; system: string; model: ModelChoice; sessionId?: string; tools: DuelTools }
export type AgentRun = { events: AsyncIterable<AgentEvent>; interrupt(): Promise<void> }
export type Agent = (req: AgentRequest) => AgentRun

// Tool calls per run: a turn with a long combo takes a few dozen.
const MAX_TURNS = 60

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export const sdkAgent: Agent = (req) => {
  const { answer, setup, handOver, takeBack, ask, plan, tableAt, mark, goTo, deck, history, options, tryLine } = req.tools
  const t = req.tools
  // The coach's other tools, each there only when the service gives it.
  const coach = [
    t.lethal && tool('lethal', "The battle sums this turn: the person's attackers against the other side's monsters and LP. Stats only.", {}, async () => text(t.lethal!())),
    t.odds &&
      tool(
        'odds',
        "The chance of drawing at least one of the named cards: from what is left in the person's Deck in the next draws, or in an opening hand from the full list.",
        {
          cards: z.array(z.string()).min(1),
          draws: z.int().min(1).max(40).optional().describe('How many cards drawn (default 1 from the Deck, 5 for an opening hand)'),
          from: z.enum(['deck', 'opening']).optional(),
          ...(t.decks && { deck: z.string().describe('The deck, by id') }),
        },
        async (i) => text(t.odds!(i.cards, i.draws, i.from, i.deck)),
      ),
    t.searchCards && tool('searchCards', "Find cards by words in their name or text among the cards this app has, or by name among every card printed when it has none.", { query: z.string() }, async (i) => text(await t.searchCards!(i.query))),
    t.rules && tool('rules', 'A short rules reference: with no topic, the list of topics; with one, that section.', { topic: z.string().optional() }, async (i) => text(t.rules!(i.topic))),
    t.point &&
      tool(
        'point',
        "Mark up the table on the person's screen while you explain: highlight cards, draw arrows from one card to another (what attacks, targets or tributes what), and circle zones (where a card will go, the zone a Link arrow points to). Only cards they can see. Calls add up; with nothing, it clears. It all goes when they next answer or write.",
        {
          cards: z.array(z.string()).default([]).describe('Cards to highlight, by name'),
          arrows: z.array(z.object({ from: z.string(), to: z.string() })).max(4).optional().describe('Card names: an arrow from one to the other'),
          zones: z.array(ZoneRefSchema).max(6).optional().describe('Zones to circle: { player, zone, slot } (slots 0 to 4, in the order setup places them; extraMonster takes slot 0 or 1 and no player)'),
        },
        async (i) => text(t.point!(i.cards, i.arrows, i.zones)),
      ),
    t.lookBack &&
      tool(
        'lookBack',
        "Move the person's view back to the table as it was after an earlier step, to talk about a moment that has passed (\"this is where you could have chained\"). With no step, lists the steps and their numbers. Then point at what you mean. Their view returns to the present when they answer or play on.",
        { step: z.int().min(0).optional().describe('From the list; 0 is the starting position') },
        async (i) => text(t.lookBack!(i.step)),
      ),
    t.spotlight &&
      tool(
        'spotlight',
        "Lift one to three cards off the table and show them big in a panel beside it, text readable, with your line: for when the point is what a card says. It goes after they've had time to read it (they can keep it open), or when the game moves on. An empty list clears it.",
        {
          cards: z.array(z.string()).max(3).describe('By name: cards on the table, in a hand, GY or banished'),
          say: z.string().optional().describe('One or two short lines, shown with the cards'),
          phrases: z.array(z.string()).max(4).optional().describe("The few words of the cards' text that matter, exactly as printed: each is marked on whichever card has it, so two cards can be compared (\"If this card is\" on one, \"When this card is\" on the other)"),
        },
        async (i) => text(t.spotlight!(i.cards, i.say, i.phrases)),
      ),
    t.offerTakeBack && tool('offerTakeBack', 'Suggest the person takes back their last move, with a one-line reason. They decide.', { why: z.string() }, async (i) => text(t.offerTakeBack!(i.why))),
    t.flag && tool('flag', 'Flag what just happened as a moment to come back to in the review after the game.', { kind: z.enum(['blunder', 'mistake', 'missed', 'good']), title: z.string().describe('One short line') }, async (i) => text(t.flag!(i.kind, i.title))),
    t.note && tool('note', "Save a short note to the person's notes on this deck (a rule of thumb, a card to cut). You are given the notes at the start of each game.", { text: z.string() }, async (i) => text(t.note!(i.text))),
    t.suggestDeck &&
      tool(
        'suggestDeck',
        "Save a decklist to the person's decks for them to try. Give the whole list. Cards the app doesn't have yet are downloaded; a name that doesn't exist comes back with close matches.",
        { name: z.string(), main: entries, extra: entries, why: z.string().describe('One or two lines on what the deck is for, or what changed and why') },
        async (i) => text(await t.suggestDeck!(i.name, i.main, i.extra, i.why)),
      ),
    t.botMove && tool('botMove', "The trained bot's latest decision: how sure it was, and its own estimate of its chance to win.", {}, async () => text(t.botMove!())),
    t.evaluate && tool('evaluate', "The trained bot's view of the person's open question, as a second opinion: its estimate of their chance to win, and the option it would pick in their place. Only for decks it knows.", {}, async () => text(await t.evaluate!())),
    t.decks && tool('decks', "The person's decks. With no id: the list. With one: its cards, and their notes on it.", { id: z.string().optional() }, async (i) => text(t.decks!(i.id))),
    t.games && tool('games', "The person's games so far, newest first: decks, who they played, the result, and what reviews marked.", {}, async () => text(t.games!())),
    t.demo &&
      tool(
        'demo',
        "Show the person an example on a board in the chat: start a game on the rules engine that only you play, both sides. Give each side a deck of theirs by id, or a list of your own (any real cards; it isn't saved). With no setup it starts from a shuffled opening hand; with one, from the position you describe. Then play it with answer, saying what each move is for. Returns the table and the first question.",
        DemoSchema.shape,
        async (i) => text(await t.demo!(i)),
      ),
    t.board &&
      tool(
        'board',
        "Show the person an example you lay out by hand, on a board in the chat, for what the rules engine can't play: anime-only or made-up cards, or a position you want exactly so. You place the cards and give every move yourself; nothing checks it against the rules, so it is only as right as you are. Prefer demo whenever the real cards can play it.",
        BoardSchema.shape,
        async (i) => text(await t.board!(i)),
      ),
    t.startGame && tool('startGame', 'Start a game on the rules engine for the person. They get a button in the chat to open it. Only when they ask for one.', StartGameSchema.shape, async (i) => text(await t.startGame!(i))),
    t.startLesson && tool('startLesson', 'Start a lesson for the person: Claude plays both sides of a game on a deck, explains, and hands them the moves. They get a button in the chat to open it. Only when they ask for one.', StartLessonSchema.shape, async (i) => text(await t.startLesson!(i))),
    t.startFreePlay &&
      tool('startFreePlay', 'Open a free-play table for the person: both decks on a board with no rules enforced, to move cards by hand and try things out. They get a button in the chat to open it. Only when they ask for one.', StartFreePlaySchema.shape, async (i) => text(t.startFreePlay!(i))),
  ].filter((x) => !!x)
  const COACH = ['demo', 'board', 'lethal', 'odds', 'searchCards', 'rules', 'point', 'lookBack', 'spotlight', 'offerTakeBack', 'flag', 'note', 'suggestDeck', 'botMove', 'evaluate', 'decks', 'games', 'startGame', 'startLesson', 'startFreePlay'] as const
  const server = createSdkMcpServer({
    name: 'duel',
    version: '1.0.0',
    tools: [
      ...(t.table ? [tool('table', 'The table as you see it now: life points, each zone, both GYs, the chain.', {}, async () => text(t.table!()))] : []),
      ...(answer
        ? [
            tool(
              'answer',
              'Answer the open question by the numbers of the options you pick. Returns what happened, and the next question if it is yours.',
              {
                question: z.number().int().describe('The question number'),
                choices: z.array(z.number().int().min(0)).describe('Option numbers'),
                // Lessons stop after each move unless Claude batches it.
                ...(t.demo && { say: z.string().optional().describe('In an example: one short line shown under the board at this move, on what it is for') }),
                ...(setup && {
                  batch: z
                    .boolean()
                    .optional()
                    .describe('Keep playing after this move instead of stopping for the person, for routine moves you will sum up together afterwards'),
                }),
              },
              async ({ question, choices, batch, say }) => text(await answer(question, choices, batch, say)),
            ),
          ]
        : []),
      tool('card', "A card's full text and stats, by name.", { name: z.string() }, async ({ name }) => text(await req.tools.card(name))),
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
              {
                picks: z.array(z.array(z.int().min(0))).min(1).max(30),
                show: z.string().optional().describe('A short title: also puts the line on a board in the chat, for the person to step through or open full screen. For the line you settle on, not each attempt'),
              },
              async ({ picks, show }) => text(await tryLine(picks, show)),
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
              "Let the person play a player: until they've answered one question, until the end of this turn, or until you take it back. With a goal it's an exercise: they see the goal while they play, and when the player comes back to you, you say whether they reached it.",
              {
                player: PlayerSchema,
                until: z.enum(['answer', 'turn', 'takeBack']),
                goal: z.string().optional().describe('What they should reach, in a line they can check on the table: "end the turn with Utopia on the field", "get their life points to 0 this turn"'),
              },
              async (input) => text(await handOver(input.player, input.until, input.goal)),
            ),
            tool('takeBack', 'Play a player you handed over again.', { player: PlayerSchema }, async (input) => text(takeBack(input.player))),
            tool(
              'ask',
              'Ask the person a question to check they have followed: give options for multiple choice, or none for a written answer. Their answer comes as a message. With cards, those are shown big beside the question, so you can ask about what a card says.',
              {
                question: z.string(),
                options: z.array(z.string()).max(6).optional(),
                cards: z.array(z.string()).max(3).optional().describe('By name: cards on the table the question is about, to show big'),
                correct: z.int().min(0).optional().describe("The right option's number, from 0: you are told whether they picked it"),
              },
              async (input) => text(ask(input.question, input.options, input.cards, input.correct)),
            ),
            ...(plan
              ? [
                  tool(
                    'plan',
                    "The lesson's plan, pinned above the chat with the point you're on. First call: give its 3 to 5 points, each a few words. After that, call it with no points each time you move on to the next point (or now, to go to a given one, counting from 0). Past the last point, the lesson is done.",
                    { points: z.array(z.string().min(1).max(60)).min(2).max(6).optional(), now: z.int().min(0).optional() },
                    async (input) => text(plan(input.points, input.now)),
                  ),
                ]
              : []),
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
      ...(goTo
        ? [
            tool(
              'goTo',
              "Move the person's screen to the table after a step (0 for the start), and get that table. For when the point is at another step than the one they're on. What you point at and spotlight next lands there.",
              { step: z.int().min(0) },
              async ({ step }) => text(goTo(step)),
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
        ...(t.table ? ['mcp__duel__table'] : []),
        'mcp__duel__card',
        ...(answer ? ['mcp__duel__answer'] : []),
        ...(deck ? ['mcp__duel__deck', 'mcp__duel__history'] : []),
        ...(tryLine ? ['mcp__duel__options', 'mcp__duel__tryLine'] : []),
        ...COACH.filter((n) => t[n]).map((n) => `mcp__duel__${n}`),
        ...(setup ? ['mcp__duel__setup', 'mcp__duel__handOver', 'mcp__duel__takeBack', 'mcp__duel__ask', 'mcp__duel__plan'] : []),
        ...(mark ? ['mcp__duel__tableAt', 'mcp__duel__mark'] : []),
        ...(goTo ? ['mcp__duel__goTo'] : []),
      ],
      settingSources: [],
      // Only the duel's own tools: not the account's claude.ai connectors (Gmail and
      // the like), which it would otherwise report on in the chat.
      strictMcpConfig: true,
      env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
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
