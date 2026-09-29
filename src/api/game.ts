// Zod schemas for games on the rules engine. Pure: shared by browser and server.
import { z } from 'zod'
import { PlayerSchema } from '../scenarios/schema'

export const GameViewSchema = z.object({
  waitingFor: PlayerSchema.optional().describe('Whose answer the rules engine is waiting for'),
  winner: z.object({ player: PlayerSchema, reason: z.int() }).optional(),
  bots: z.array(PlayerSchema).describe('Players the random bot answers for'),
})
export type GameView = z.infer<typeof GameViewSchema>
