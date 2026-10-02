// Zod schemas for reviewing a game with Claude. Pure: shared by browser and server.
import { z } from 'zod'
import { PlayerSchema, ZoneRefSchema } from '../scenarios/schema'
import { ChatEntrySchema, ModelChoiceSchema } from './game'

// A moment Claude picked out of the game on its first look, like the ?? and
// ?! on a chess review. step is the move itself (the table after it).
export const MOMENT_KINDS = ['blunder', 'mistake', 'missed', 'good'] as const
export const MomentSchema = z.object({
  step: z.int().min(1),
  kind: z.enum(MOMENT_KINDS),
  player: PlayerSchema.describe('Whose move it was'),
  title: z.string().describe('One short line'),
})
export type Moment = z.infer<typeof MomentSchema>

export const ReviewViewSchema = z.object({
  model: ModelChoiceSchema,
  status: z.enum(['idle', 'thinking']),
  chat: z.array(ChatEntrySchema).describe("The review's own chat; the game's chat is under game.claude"),
  costUsd: z.number().describe('What the runs so far would cost on the API (a subscription login is not charged per call)'),
  moments: z.array(MomentSchema).describe('The key moments Claude has marked so far, in step order'),
  scanned: z.boolean().describe('Claude has finished its first look through the game for key moments'),
  go: z.object({ n: z.int(), step: z.int() }).optional().describe('A step Claude moved your view to; n changes each time'),
  marks: z
    .object({
      step: z.int().describe('The step they are drawn on'),
      point: z.array(z.string()).describe('Cards (iids) highlighted'),
      arrows: z.array(z.object({ from: z.string(), to: z.string() })).describe('Arrows (iids) between cards'),
      zones: z.array(ZoneRefSchema).describe('Zones circled'),
    })
    .optional()
    .describe('What Claude has marked on the table, with its last reply'),
  spotlight: z
    .object({
      n: z.int().describe('When it was shown, so the same cards can be shown again'),
      step: z.int().describe('The step whose table they are from'),
      cards: z.array(z.string()).describe('iids'),
      say: z.string().optional(),
      phrases: z.array(z.string()).optional().describe("Words of the cards' text to mark"),
    })
    .optional()
    .describe('Cards Claude has lifted off the table to show big'),
})
export type ReviewView = z.infer<typeof ReviewViewSchema>

export const ReviewChatSchema = z
  .object({
    text: z.string().min(1),
    position: z.int().min(0).describe("The step you're looking at: 0 for the start, n for after step n. Claude gets the table there"),
  })
  .strict()

export const ReviewMomentSchema = z.object({ step: z.int().min(1) }).strict()

// A game that's over can be reviewed, and so can a lesson Claude ran, which
// often has no winner. A game still in play can't yet: Claude would see the
// cards you can't.
export const reviewable = (t: { kind: 'game' | 'board'; winner?: string; claudeLesson?: boolean }) => t.kind === 'game' && (!!t.winner || !!t.claudeLesson)
