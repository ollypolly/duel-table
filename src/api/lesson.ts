// Zod schemas for live lessons: step pacing, the presenter cursor, prompts
// and the events Claude long-polls for. Pure: shared by browser and server.
import { z } from 'zod'
import { StepSchema } from '../scenarios/schema'

// When a posted step shows: omitted is straight away; otherwise after a
// delay, or when the viewer clicks Next. Queued steps show in order.
export const RevealSchema = z.union([z.literal('onNext'), z.object({ afterMs: z.int().min(0).max(600_000) }).strict()])
export type Reveal = z.infer<typeof RevealSchema>

const message = z.string().min(1).describe('Markdown')
export const PromptSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack'), message, button: z.string().min(1).optional(), quiet: z.boolean().optional().describe('The button is the lesser choice: something else on screen is what to do') }).strict(),
  z.object({ type: z.literal('choice'), message, options: z.array(z.string().min(1)).min(2) }).strict(),
  z.object({ type: z.literal('move'), message }).strict(),
  z.object({ type: z.literal('text'), message, placeholder: z.string().optional() }).strict(),
])
export type Prompt = z.infer<typeof PromptSchema>
export type OpenPrompt = Prompt & { id: string; openedAt: number }

export const AnswerSchema = z.object({ id: z.string(), choice: z.int().min(0).optional(), text: z.string().optional() }).strict()
export type Answer = z.infer<typeof AnswerSchema>

// The position the lesson wants on screen; from..to replays a range. seq
// changes on every move so the same position can be sent twice.
export const CursorSchema = z.object({ position: z.int().min(0), from: z.int().min(0).optional(), seq: z.int() })
export type Cursor = z.infer<typeof CursorSchema>

export const LessonViewSchema = z.object({
  revealed: z.int().describe('The last position the viewer can see; steps after it are queued'),
  queued: z.int(),
  waiting: z.enum(['next', 'timer']).optional().describe('What the first queued step waits for'),
  cursor: CursorSchema,
  prompt: PromptSchema.and(z.object({ id: z.string(), openedAt: z.int() })).optional(),
})
export type LessonView = z.infer<typeof LessonViewSchema>

export const LessonEventSchema = z.intersection(
  z.object({ seq: z.int() }),
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('revealed'), position: z.int(), via: z.enum(['now', 'next', 'timer']) }),
    z.object({ type: z.literal('step'), position: z.int(), step: StepSchema }).describe('A step the viewer made'),
    z.object({ type: z.literal('undo'), position: z.int() }).describe('The viewer undid a step'),
    z.object({
      type: z.literal('answer'),
      prompt: z.object({ id: z.string(), type: z.string() }),
      choice: z.object({ index: z.int(), option: z.string() }).optional(),
      text: z.string().optional(),
      steps: z.array(z.int()).optional().describe('For a move prompt: positions of the steps made while it was open'),
    }),
  ]),
)
export type LessonEvent = z.infer<typeof LessonEventSchema>
