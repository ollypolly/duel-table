// Around a game against a friend: its chat and its fun. See server/table.ts.
import type { Player } from '../engine'

export const SOUNDS = ['laugh', 'trombone', 'applause', 'drumroll', 'gasp', 'ding'] as const
export type Sound = (typeof SOUNDS)[number]
export const EMOJI = ['😂', '😱', '🔥', '💀', '👏', '😭', '🤔', '😎', '❤️', '🙏'] as const

// from: an account id, or 'claude'. only: a message (and Claude's answer to it)
// for that account alone.
export type TableMessage = { id: number; at: string; from: string; name: string; text: string; only?: string }
// card: the slot the emoji is on (swapped for the player in p2, like the rest of their view).
export type TableFun = { id: number; at: string; by: string; name: string; sound?: Sound; emoji?: string; card?: { player: Player; zone: string; index: number } }
export type TableRecord = { chat: TableMessage[]; fun: TableFun[] }
export type TableView = TableRecord & { claudeTyping?: true }
