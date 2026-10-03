// Accounts: who's signed in, and everyone's usernames. See docs/MULTIPLAYER.md.
import { z } from 'zod'

export const AccountSchema = z.object({
  id: z.string().describe('What everything is owned by; never shown'),
  username: z.string(),
  name: z.string(),
  admin: z.literal(true).optional(),
})
export type Account = z.infer<typeof AccountSchema>

export const MeSchema = z.object({
  accounts: z.boolean().describe('Whether this server has accounts (without them, anyone can change anything)'),
  me: AccountSchema.optional().describe('The signed-in account'),
})
export type Me = z.infer<typeof MeSchema>

export const NewAccountSchema = z.object({ username: z.string().trim().toLowerCase(), name: z.string().trim().max(40) }).strict()
