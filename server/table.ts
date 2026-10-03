// What's said and done around a game against a friend, apart from the moves:
// one group chat (with Claude in it when asked, or privately to one player),
// and the fun (sounds on both screens, an emoji on a card). See
// docs/MULTIPLAYER-FLOW.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SessionError } from './errors'

import { type TableFun, type TableMessage, type TableRecord, type TableView } from '../src/api/table'

export { EMOJI, SOUNDS } from '../src/api/table'

export type TableStore = { load(id: string): TableRecord | undefined; save(id: string, t: TableRecord): void }

export const memoryTables = (): TableStore => {
  const kept = new Map<string, TableRecord>()
  return { load: (id) => kept.get(id), save: (id, t) => void kept.set(id, t) }
}

export const diskTables = (dir: string): TableStore => ({
  load: (id) => (existsSync(join(dir, `${id}.json`)) ? (JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as TableRecord) : undefined),
  save: (id, t) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(t, null, 2) + '\n')
  },
})

const FUN_KEPT = 20 // fun is of the moment: only the latest is kept
const MAX_TEXT = 1000

export class TableService {
  private store: TableStore
  // Claude's answers on the way, by session: '' for the table, or the account asking privately.
  private typing = new Map<string, Set<string>>()
  constructor(store: TableStore = memoryTables()) {
    this.store = store
  }

  private load(id: string): TableRecord {
    return this.store.load(id) ?? { chat: [], fun: [] }
  }

  // What viewer may see: the table's messages and their own private ones.
  view(id: string, viewer: string | undefined): TableView {
    const { chat, fun } = this.load(id)
    const typing = this.typing.get(id)
    return { chat: chat.filter((m) => !m.only || m.only === viewer), fun, ...((typing?.has('') || (viewer && typing?.has(viewer))) && { claudeTyping: true as const }) }
  }

  say(id: string, from: { id: string; name: string }, text: string, only?: string): TableMessage {
    text = text.trim()
    if (!text) throw new SessionError(400, 'say something')
    if (text.length > MAX_TEXT) throw new SessionError(400, `a message is at most ${MAX_TEXT} characters`)
    const t = this.load(id)
    const message: TableMessage = { id: (t.chat.at(-1)?.id ?? 0) + 1, at: new Date().toISOString(), from: from.id, name: from.name, text, ...(only && { only }) }
    this.store.save(id, { ...t, chat: [...t.chat, message] })
    return message
  }

  // Claude answering, while the given promise runs.
  async answer(id: string, only: string | undefined, reply: () => Promise<string>, changed: () => void) {
    const key = only ?? ''
    const typing = this.typing.get(id) ?? new Set()
    this.typing.set(id, typing.add(key))
    changed()
    let text: string
    try {
      text = (await reply()).trim() || "Sorry, I couldn't think of an answer to that one."
    } catch {
      text = "Sorry, I couldn't answer just now."
    }
    typing.delete(key)
    this.say(id, { id: 'claude', name: 'Claude' }, text, only)
    changed()
  }

  fun(id: string, by: { id: string; name: string }, f: Pick<TableFun, 'sound' | 'emoji' | 'card'>): TableFun {
    if (!f.sound && !f.emoji) throw new SessionError(400, 'a sound or an emoji')
    const t = this.load(id)
    const fun: TableFun = { id: (t.fun.at(-1)?.id ?? 0) + 1, at: new Date().toISOString(), by: by.id, name: by.name, ...f }
    this.store.save(id, { ...t, fun: [...t.fun, fun].slice(-FUN_KEPT) })
    return fun
  }

  // The chat so far, as Claude is given it: the table's, and only's own.
  transcript(id: string, only?: string, last = 12): string {
    return this.load(id)
      .chat.filter((m) => !m.only || m.only === only)
      .slice(-last)
      .map((m) => `${m.name}${m.only ? ' (privately)' : ''}: ${m.text}`)
      .join('\n')
  }
}
