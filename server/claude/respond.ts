// Claude's view of a chance to respond: whether it's worth stopping the
// person for, and why. One short call with thinking off and no tools, given
// only what the person can see.
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { GamePrompt } from '../../src/api/game'
import type { CardDb } from '../../src/data/cardDb'
import type { BoardState, Player } from '../../src/engine'
import type { ChainAdvice } from '../games'
import { cardText, describeQuestion, describeTable, publicLabel } from './view'

const MODEL = 'claude-sonnet-5-5'

// One prompt in, the model's text out.
export type Quick = (system: string, message: string, limitMs?: number) => Promise<string>

// Thinking is off and the call is cut short: an answer that takes longer than
// simply asking the person is worth less than asking them.
const LIMIT_MS = 10_000

export const sdkQuick: Quick = async (system, message, limitMs = LIMIT_MS) => {
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), limitMs)
  const q = query({
    prompt: message,
    options: { model: MODEL, systemPrompt: system, tools: [], settingSources: [], maxTurns: 1, maxThinkingTokens: 0, persistSession: false, abortController },
  })
  let out = ''
  try {
    for await (const m of q) if (m.type === 'result' && m.subtype === 'success' && !m.is_error) out = m.result
  } catch {
    // Cut short or failed: no view, so the person is asked.
  } finally {
    clearTimeout(timer)
  }
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
