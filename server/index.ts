// The local API. Binds to 127.0.0.1 only: it can write files in this repo
// (and fetch cards from YGOPRODeck into it).
import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createApp, WAIT_MAX_S } from './app'
import { claudeAccount, sdkAgent, type ClaudeAccount } from './claude/agent'
import { chainMessage, parseAdvice, sdkQuick } from './claude/respond'
import { ClaudeService, diskClaudeStore } from './claude/service'
import { TutorService, type TutorRecord } from './claude/tutor'
import { ReviewService, type ReviewRecord } from './claude/review'
import type { Character } from '../src/scenarios/schema'
import { buildDeck } from './decks'
import { diskStore, removeRepoFile, repoContext, ROOT, writeRepoFile } from './files'
import { GameService } from './games'
import { loadOcg, ocgDataDir } from './ocg/lib'
import { SessionService } from './sessions'
import { addCards, getJson, trim, type ApiCard } from './ygoprodeck'

const port = Number(process.env.API_PORT ?? 5181)
const ctx = repoContext()
const sessions = new SessionService(ctx, diskStore(join(ROOT, 'sessions')))
const games = new GameService(sessions, ctx, () => loadOcg(join(ROOT, ocgDataDir())))
void games.recordResults()

// Prompts are read per run, so edits apply to the next one.
const prompt = (name: string) => readFileSync(join(ROOT, 'prompts', `${name}.md`), 'utf8')
const service: ClaudeService = new ClaudeService({
  games,
  sessions,
  db: () => ctx().db,
  agent: sdkAgent,
  system: ({ coach, character, lesson, watch }) =>
    lesson
      ? prompt('lesson')
      : watch
        ? prompt('advisor')
        : [prompt('game'), coach && prompt('coach'), character && prompt('persona').replace(/\{(\w+)\}/g, (_, k: keyof Character) => character[k])]
          .filter(Boolean)
          .join('\n\n'),
  store: diskClaudeStore(join(ROOT, 'sessions', 'claude')),
  // Notes on a deck are a file of your own beside the sessions, one line per note.
  notes: {
    read: (deck) => (existsSync(join(ROOT, 'sessions', 'notes', `${deck}.md`)) ? readFileSync(join(ROOT, 'sessions', 'notes', `${deck}.md`), 'utf8') : ''),
    add: (deck, text) => {
      mkdirSync(join(ROOT, 'sessions', 'notes'), { recursive: true })
      appendFileSync(join(ROOT, 'sessions', 'notes', `${deck}.md`), `- ${text.replace(/\s+/g, ' ').trim()}\n`)
    },
  },
  rules: () => prompt('rules'),
  saveDeck: (name, main, extra, from) => {
    const taken = ctx().decks
    let id = `${from}-suggested`
    for (let n = 2; taken[id]; n++) id = `${from}-suggested-${n}`
    const built = buildDeck(id, name, [...main, ...extra], ctx().db)
    if (built.unknown.length) throw new Error(`unknown cards: ${built.unknown.join(', ')} (only cards this app has can go in)`)
    writeRepoFile()('decks', built.file, false)
    return id
  },
  findCards: (query) => getJson<{ data?: ApiCard[] }>(`cardinfo.php?fname=${encodeURIComponent(query)}&num=15&offset=0`).then((r) => (r.data ?? []).map(trim)),
  // The latest misplays reviews marked in your games with a deck.
  misplays: (deck): string[] =>
    sessions
      .list()
      .filter((s) => s.players.p1.deck === deck)
      .flatMap((s) => review.misplays(s.id))
      .slice(0, 8),
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

const app = createApp({
  sessions,
  ctx,
  games,
  claude: { service, account: checkAccount },
  tutor,
  review,
  writeFile: writeRepoFile(),
  removeFile: removeRepoFile(),
  addCards: (names) => addCards(names, ROOT),
})

// Node's default 5-minute request timeout would cut long-polls (/wait) short.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port, serverOptions: { requestTimeout: (WAIT_MAX_S + 60) * 1000 } }, (info) => {
  console.log(`Duel Table API on http://127.0.0.1:${info.port}/api (spec: /api/openapi.json)`)
})
