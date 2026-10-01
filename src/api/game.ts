// Zod schemas for games on the rules engine. Pure: shared by browser and server.
import { z } from 'zod'
import { PlayerSchema, ZoneRefSchema } from '../scenarios/schema'

// What the rules engine is asking a player, as numbered options. Cards are
// iids on the board, so the browser can highlight them.
export const GamePromptSchema = z.object({
  id: z.int().describe('Which question this is; send it back with the answer'),
  player: PlayerSchema,
  kind: z.enum(['idle', 'battle', 'chain', 'yesno', 'option', 'cards', 'unselect', 'sum', 'tribute', 'position', 'place', 'announce']),
  message: z.string(),
  source: z
    .object({
      name: z.string(),
      card: z.string().optional(),
      when: z.enum(['activating', 'resolving']).describe('Asked to activate it (a cost, its targets), or as its effect resolves'),
    })
    .optional()
    .describe('The card whose effect is asking'),
  advice: z.string().optional().describe("Claude's view on whether to respond here, when responses are set to ask it"),
  costly: z.boolean().optional().describe('The cards picked leave your hand or field (discarded, Tributed, sent to the GY, banished, destroyed, returned)'),
  options: z.array(
    z.object({
      label: z.string(),
      card: z.string().optional().describe('The card this option is about'),
      zone: ZoneRefSchema.optional().describe('The zone this option is, when zones are the choice'),
      group: z.string().optional().describe('For grouping options in a menu, e.g. "Summon" or "Phase"'),
    }),
  ),
  min: z.int().describe('How many options to pick, at least'),
  max: z.int(),
})
export type GamePrompt = z.infer<typeof GamePromptSchema>

// Questions where each option is picking a card (rather than doing something
// with one), so clicking the card is the answer.
export const PICK_KINDS: GamePrompt['kind'][] = ['cards', 'tribute', 'unselect', 'sum']

export const GameAnswerSchema = z.object({ id: z.int(), choices: z.array(z.int().min(0)) }).strict()
export type GameAnswer = z.infer<typeof GameAnswerSchema>

export const ChatEntrySchema = z.object({
  from: z.enum(['you', 'claude', 'move', 'note', 'log']).describe('move: an answer Claude gave; note: from the app; log: something that happened in a game Claude coaches'),
  text: z.string(),
  moment: z.int().optional().describe("In a review: the step of the key moment this is Claude taking you through"),
  at: z.number().optional().describe('When it was said (ms since the epoch); older chats have none'),
})

// Gives the time to entries that have none yet. Entries are added in many
// places, so it's done where a chat is shown or saved.
export function stamp(chat: ChatEntry[]): ChatEntry[] {
  for (const e of chat) e.at ??= Date.now()
  return chat
}
export type ChatEntry = z.infer<typeof ChatEntrySchema>

export const ModelChoiceSchema = z.enum(['opus', 'sonnet'])
export type ModelChoice = z.infer<typeof ModelChoiceSchema>

export const ClaudeViewSchema = z.object({
  player: PlayerSchema,
  watch: z.boolean().optional().describe("Claude isn't playing: it sits on player's side as their coach, in a game against a bot"),
  knowsDeck: z.boolean().optional().describe("For that coach: it can look at the bot's decklist"),
  point: z.array(z.string()).optional().describe('Cards (iids) that coach is pointing at, to highlight'),
  model: ModelChoiceSchema,
  coach: z.boolean().describe('Also points out your misplays and explains its plays'),
  share: z.boolean().describe('You show Claude your hidden cards (hand, face-down cards, Extra Deck) and your open question, so it can advise you'),
  status: z.enum(['idle', 'thinking', 'stopped']),
  chat: z.array(ChatEntrySchema),
  costUsd: z.number().describe('What the runs so far would cost on the API (a subscription login is not charged per call)'),
  holds: z.array(PlayerSchema).optional().describe('In a lesson: the players Claude is answering for now'),
  plan: z.object({ points: z.array(z.string()), now: z.int() }).optional().describe("In a lesson: what it covers, and the point it's on (0 for the first; points.length once it's done)"),
})
export type ClaudeView = z.infer<typeof ClaudeViewSchema>

export const ClaudeSettingsSchema = z.object({ model: ModelChoiceSchema.optional(), coach: z.boolean().optional(), share: z.boolean().optional(), knowsDeck: z.boolean().optional() }).strict()
export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>

// When you're asked "respond with a chain?". all: at every chance you have
// something to activate. auto: not when nothing happened, nor after your own
// move. advise: as auto, with Claude's view on each. claude: as auto, and
// Claude passes for you where responding is plainly not worth it.
export const RESPOND = ['all', 'auto', 'advise', 'claude'] as const
export const RespondSchema = z.enum(RESPOND)
export type Respond = z.infer<typeof RespondSchema>

export const SkippedSchema = z.object({
  at: z.int().describe('The answer it was passed at: reopen it with /game/reopen'),
  cards: z.array(z.string()).describe('What you could have activated'),
  to: z.string().optional().describe('What you could have responded to'),
  by: z.enum(['rules', 'claude']),
  why: z.string().optional(),
  turn: z.int().optional().describe('The turn it was passed in'),
})
export type Skipped = z.infer<typeof SkippedSchema>

export const GameViewSchema = z.object({
  waitingFor: PlayerSchema.optional().describe('Whose answer the rules engine is waiting for'),
  winner: z.object({ player: PlayerSchema, reason: z.int() }).optional(),
  startedAt: z.number().optional().describe('When the game began (ms since the epoch); older games have none'),
  endedAt: z.number().optional().describe('When it was won, lost or given up'),
  bots: z.array(PlayerSchema).describe('Players a bot answers for'),
  bot: z.enum(['random', 'agent']).optional().describe('Which bot: the random one, or the trained one (ygo-agent)'),
  prompt: GamePromptSchema.optional().describe("The open question, when it's for a person"),
  claude: ClaudeViewSchema.optional().describe('Claude, when it plays one side or coaches you against a bot'),
  undos: z.int().optional().describe('Moves you can still take back, when there is one to take back now'),
  respond: RespondSchema.optional().describe('When you are asked to respond (default auto)'),
  skipped: z.array(SkippedSchema).optional().describe('Chances to respond passed for you lately, newest last'),
  deciding: z.boolean().optional().describe('Claude is weighing a chance to respond for you'),
})
export type GameView = z.infer<typeof GameViewSchema>
