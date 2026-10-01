// Claude's view of a chance to respond: whether it's worth stopping the
// person for, and why. One short call to a fast model, with no tools and
// only what the person can see.
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { GamePrompt } from '../../src/api/game'
import type { CardDb } from '../../src/data/cardDb'
import type { BoardState, Player } from '../../src/engine'
import type { ChainAdvice } from '../games'
import { cardText, describeQuestion, describeTable, publicLabel } from './view'

const MODEL = 'claude-haiku-4-5-20251001'

// One prompt in, the model's text out.
export type Quick = (system: string, message: string) => Promise<string>

export const sdkQuick: Quick = async (system, message) => {
  const q = query({ prompt: message, options: { model: MODEL, systemPrompt: system, tools: [], settingSources: [], maxTurns: 1, persistSession: false } })
  let out = ''
  for await (const m of q) if (m.type === 'result' && m.subtype === 'success' && !m.is_error) out = m.result
  return out
}

export function chainMessage(prompt: GamePrompt, state: BoardState, player: Player, labels: string[], db: CardDb): string {
  const cards = [...new Set(prompt.options.flatMap((o) => (o.card && state.cards[o.card] ? [db.byId(state.cards[o.card].cardId ?? 0)?.name ?? ''] : [])))].filter(Boolean)
  const top = state.chain.at(-1)
  const to = top && db.byId(state.cards[top.card]?.cardId ?? 0)?.name
  return [
    `What just happened:\n${labels.slice(-8).map((l) => `- ${publicLabel(l, state, player, db)}`).join('\n')}`,
    describeTable(state, player, db),
    describeQuestion(prompt, state, player, db, 'They could respond now'),
    `Card texts:\n${[...cards, ...(to ? [to] : [])].map((n) => cardText(db, n)).join('\n\n')}`,
  ].join('\n\n')
}

export function parseAdvice(text: string): ChainAdvice | undefined {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return undefined
  try {
    const o = JSON.parse(m[0]) as { stop?: unknown; why?: unknown }
    return typeof o.stop === 'boolean' && typeof o.why === 'string' ? { stop: o.stop, why: o.why } : undefined
  } catch {
    return undefined
  }
}
