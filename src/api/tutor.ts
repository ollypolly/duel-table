// Zod schemas for Claude as a tutor on a lesson. Pure: shared by browser and server.
import { z } from 'zod'
import { ChatEntrySchema, ModelChoiceSchema } from './game'

export const TutorViewSchema = z.object({
  model: ModelChoiceSchema,
  status: z.enum(['idle', 'thinking']),
  chat: z.array(ChatEntrySchema),
  costUsd: z.number().describe('What the runs so far would cost on the API (a subscription login is not charged per call)'),
})
export type TutorView = z.infer<typeof TutorViewSchema>

export const TutorAskSchema = z
  .object({
    text: z.string().min(1),
    position: z.int().min(0).describe('The step the viewer is on: 0 for the setup, n for after step n. Claude only learns the steps up to here'),
  })
  .strict()
