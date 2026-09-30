// Zod schemas for reviewing a game with Claude. Pure: shared by browser and server.
import { z } from 'zod'
import { ChatEntrySchema, ModelChoiceSchema } from './game'

export const ReviewViewSchema = z.object({
  model: ModelChoiceSchema,
  status: z.enum(['idle', 'thinking']),
  chat: z.array(ChatEntrySchema).describe("The review's own chat; the game's chat is under game.claude"),
  costUsd: z.number().describe('What the runs so far would cost on the API (a subscription login is not charged per call)'),
})
export type ReviewView = z.infer<typeof ReviewViewSchema>

export const ReviewChatSchema = z
  .object({
    text: z.string().min(1),
    position: z.int().min(0).describe("The step you're looking at: 0 for the start, n for after step n. Claude gets the table there"),
  })
  .strict()

// A game that's over can be reviewed, and so can a lesson Claude ran, which
// often has no winner. A game still in play can't yet: Claude would see the
// cards you can't.
export const reviewable = (t: { kind: 'game' | 'board'; winner?: string; claudeLesson?: boolean }) => t.kind === 'game' && (!!t.winner || !!t.claudeLesson)
