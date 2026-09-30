// Typed fetch client for the local API, plus the SSE subscription live mode
// uses. Everything is optional: playback works without the server.
import type { CardData } from '../data/cardDb'
import type { Issue, Player, Step } from '../engine'
import type { ScenarioFile } from '../scenarios/schema'
import type { ClaudeSettings, GameAnswer, GameView, ModelChoice } from './game'
import type { Answer, LessonView } from './lesson'
import type { TutorView } from './tutor'

export type SessionSummary = {
  id: string
  title: string
  steps: number
  basedOn?: string
  updatedAt: string
  players: Record<Player, { name: string; deck?: string; deckName?: string }>
  turn: number
  kind: 'game' | 'board'
  winner?: Player
}
export type SessionUpdate = SessionSummary & { file: ScenarioFile; lesson: LessonView; game?: GameView }

export type DeckSummary = { id: string; name?: string; size?: { main: number; extra: number }; usedBy: string[]; errors?: string[] }
export type DeckEntry = { name: string; count: number }
export type Deck = {
  id: string
  name: string
  size: { main: number; extra: number }
  main: (CardData & DeckEntry)[]
  extra: (CardData & DeckEntry)[]
  warnings: string[]
  usedBy: string[]
}

export class ApiError extends Error {
  readonly status: number
  readonly body: { error?: string; details?: string[]; issues?: Issue[]; unknown?: { name: string; suggestions: string[] }[] }
  constructor(status: number, body: ApiError['body']) {
    super([body.error ?? `HTTP ${status}`, ...(body.details ?? []), ...(body.issues ?? []).map((i) => i.message)].join(': '))
    this.status = status
    this.body = body
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json)
  return json as T
}

export const api = {
  decks: () => call<DeckSummary[]>('GET', '/decks'),
  deck: (id: string) => call<Deck>('GET', `/decks/${id}`),
  // Either a pasted decklist or the cards. Unknown names fail with 422 and suggestions (ApiError.body.unknown).
  saveDeck: (d: { id: string; name: string; overwrite?: boolean } & ({ list: string } | { cards: DeckEntry[] })) => call<Deck>('POST', '/decks', d),
  deleteDeck: (id: string) => call<{ path: string }>('DELETE', `/decks/${id}`),
  // undefined when the server isn't running.
  listSessions: () => call<SessionSummary[]>('GET', '/sessions').catch(() => undefined),
  renameSession: (id: string, title: string) => call<SessionSummary>('PATCH', `/sessions/${id}`, { title }),
  deleteSession: (id: string) => call<{ deleted: string }>('DELETE', `/sessions/${id}`),
  createSession: (opts: { scenario: string; atStep: number }) => call<SessionSummary>('POST', '/sessions', opts),
  // The viewer's own moves, so Claude can tell them from its steps.
  applyStep: (id: string, step: Step) => call<{ position: number }>('POST', `/sessions/${id}/steps`, { ...step, author: 'user' }),
  undo: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/undo`, { author: 'user' }),
  next: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/next`),
  answer: (id: string, answer: Answer) => call<SessionSummary>('POST', `/sessions/${id}/prompt/answer`, answer),
  fork: (id: string, atStep: number) => call<SessionSummary>('POST', `/sessions/${id}/fork`, { atStep }),
  createGame: (opts: { deck: string; opponentDeck: string; claude?: 'p2'; model?: ModelChoice; coach?: boolean }) => call<SessionSummary>('POST', '/games', opts),
  answerGame: (id: string, answer: GameAnswer) => call<SessionSummary>('POST', `/sessions/${id}/game/answer`, answer),
  // Whether this server has a Claude login to play with.
  claude: () => call<ClaudeStatus>('GET', '/claude').catch((): ClaudeStatus => ({ available: false })),
  chat: (id: string, text: string, show?: boolean) => call<unknown>('POST', `/sessions/${id}/claude/chat`, { text, ...(show && { show }) }),
  stopClaude: (id: string) => call<unknown>('POST', `/sessions/${id}/claude/stop`),
  resumeClaude: (id: string) => call<unknown>('POST', `/sessions/${id}/claude/resume`),
  claudeSettings: (id: string, s: ClaudeSettings) => call<unknown>('POST', `/sessions/${id}/claude/settings`, s),
  // Claude as a tutor on a lesson (a scenario in the repo).
  tutor: (id: string) => call<TutorView>('GET', `/scenarios/${id}/tutor`),
  askTutor: (id: string, text: string, position: number) => call<TutorView>('POST', `/scenarios/${id}/tutor/chat`, { text, position }),
  stopTutor: (id: string) => call<TutorView>('POST', `/scenarios/${id}/tutor/stop`),
  tutorSettings: (id: string, s: { model?: ModelChoice }) => call<TutorView>('POST', `/scenarios/${id}/tutor/settings`, s),
  clearTutor: (id: string) => call<TutorView>('DELETE', `/scenarios/${id}/tutor`),
}

export type ClaudeStatus = { available: boolean; email?: string; plan?: string }

// Calls onUpdate with the whole session now and after every change.
export function subscribeSession(id: string, onUpdate: (s: SessionUpdate) => void, onError: (message: string) => void): () => void {
  const source = new EventSource(`/api/sessions/${id}/events`)
  source.addEventListener('session', (e) => onUpdate(JSON.parse((e as MessageEvent<string>).data)))
  source.onerror = () => {
    // EventSource retries by itself; a closed source means it gave up (e.g. 404).
    if (source.readyState === EventSource.CLOSED) onError(`Can't follow session ${id}. Is the API running, and does the session exist?`)
    else onError('Lost the connection to the API; retrying…')
  }
  source.onopen = () => onError('')
  return () => source.close()
}
