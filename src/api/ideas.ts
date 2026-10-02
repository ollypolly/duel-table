// Ideas jotted down from the header: things to change or add, kept to go
// through together later rather than built on the spot.
import { z } from 'zod'

export const IdeaSchema = z.object({
  id: z.string(),
  text: z.string(),
  at: z.number().describe('When it was written (ms since the epoch)'),
  where: z.string().optional().describe('What was open at the time'),
})
export type Idea = z.infer<typeof IdeaSchema>

export const NewIdeaSchema = z.object({ text: z.string().min(1).max(4000), where: z.string().max(200).optional() }).strict()
