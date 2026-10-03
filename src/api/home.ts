// Zod schemas for the chat with Claude on the home page. Pure: shared by browser and server.
import { z } from 'zod'
import { ChatEntrySchema, ModelChoiceSchema } from './game'

export const HomeThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number().describe('When it was last written to (ms since the epoch)'),
  owner: z.string().optional().describe("The account that started it; missing means the admin's"),
})
export type HomeThread = z.infer<typeof HomeThreadSchema>

export const HomeViewSchema = HomeThreadSchema.extend({
  model: ModelChoiceSchema,
  status: z.enum(['idle', 'thinking']),
  chat: z.array(ChatEntrySchema),
  costUsd: z.number().describe('What the runs so far would cost on the API (a subscription login is not charged per call)'),
})
export type HomeView = z.infer<typeof HomeViewSchema>

export const HomeAskSchema = z.object({ text: z.string().min(1), model: ModelChoiceSchema.optional().describe('For a new chat (default haiku)') }).strict()
