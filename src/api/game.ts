// Zod schemas for games on the rules engine. Pure: shared by browser and server.
import { z } from 'zod'
import { PlayerSchema } from '../scenarios/schema'

// What the rules engine is asking a player, as numbered options. Cards are
// iids on the board, so the browser can highlight them.
export const GamePromptSchema = z.object({
  id: z.int().describe('Which question this is; send it back with the answer'),
  player: PlayerSchema,
  kind: z.enum(['idle', 'battle', 'chain', 'yesno', 'option', 'cards', 'unselect', 'sum', 'tribute', 'position', 'place', 'announce']),
  message: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      card: z.string().optional().describe('The card this option is about'),
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

export const GameViewSchema = z.object({
  waitingFor: PlayerSchema.optional().describe('Whose answer the rules engine is waiting for'),
  winner: z.object({ player: PlayerSchema, reason: z.int() }).optional(),
  bots: z.array(PlayerSchema).describe('Players the random bot answers for'),
  prompt: GamePromptSchema.optional().describe("The open question, when it's for a person"),
})
export type GameView = z.infer<typeof GameViewSchema>
