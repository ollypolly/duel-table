// Typed fetch client for the local API, plus the SSE subscription live mode
// uses. Everything is optional: playback works without the server.
import type { CardData } from '../data/cardDb'
import type { TableFun, TableView } from './table'
import type { Issue, Player, Step } from '../engine'
import type { ScenarioFile } from '../scenarios/schema'
import type { ClaudeSettings, GameAnswer, GameView, ModelChoice, Respond } from './game'
import type { Answer, LessonView } from './lesson'
import type { Moment, ReviewView } from './review'
import type { TutorView } from './tutor'
import type { Account, Me } from './accounts'
import type { Idea } from './ideas'
import type { HomeThread, HomeView } from './home'

export type SessionSummary = {
  id: string
  title: string
  steps: number
  basedOn?: string
  updatedAt: string
  createdAt?: string // when it began, where that's known
  players: Record<Player, { name: string; deck?: string; deckName?: string }>
  turn: number
  kind: 'game' | 'board'
  winner?: Player
  claudeLesson?: true // a lesson Claude ran on the rules engine
  fromTable?: true // a game carried over from a free-play table
  lessonPlan?: { now: number; of: number } // how far its plan has got: now === of once it's done
  opponent?: 'bot' | 'trained' | 'claude' // who answers for p2 in a game, if not a person
  reviewed?: { scanned: boolean; busy: boolean; moments: Partial<Record<Moment['kind'], number>> } // it has a review with Claude
  owner?: string // the account that made it; missing means the admin's
  seats?: Record<Player, string> // a game against a friend: the account in each seat
}
export type SessionUpdate = SessionSummary & { file: ScenarioFile; lesson: LessonView; game?: GameView; review?: ReviewView; table?: TableView }

export type Invite = { code: string; from: Account; deck: { id: string; name: string }; session?: string; yours: boolean; playing: boolean }

export type DeckSummary = { id: string; name?: string; size?: { main: number; extra: number }; usedBy: string[]; errors?: string[]; owner?: string }
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
  // Accounts: who's signed in (a cookie), and everyone's usernames.
  me: () => call<Me>('GET', '/me').catch((): Me => ({ accounts: false })),
  accounts: () => call<Account[]>('GET', '/accounts'),
  makeAccount: (a: { username: string; name: string }) => call<Account>('POST', '/accounts', a),
  signIn: (key: string) => call<Account>('POST', '/signin', { key }),
  signOut: () => call<Me>('POST', '/signout'),
  // A key to sign in another device with (the admin can make one for anyone).
  newKey: (account?: string) => call<{ key: string }>('POST', account ? `/accounts/${account}/keys` : '/me/keys'),
  changeAccount: (id: string, a: { username?: string; name?: string }) => call<Account>('PATCH', `/accounts/${id}`, a),
  removeAccount: (id: string) => call<{ deleted: string }>('DELETE', `/accounts/${id}`),
  // Games against a friend: an invite to send, joined with a deck (making an account on the way, if need be).
  invites: () => call<Invite[]>('GET', '/invites').catch((): Invite[] => []),
  invite: (code: string) => call<Invite>('GET', `/invites/${code}`),
  makeInvite: (deck: string, respond?: Respond) => call<Invite>('POST', '/invites', { deck, ...(respond && { respond }) }),
  joinInvite: (code: string, j: { deck: string; respond?: Respond; account?: { username: string; name: string } }) => call<Invite>('POST', `/invites/${code}/join`, j),
  cancelInvite: (code: string) => call<{ deleted: string }>('DELETE', `/invites/${code}`),
  // Notifications on this device; no key means they're off on this server.
  pushKey: () => call<{ key?: string }>('GET', '/push').catch((): { key?: string } => ({})),
  pushOn: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => call<{ on: boolean }>('POST', '/push', sub),
  pushOff: (endpoint: string) => call<{ on: boolean }>('POST', '/push/off', { endpoint }),
  nudge: (id: string) => call<{ nudged: boolean }>('POST', `/sessions/${id}/table/nudge`),
  rematch: (id: string, accept = true) => call<SessionSummary>('POST', `/sessions/${id}/game/rematch`, { accept }),
  takeback: (id: string, accept: boolean) => call<SessionSummary>('POST', `/sessions/${id}/game/takeback`, { accept }),
  // Around a game against a friend. hidden: for Claude only, who answers you alone.
  tableChat: (id: string, text: string, hidden?: boolean) => call<SessionSummary>('POST', `/sessions/${id}/table/chat`, { text, ...(hidden && { hidden }) }),
  tableFun: (id: string, f: Pick<TableFun, 'sound' | 'emoji' | 'card'>) => call<SessionSummary>('POST', `/sessions/${id}/table/fun`, f),
  decks: () => call<DeckSummary[]>('GET', '/decks'),
  deck: (id: string) => call<Deck>('GET', `/decks/${id}`),
  // Either a pasted decklist or the cards. Unknown names fail with 422 and suggestions (ApiError.body.unknown).
  saveDeck: (d: { id: string; name: string; overwrite?: boolean; owner?: string } & ({ list: string } | { cards: DeckEntry[] })) => call<Deck>('POST', '/decks', d),
  deleteDeck: (id: string) => call<{ path: string }>('DELETE', `/decks/${id}`),
  // undefined when the server isn't running.
  listSessions: () => call<SessionSummary[]>('GET', '/sessions').catch(() => undefined),
  session: (id: string) => call<SessionUpdate>('GET', `/sessions/${id}`),
  renameSession: (id: string, title: string) => call<SessionSummary>('PATCH', `/sessions/${id}`, { title }),
  deleteSession: (id: string) => call<{ deleted: string }>('DELETE', `/sessions/${id}`),
  createSession: (opts: { scenario: string; atStep: number } | { deck: string; opponentDeck?: string; title?: string }) => call<SessionSummary>('POST', '/sessions', opts),
  // The viewer's own moves, so Claude can tell them from its steps.
  applyStep: (id: string, step: Step) => call<{ position: number }>('POST', `/sessions/${id}/steps`, { ...step, author: 'user' }),
  undo: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/undo`, { author: 'user' }),
  next: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/next`),
  answer: (id: string, answer: Answer) => call<SessionSummary>('POST', `/sessions/${id}/prompt/answer`, answer),
  // Rules on for a free-play table, or off again (the same session); off for any other game opens its board on a new table.
  rules: (id: string, on: boolean) => call<SessionSummary>('POST', `/sessions/${id}/rules`, { on }),
  fork: (id: string, atStep: number) => call<SessionSummary>('POST', `/sessions/${id}/fork`, { atStep }),
  createGame: (opts: ({ deck: string; opponentDeck: string } | { scenario: string }) & { bot?: 'random' | 'agent'; claude?: 'p2'; lesson?: boolean; topic?: string; model?: ModelChoice; coach?: boolean; knowsDeck?: boolean; respond?: Respond }) =>
    call<SessionSummary>('POST', '/games', opts),
  answerGame: (id: string, answer: GameAnswer) => call<SessionSummary>('POST', `/sessions/${id}/game/answer`, answer),
  undoGame: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/game/undo`),
  forfeitGame: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/game/forfeit`),
  // Go back to a chance to respond that was passed for you; change when you're asked.
  reopenGame: (id: string, at: number) => call<SessionSummary>('POST', `/sessions/${id}/game/reopen`, { at }),
  gameSettings: (id: string, s: { respond: Respond }) => call<SessionSummary>('POST', `/sessions/${id}/game/settings`, s),
  // Which bots can be played, and the decks the trained one knows.
  opponents: () => call<Opponents>('GET', '/games/opponents').catch((): Opponents => ({ agent: { available: false, decks: [] } })),
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
  // Claude on the home page: one chat per thread.
  homeThreads: () => call<HomeThread[]>('GET', '/home').catch((): HomeThread[] => []),
  homeThread: (id: string) => call<HomeView>('GET', `/home/${id}`),
  startHome: (text: string, model?: ModelChoice) => call<HomeView>('POST', '/home', { text, ...(model && { model }) }),
  askHome: (id: string, text: string) => call<HomeView>('POST', `/home/${id}/chat`, { text }),
  stopHome: (id: string) => call<HomeView>('POST', `/home/${id}/stop`),
  changeHome: (id: string, s: { title?: string; model?: ModelChoice }) => call<HomeView>('PATCH', `/home/${id}`, s),
  deleteHome: (id: string) => call<{ deleted: string }>('DELETE', `/home/${id}`),
  // The scratch pad of ideas in the header.
  ideas: () => call<Idea[]>('GET', '/ideas'),
  addIdea: (text: string, where?: string) => call<Idea[]>('POST', '/ideas', { text, ...(where && { where }) }),
  changeIdea: (id: string, text: string) => call<Idea[]>('PATCH', `/ideas/${id}`, { text }),
  removeIdea: (id: string) => call<Idea[]>('DELETE', `/ideas/${id}`),
  // Reviewing a finished game with Claude; the review arrives over the session's SSE.
  attempt: (id: string, tries: number, model?: ModelChoice) => call<SessionSummary>('POST', `/sessions/${id}/attempt`, { tries, model }),
  startReview: (id: string) => call<ReviewView>('POST', `/sessions/${id}/review`),
  closeReview: (id: string) => call<ReviewView>('POST', `/sessions/${id}/review/close`),
  askReview: (id: string, text: string, position: number) => call<ReviewView>('POST', `/sessions/${id}/review/chat`, { text, position }),
  reviewMoment: (id: string, step: number) => call<ReviewView>('POST', `/sessions/${id}/review/moment`, { step }),
  stopReview: (id: string) => call<ReviewView>('POST', `/sessions/${id}/review/stop`),
  reviewSettings: (id: string, s: { model?: ModelChoice }) => call<ReviewView>('POST', `/sessions/${id}/review/settings`, s),
  clearReview: (id: string) => call<ReviewView>('DELETE', `/sessions/${id}/review`),
}

export type Opponents = { agent: { available: boolean; reason?: string; decks: string[] } }
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
