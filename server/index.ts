// The local API. Binds to 127.0.0.1 only: it can write files in this repo
// (and fetch cards from YGOPRODeck into it).
import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Idea } from '../src/api/ideas'
import { createApp, WAIT_MAX_S } from './app'
import { claudeAccount, sdkAgent, type ClaudeAccount } from './claude/agent'
import { chainMessage, parseAdvice, sdkQuick } from './claude/respond'
import { ClaudeService, diskClaudeStore } from './claude/service'
import { TutorService, type TutorRecord } from './claude/tutor'
import { ReviewService, type ReviewRecord } from './claude/review'
import { HomeService, type HomeRecord } from './claude/home'
import type { Character } from '../src/scenarios/schema'
import { buildDeck } from './decks'
import { deckOwner, diskStore, removeRepoFile, repoContext, ROOT, writeRepoFile } from './files'
import { GameService } from './games'
import { loadOcg, ocgDataDir } from './ocg/lib'
import { SessionService } from './sessions'
import { acting, AccountService, diskAccounts } from './accounts'
import { diskInvites, InviteService } from './invites'
import { diskTables, TableService } from './table'
import { addCards, getJson, trim, type ApiCard } from './ygoprodeck'

const port = Number(process.env.API_PORT ?? 5181)
const ctx = repoContext()
const sessions = new SessionService(ctx, diskStore(join(ROOT, 'sessions')))
const games = new GameService(sessions, ctx, () => loadOcg(join(ROOT, ocgDataDir())))
void games.recordResults()

// Prompts are read per run, so edits apply to the next one.
const prompt = (name: string) => readFileSync(join(ROOT, 'prompts', `${name}.md`), 'utf8')

type Entry = { name: string; count: number }
// A deck with every card looked up, downloading the ones the app doesn't have yet.
const draftDeck = async (id: string, name: string, main: Entry[], extra: Entry[]) => {
  const missing = [...main, ...extra].filter((e) => !ctx().db.byName(e.name)).map((e) => e.name)
  const fetched = missing.length ? await addCards(missing, ROOT) : undefined
  const built = buildDeck(id, name, [...main, ...extra], ctx().db)
  if (built.unknown.length) {
    const close = (n: string) => fetched?.unknown.find((u) => u.name === n)?.suggestions ?? ctx().db.closeMatches(n, 5)
    throw new Error(`no such card${built.unknown.length > 1 ? 's' : ''}: ${built.unknown.map((n) => `${n}${close(n).length ? ` (did you mean ${close(n).join(' / ')}?)` : ''}`).join('; ')}`)
  }
  return built.file
}
// Decks Claude saves are kept with whoever asked: decks/ for the admin.
const keeper = () => [acting.getStore()].find((id) => id && id !== accounts?.adminId)

// Saved to decks/ under the first free id from the one given.
const saveDeck = async (base: string, name: string, main: Entry[], extra: Entry[]) => {
  const taken = ctx().decks
  let id = base
  for (let n = 2; taken[id]; n++) id = `${base}-${n}`
  writeRepoFile()('decks', await draftDeck(id, name, main, extra), false, keeper())
  return id
}
const findCards = (query: string) => getJson<{ data?: ApiCard[] }>(`cardinfo.php?fname=${encodeURIComponent(query)}&num=30&offset=0`).then((r) => (r.data ?? []).map(trim))
// The latest misplays reviews marked in your games with a deck.
const misplays = (deck: string): string[] =>
  sessions
    .list()
    .filter((s) => s.players.p1.deck === deck)
    .flatMap((s) => review.misplays(s.id))
    .slice(0, 8)
const service: ClaudeService = new ClaudeService({
  games,
  sessions,
  db: () => ctx().db,
  agent: sdkAgent,
  system: ({ coach, character, lesson, watch, attempt }) =>
    lesson
      ? prompt('lesson')
      : attempt
        ? prompt('attempt')
        : watch
        ? prompt('advisor')
        : [prompt('game'), coach && prompt('coach'), character && prompt('persona').replace(/\{(\w+)\}/g, (_, k: keyof Character) => character[k])]
          .filter(Boolean)
          .join('\n\n'),
  store: diskClaudeStore(join(ROOT, 'sessions', 'claude')),
  // Notes on a deck are a file of your own beside the sessions, one line per note.
  notes: {
    read: (deck) => notesOn(deck),
    add: (deck, text) => {
      mkdirSync(join(ROOT, 'sessions', 'notes'), { recursive: true })
      appendFileSync(join(ROOT, 'sessions', 'notes', `${deck}.md`), `- ${text.replace(/\s+/g, ' ').trim()}\n`)
    },
  },
  rules: () => prompt('rules'),
  saveDeck: (name, main, extra, from) => saveDeck(`${from}-suggested`, name, main, extra),
  findCards,
  misplays,
})

// Claude's view of a chance to respond, for the response levels that ask it.
// Without a login the person is simply asked.
games.adviser = async (id, player, question) => {
  if (!(await checkAccount())) return undefined
  const { state } = sessions.get(id)
  const labels = sessions.export(id).steps.flatMap((s) => (s.label ? [s.label] : []))
  return parseAdvice(await sdkQuick(prompt('respond'), chainMessage(question, state, player, labels, ctx().db)))
}

const tutor = new TutorService({
  ctx,
  agent: sdkAgent,
  system: () => prompt('tutor'),
  store: diskClaudeStore<TutorRecord>(join(ROOT, 'sessions', 'tutor')),
})

const review: ReviewService = new ReviewService({
  sessions,
  db: () => ctx().db,
  agent: sdkAgent,
  system: () => prompt('review'),
  played: (id) => service.played(id),
  store: diskClaudeStore<ReviewRecord>(join(ROOT, 'sessions', 'review')),
  rules: () => prompt('rules'),
  findCards,
})

const notesOn = (deck: string) => (existsSync(join(ROOT, 'sessions', 'notes', `${deck}.md`)) ? readFileSync(join(ROOT, 'sessions', 'notes', `${deck}.md`), 'utf8') : '')
const home = new HomeService({
  ctx,
  sessions,
  games,
  agent: sdkAgent,
  system: () => prompt('home'),
  store: diskClaudeStore<HomeRecord>(join(ROOT, 'sessions', 'home')),
  notes: notesOn,
  rules: () => prompt('rules'),
  findCards,
  saveDeck,
  draftDeck,
  needCards: async (names) => {
    const missing = names.filter((n) => !ctx().db.byName(n))
    if (missing.length) await addCards(missing, ROOT)
  },
  misplays,
})

// Checked once at startup (it takes a few seconds), and again when asked if
// there was no login, in case you've logged in since.
let account: { at: number; found: Promise<ClaudeAccount | undefined>; none?: boolean } | undefined
const checkAccount = () => {
  if (!account || (account.none && Date.now() - account.at > 30_000)) {
    const check = { at: Date.now(), found: claudeAccount() }
    void check.found.then((a) => Object.assign(check, { none: !a }))
    account = check
  }
  return account.found
}
void checkAccount()

// The header's scratch pad of ideas, in a file to read through later.
const IDEAS = join(ROOT, 'sessions', 'ideas.json')
const ideas = {
  list: (): Idea[] => (existsSync(IDEAS) ? JSON.parse(readFileSync(IDEAS, 'utf8')) : []),
  save: (all: Idea[]) => {
    mkdirSync(join(ROOT, 'sessions'), { recursive: true })
    writeFileSync(IDEAS, `${JSON.stringify(all, null, 2)}\n`)
  },
}

// Accounts, unless turned off (then anyone can change anything, as before).
// The admin is made on the first start, and its first sign-in link printed.
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:5180'
const accounts = process.env.DUEL_ACCOUNTS === 'off' ? undefined : new AccountService(diskAccounts(join(ROOT, 'sessions', 'accounts.json')))
const adminKey = accounts?.ensureAdmin(process.env.DUEL_ADMIN ?? 'olly')
if (adminKey) console.log(`Made the admin account. Sign in by opening ${PUBLIC_URL}/?signin=${adminKey}`)

const app = createApp({
  accounts,
  deckOwner: deckOwner(),
  invites: new InviteService(diskInvites(join(ROOT, 'sessions', 'invites.json'))),
  table: new TableService(diskTables(join(ROOT, 'sessions', 'table'))),
  quick: sdkQuick,
  ideas,
  sessions,
  ctx,
  games,
  claude: { service, account: checkAccount },
  tutor,
  review,
  home,
  writeFile: writeRepoFile(),
  removeFile: removeRepoFile(),
  addCards: (names) => addCards(names, ROOT),
})

// Node's default 5-minute request timeout would cut long-polls (/wait) short.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port, serverOptions: { requestTimeout: (WAIT_MAX_S + 60) * 1000 } }, (info) => {
  console.log(`Duel Table API on http://127.0.0.1:${info.port}/api (spec: /api/openapi.json)`)
})
