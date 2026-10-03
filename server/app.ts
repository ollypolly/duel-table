// HTTP transport over the session service. Routes are defined from Zod
// schemas (the same ones scenario files use), which also generates the
// OpenAPI spec at /api/openapi.json.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import type { CardDb } from '../src/data/cardDb'
import { imagePath } from '../src/data/cardDb'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import { parseDeck } from '../src/scenarios/resolve'
import { DeckSchema, StepSchema, type DeckFile } from '../src/scenarios/schema'
import { AnswerSchema, CursorSchema, LessonEventSchema, LessonViewSchema, PromptSchema, RevealSchema } from '../src/api/lesson'
import { ClaudeSettingsSchema, GameAnswerSchema, GameViewSchema, ModelChoiceSchema, RespondSchema } from '../src/api/game'
import { PlayerSchema } from '../src/scenarios/schema'
import type { ClaudeService } from './claude/service'
import type { TutorService } from './claude/tutor'
import { TutorAskSchema, TutorViewSchema } from '../src/api/tutor'
import { MOMENT_KINDS, ReviewChatSchema, ReviewMomentSchema, ReviewViewSchema } from '../src/api/review'
import type { ReviewService } from './claude/review'
import type { HomeService } from './claude/home'
import { HomeAskSchema, HomeThreadSchema, HomeViewSchema } from '../src/api/home'
import type { GameService } from './games'
import { buildDeck, expandDeck, parseDeckList, type DeckEntry } from './decks'
import type { ClaudeAccount } from './claude/agent'
import { IdeaSchema, NewIdeaSchema, type Idea } from '../src/api/ideas'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { AccountSchema, MeSchema, NewAccountSchema, type Account } from '../src/api/accounts'
import { acting, type AccountService } from './accounts'
import { inPlay, InviteService, OPEN_IN_PLAY, seatOf } from './invites'
import { hiddenOf, redactFor, summaryFor } from './redact'
import { EMOJI, SOUNDS, TableService } from './table'
import { PushService, type Notice } from './push'
import type { Quick } from './claude/respond'
import { describeTable } from './claude/view'
import type { SessionView } from './sessions'
import type { Player } from '../src/engine'
import type { RemoveRepoFile, WriteRepoFile } from './files'
import { SessionError, type SessionService } from './sessions'
import type { FetchResult } from './ygoprodeck'

const ErrorSchema = z.object({ error: z.string(), details: z.array(z.string()).optional() })
const IssueSchema = z.object({ severity: z.enum(['error', 'warning']), message: z.string(), action: z.number().optional() })
const SeatSchema = z.object({ name: z.string(), deck: z.string().optional(), deckName: z.string().optional() })
const SummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.number(),
  basedOn: z.string().optional(),
  updatedAt: z.string().openapi({ description: 'When it was last saved (ISO)' }),
  createdAt: z.string().optional().openapi({ description: 'When it began (ISO), where known' }),
  players: z.object({ p1: SeatSchema, p2: SeatSchema }),
  turn: z.number(),
  kind: z.enum(['game', 'board']).openapi({ description: 'A game on the rules engine, or a free board' }),
  winner: z.enum(['p1', 'p2']).optional(),
  claudeLesson: z.literal(true).optional().openapi({ description: 'A lesson Claude ran on the rules engine' }),
  fromTable: z.literal(true).optional().openapi({ description: 'A game carried over from a free-play table' }),
  lessonPlan: z.object({ now: z.int(), of: z.int() }).optional().openapi({ description: "How far a lesson's plan has got: the point it's on of how many, equal once it's done" }),
  opponent: z.enum(['bot', 'trained', 'claude']).optional().openapi({ description: 'Who answers for p2 in a game, if not a person' }),
  reviewed: z
    .object({ scanned: z.boolean(), busy: z.boolean(), moments: z.partialRecord(z.enum(MOMENT_KINDS), z.int()) })
    .optional()
    .openapi({ description: 'It has a review with Claude: whether the first look is done, and the key moments by kind' }),
  owner: z.string().optional().openapi({ description: "The account that made it; missing means the admin's" }),
  seats: z.object({ p1: z.string(), p2: z.string() }).optional().openapi({ description: 'A game against a friend: the account in each seat (yours is p1)' }),
})
const SessionSchema = SummarySchema.extend({
  file: z.unknown().openapi({ description: 'The session as a scenario file' }),
  state: z.unknown().openapi({ description: 'BoardState after the last step (queued ones included)' }),
  lesson: LessonViewSchema,
  game: GameViewSchema.optional().openapi({ description: 'For games on the rules engine' }),
  review: ReviewViewSchema.optional().openapi({ description: 'A review of the game with Claude, while one is open' }),
})
const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) })

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description })
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } } } })
const errors = { 400: json(ErrorSchema, 'Bad request'), 404: json(ErrorSchema, 'Not found'), 422: json(ErrorSchema, "Doesn't resolve") }

// Well under the 10 minutes a tool call can wait.
export const WAIT_DEFAULT_S = 300
export const WAIT_MAX_S = 540

type AppDeps = {
  sessions: SessionService
  ctx: () => ResolveContext
  writeFile?: WriteRepoFile // without it, nothing is written to the repo
  removeFile?: RemoveRepoFile // without it, decks can't be deleted
  addCards?: (names: string[]) => Promise<FetchResult> // without it, unknown cards aren't fetched
  games?: GameService // without it, there are no games on the rules engine
  // Claude as a player; account says whether a Claude login is available.
  claude?: { service: ClaudeService; account: () => Promise<ClaudeAccount | undefined> }
  tutor?: TutorService // Claude answering questions on a lesson
  review?: ReviewService // Claude going back over a finished game with you
  home?: HomeService // Claude on the home page
  ideas?: IdeaStore // the scratch pad in the header (kept in memory without one)
  accounts?: AccountService // without them, anyone can change anything
  deckOwner?: (id: string) => string | undefined // the account a deck belongs to (undefined: the repo's, so the admin's)
  invites?: InviteService // games against a friend (kept in memory without one)
  table?: TableService // a friend game's chat and fun (kept in memory without one)
  quick?: Quick // Claude answering in a friend game's chat; without it, it doesn't
  push?: PushService // notifications with the app closed (kept in memory, and never sent, without one)
}

export type IdeaStore = { list(): Idea[]; save(ideas: Idea[]): void }
const memoryIdeas = (): IdeaStore => {
  let kept: Idea[] = []
  return { list: () => kept, save: (ideas) => void (kept = ideas) }
}

const fail = (status: ConstructorParameters<typeof SessionError>[0], message: string): never => {
  throw new SessionError(status, message)
}

// The browser's sign-in key: HttpOnly, so page scripts never see it.
const KEY_COOKIE = 'duel-key'
// What can be done without signing in: making an account, and signing in or out.
const OPEN = new Set(['/api/accounts', '/api/signin', '/api/signout'])
// Joining a game can make the account as it joins.
const isOpen = (path: string) => OPEN.has(path) || /^\/api\/invites\/[^/]+\/join$/.test(path)

export function createApp({ sessions, ctx, writeFile, removeFile, addCards, games, claude, tutor, review, home, ideas = memoryIdeas(), accounts, deckOwner = () => undefined, invites = new InviteService(), table = new TableService(), quick, push = new PushService() }: AppDeps) {
  const app = new OpenAPIHono<{ Variables: { me?: Account } }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const details = result.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
        return c.json({ error: 'invalid request', details }, 400)
      }
    },
  }).basePath('/api')

  app.onError((err, c) => {
    if (err instanceof SessionError) return c.json({ error: err.message, details: err.details }, err.status)
    return c.json({ error: err.message }, 500)
  })

  const db = (): CardDb => ctx().db

  // Accounts ------------------------------------------------------------------

  // Who's asking. Reading is open to anyone; changing anything needs an
  // account, and a session's things need its owner (or the admin). Whatever
  // the request starts, a Claude run included, acts as that account.
  //
  // A game against a friend that's going is different: whoever asks (its
  // owner and the admin too) only gets the table's own routes, and every
  // view of it is redacted for them (see ./redact.ts). Its players can play
  // it; only its owner can rename or delete it.
  app.use('*', async (c, next) => {
    const me = accounts?.byKey(getCookie(c, KEY_COOKIE))
    c.set('me', me)
    const [, kind, id, rest = ''] = c.req.path.match(/^\/api\/(sessions|home|ideas|decks)\/([^/]+)(\/.*)?$/) ?? []
    const duel = kind === 'sessions' && sessions.has(id) ? sessions.export(id).duel : undefined
    const hiding = inPlay(duel)
    const seated = !!duel?.seats
    if (hiding && !OPEN_IN_PLAY.test(rest)) return c.json({ error: 'not while a game against a friend is going' }, 403)
    if (accounts && c.req.method !== 'GET' && !isOpen(c.req.path)) {
      if (!me) return c.json({ error: 'sign in first' }, 401)
      const playing = !!seatOf(duel, me.id) && rest !== ''
      // Anyone can fork a session: the fork is theirs.
      if (kind && rest !== '/fork' && !playing && !owns(me, ownerOf(kind, id))) return c.json({ error: "that's not yours to change" }, 403)
    }
    await (me ? acting.run(me.id, next) : next())
    if (seated && c.res.headers.get('content-type')?.includes('application/json')) {
      const body = (await c.res.clone().json()) as Partial<SessionView>
      if (body.file && body.state) c.res = new Response(JSON.stringify(viewFor(body as SessionView, me)), { status: c.res.status, headers: c.res.headers })
    }
  })

  // Who has a game against a friend open, by session and account.
  const present = new Map<string, Map<string, number>>()
  // A notification to whoever's in seat, unless they have the game open.
  const tell = (id: string, account: string | undefined, notice: (them: string) => Omit<Notice, 'url'>) => {
    if (!account || present.get(id)?.get(account)) return
    const v = sessions.get(id)
    const seats = v.file.duel?.seats
    const other = seats && (seats.p1 === account ? v.players.p2.name : v.players.p1.name)
    void push.notify(account, { url: `/?session=${id}`, ...notice(other ?? 'your friend') })
  }
  // After a move: whoever is asked next, if it's not who just moved.
  const tellMove = (id: string, mover: Player | undefined) => {
    const { game, file } = sessions.get(id)
    const next = game?.prompt?.player
    if (!file.duel?.seats || !next || next === mover) return
    tell(id, file.duel.seats[next], (them) => ({ title: 'Your move', body: `Your move against ${them}`, tag: `move-${id}` }))
  }
  const nudged = new Map<string, number>()
  const viewFor = (v: SessionView, me?: Account): SessionView => {
    const seats = v.file.duel?.seats
    if (!seats) return v
    const here = present.get(v.id)
    const seat = seatOf(v.file.duel, me?.id)
    const game = v.game && { ...v.game, present: (['p1', 'p2'] as const).filter((p) => here?.get(seats[p])), ...(seat && v.game.responds?.[seat] && { respond: v.game.responds[seat] }) }
    return redactFor({ ...v, ...(game && { game }), table: table.view(v.id, me?.id) }, seat, ctx(), inPlay(v.file.duel))
  }
  const seat = (c: Context, id: string): Player | undefined => seatOf(sessions.export(id).duel, (c.get('me') as Account | undefined)?.id)

  // What owns a thing (missing: the admin, or nothing like it, so there's nothing to check).
  const ownerOf = (kind: string, id: string): string | null | undefined => {
    if (kind === 'sessions') return sessions.has(id) ? sessions.owner(id) : null
    if (kind === 'decks') return ctx().decks[id] ? deckOwner(id) : null
    if (kind === 'ideas') return ideas.list().find((i) => i.id === id)?.owner ?? (ideas.list().some((i) => i.id === id) ? undefined : null)
    try {
      return home?.owner(id) ?? undefined
    } catch {
      return null
    }
  }
  // null is something that doesn't exist: the route says so.
  const owns = (me: Account | undefined, owner: string | null | undefined) => !accounts || owner === null || !!me?.admin || (owner ?? accounts.adminId) === me?.id

  const signIn = (c: Context, key: string) => setCookie(c, KEY_COOKIE, key, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 400 * 24 * 3600 })
  const needAccounts = () => accounts ?? fail(400, 'this server has no accounts')
  const meOr401 = (c: Context) => (c.get('me') as Account | undefined) ?? fail(401, 'sign in first')
  const meResponse = { 200: json(MeSchema, 'Whether there are accounts, and who you are'), ...errors }

  app.openapi(createRoute({ method: 'get', path: '/me', summary: "Who's signed in", responses: meResponse }), (c) => {
    // Browsers keep a cookie 400 days at most: each visit starts that again.
    const me = c.get('me')
    if (me) signIn(c, getCookie(c, KEY_COOKIE)!)
    return c.json({ accounts: !!accounts, ...(me && { me }) }, 200)
  })

  app.openapi(createRoute({ method: 'get', path: '/accounts', summary: "Everyone's accounts", responses: { 200: json(z.array(AccountSchema), 'Accounts') } }), (c) =>
    c.json(accounts?.list() ?? [], 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/accounts',
      summary: 'Make an account, and sign this browser in as it',
      request: body(NewAccountSchema),
      responses: { 201: json(AccountSchema, 'The new account'), 409: json(ErrorSchema, 'The username is taken, or this browser is signed in'), ...errors },
    }),
    (c) => {
      if (c.get('me')) fail(409, `already signed in as ${c.get('me')!.username}`)
      const { account, key } = needAccounts().create(c.req.valid('json'))
      signIn(c, key)
      return c.json(account, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/signin',
      summary: 'Sign this browser in with a key',
      request: body(z.object({ key: z.string().min(1) }).strict()),
      responses: { 200: json(AccountSchema, 'The account'), 401: json(ErrorSchema, 'No account has that key'), ...errors },
    }),
    (c) => {
      const { key } = c.req.valid('json')
      const account = needAccounts().byKey(key) ?? fail(401, "that sign-in link doesn't work any more")
      signIn(c, key)
      return c.json(account, 200)
    },
  )

  app.openapi(createRoute({ method: 'post', path: '/signout', summary: 'Sign this browser out', responses: meResponse }), (c) => {
    deleteCookie(c, KEY_COOKIE, { path: '/' })
    return c.json({ accounts: !!accounts }, 200)
  })

  const keyResponse = { 201: json(z.object({ key: z.string() }), 'A new sign-in key, shown once'), ...errors }
  app.openapi(createRoute({ method: 'post', path: '/me/keys', summary: 'A sign-in key for another device', responses: keyResponse }), (c) =>
    c.json({ key: needAccounts().addKey(meOr401(c).id) }, 201),
  )

  // The admin's, for someone who's lost every device.
  app.openapi(createRoute({ method: 'post', path: '/accounts/{id}/keys', summary: 'A new sign-in key for an account (admin)', request: { params: IdParam }, responses: keyResponse }), (c) => {
    if (!meOr401(c).admin) fail(403, 'only the admin can do that')
    return c.json({ key: needAccounts().addKey(c.req.valid('param').id) }, 201)
  })

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/accounts/{id}',
      summary: "Change an account's username or name (its own, or the admin)",
      request: { params: IdParam, ...body(NewAccountSchema.partial()) },
      responses: { 200: json(AccountSchema, 'The account'), 409: json(ErrorSchema, 'The username is taken'), ...errors },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const me = meOr401(c)
      if (me.id !== id && !me.admin) fail(403, "that's not yours to change")
      return c.json(needAccounts().update(id, c.req.valid('json')), 200)
    },
  )

  app.openapi(
    createRoute({ method: 'delete', path: '/accounts/{id}', summary: 'Remove an account (admin)', request: { params: IdParam }, responses: { 200: json(z.object({ deleted: z.string() }), 'Removed'), ...errors } }),
    (c) => {
      if (!meOr401(c).admin) fail(403, 'only the admin can do that')
      const { id } = c.req.valid('param')
      needAccounts().remove(id)
      return c.json({ deleted: id }, 200)
    },
  )

  // Scenarios -----------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'get',
      path: '/scenarios',
      summary: 'List scenarios',
      responses: {
        200: json(z.array(z.object({ id: z.string(), title: z.string().optional(), steps: z.number().optional(), errors: z.array(z.string()).optional() })), 'Scenarios'),
      },
    }),
    (c) => {
      const context = ctx()
      return c.json(
        Object.values(context.scenarios).map((raw) => {
          const r = resolveScenario(raw, context)
          return r.ok ? { id: r.scenario.id, title: r.scenario.title, steps: r.scenario.game.steps.length } : { id: r.id, errors: r.errors }
        }),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/scenarios/{id}',
      summary: 'A resolved scenario: its file, every step and any warnings',
      request: { params: IdParam },
      responses: {
        200: json(z.object({ id: z.string(), title: z.string(), steps: z.array(StepSchema), warnings: z.array(z.string()), file: z.unknown() }), 'Scenario'),
        ...errors,
      },
    }),
    (c) => {
      const context = ctx()
      const raw = context.scenarios[c.req.valid('param').id]
      if (!raw) return c.json({ error: `no scenario "${c.req.valid('param').id}"` }, 404)
      const r = resolveScenario(raw, context)
      if (!r.ok) return c.json({ error: `scenario ${r.id} doesn't load`, details: r.errors }, 422)
      const s = r.scenario
      return c.json({ id: s.id, title: s.title, steps: s.game.steps, warnings: s.warnings, file: s.file }, 200)
    },
  )

  // Cards ---------------------------------------------------------------------

  const card = (id: number) => {
    const d = db().byId(id)
    return d && { ...d, image: imagePath(id, 'full') }
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/cards',
      summary: 'Look a card up by name (case and punctuation insensitive)',
      request: { query: z.object({ name: z.string().min(1) }) },
      responses: { 200: json(z.unknown(), 'The card'), 404: json(ErrorSchema.extend({ suggestions: z.array(z.string()) }), 'Unknown name') },
    }),
    (c) => {
      const { name } = c.req.valid('query')
      const found = db().byName(name)
      if (found) return c.json(card(found.id), 200)
      return c.json({ error: `no card named "${name}" in data/cards.json`, suggestions: db().closeMatches(name) }, 404)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/cards/{id}',
      summary: 'Look a card up by passcode',
      request: {
        params: z.object({
          id: z.coerce
            .number()
            .int()
            .openapi({ param: { name: 'id', in: 'path' } }),
        }),
      },
      responses: { 200: json(z.unknown(), 'The card'), 404: json(ErrorSchema, 'Unknown passcode') },
    }),
    (c) => {
      const found = card(c.req.valid('param').id)
      return found ? c.json(found, 200) : c.json({ error: `no card ${c.req.valid('param').id}` }, 404)
    },
  )

  // Games against a friend -----------------------------------------------------

  const InviteSchema = z.object({
    code: z.string(),
    from: AccountSchema,
    deck: z.object({ id: z.string(), name: z.string() }),
    session: z.string().optional().openapi({ description: 'The game, once someone has joined' }),
    yours: z.boolean().openapi({ description: 'You sent it' }),
    playing: z.boolean().openapi({ description: "You're in the game" }),
  })
  const inviteView = (code: string, me?: Account) => {
    const i = invites.get(code)
    const raw = ctx().decks[i.deck] as { name?: string } | undefined
    const from = accounts?.byId(i.owner) ?? { id: i.owner, username: 'someone', name: 'Someone' }
    const playing = !!i.session && sessions.has(i.session) && !!seatOf(sessions.export(i.session).duel, me?.id)
    return { code, from, deck: { id: i.deck, name: raw?.name ?? i.deck }, ...(i.session && { session: i.session }), yours: i.owner === me?.id, playing }
  }
  const inviteResponse = { 200: json(InviteSchema, 'The invite'), ...errors }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/invites',
      summary: 'Invite a friend to a game: a code for a link to send',
      request: body(z.object({ deck: z.string(), respond: RespondSchema.optional() }).strict()),
      responses: { 201: json(InviteSchema, 'The invite'), ...errors },
    }),
    (c) => {
      const me = meOr401(c)
      const { deck, respond } = c.req.valid('json')
      if (!ctx().decks[deck]) fail(404, `no deck "${deck}"`)
      return c.json(inviteView(invites.create(me.id, deck, respond).code, me), 201)
    },
  )

  app.openapi(createRoute({ method: 'get', path: '/invites', summary: 'Your invites nobody has joined yet', responses: { 200: json(z.array(InviteSchema), 'Invites') } }), (c) => {
    const me = c.get('me')
    return c.json(
      invites
        .list()
        .filter((i) => !i.session && (accounts ? i.owner === me?.id : true))
        .map((i) => inviteView(i.code, me)),
      200,
    )
  })

  app.openapi(createRoute({ method: 'get', path: '/invites/{code}', summary: 'An invite: who from, their deck, and the game once joined', request: { params: z.object({ code: z.string().openapi({ param: { name: 'code', in: 'path' } }) }) }, responses: inviteResponse }), (c) =>
    c.json(inviteView(c.req.valid('param').code, c.get('me')), 200),
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/invites/{code}',
      summary: 'Cancel an invite nobody has joined',
      request: { params: z.object({ code: z.string().openapi({ param: { name: 'code', in: 'path' } }) }) },
      responses: { 200: json(z.object({ deleted: z.string() }), 'Cancelled'), ...errors },
    }),
    (c) => {
      const { code } = c.req.valid('param')
      if (!owns(c.get('me'), invites.get(code).owner)) fail(403, "that's not yours to cancel")
      invites.remove(code)
      return c.json({ deleted: code }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/invites/{code}/join',
      summary: 'Join a game you were invited to, with a deck (making your account first, if you have none)',
      description: 'A coin flip decides who goes first (p1). The game belongs to whoever sent the invite; both players can play it.',
      request: {
        params: z.object({ code: z.string().openapi({ param: { name: 'code', in: 'path' } }) }),
        ...body(z.object({ deck: z.string(), respond: RespondSchema.optional(), account: NewAccountSchema.optional() }).strict()),
      },
      responses: { 200: json(InviteSchema, 'The invite, with its game'), 409: json(ErrorSchema, 'Someone else has joined'), ...errors },
    }),
    async (c) => {
      const { code } = c.req.valid('param')
      const { deck, respond, account } = c.req.valid('json')
      const invite = invites.get(code)
      let me = c.get('me')
      if (invite.session) {
        if (inviteView(code, me).playing) return c.json(inviteView(code, me), 200)
        fail(409, 'someone has already joined that game')
      }
      if (!ctx().decks[deck]) fail(404, `no deck "${deck}"`)
      if (!games) fail(400, 'the rules engine is not set up here')
      if (!me && account && accounts) {
        const made = accounts.create(account)
        signIn(c, made.key)
        me = made.account
      }
      if (!me) fail(401, 'sign in first')
      if (me!.id === invite.owner) fail(409, "that's your own invite: send the link to a friend")
      const host = accounts?.byId(invite.owner)
      const hostFirst = Math.random() < 0.5
      const [p1, p2] = hostFirst ? [invite.owner, me!.id] : [me!.id, invite.owner]
      const name = (id: string) => (id === me!.id ? me!.name : (host?.name ?? 'Friend'))
      const deckOf = (id: string) => (id === me!.id ? deck : invite.deck)
      const respondOf = (id: string) => (id === me!.id ? respond : invite.respond)
      const responds = Object.fromEntries((['p1', 'p2'] as const).flatMap((p) => (respondOf(p === 'p1' ? p1 : p2) ? [[p, respondOf(p === 'p1' ? p1 : p2)]] : [])))
      // The game is the host's.
      const view = await acting.run(invite.owner, () =>
        games!.create({ deck: deckOf(p1), opponentDeck: deckOf(p2), bots: [], seats: { p1, p2 }, names: { p1: name(p1), p2: name(p2) }, responds, title: `${host?.name ?? 'Friend'} vs ${me!.name}` }),
      )
      invites.joined(code, view.id)
      void push.notify(invite.owner, { title: `${me!.name} joined`, body: `${me!.name} joined your game. ${hostFirst ? 'You go first' : 'They go first'}.`, url: `/?session=${view.id}`, tag: `move-${view.id}` })
      return c.json(inviteView(code, me), 200)
    },
  )

  // Decks ---------------------------------------------------------------------

  const DeckCardSchema = z.object({ count: z.number(), name: z.string() }).passthrough().openapi({ description: 'count plus the card data (id is the passcode)' })
  const ExpandedDeckSchema = z.object({
    id: z.string(),
    name: z.string(),
    size: z.object({ main: z.number(), extra: z.number() }),
    main: z.array(DeckCardSchema),
    extra: z.array(DeckCardSchema),
    warnings: z.array(z.string()),
  })

  // Scenarios whose players use a deck: editing it may break their steps.
  const usedBy = (context: ResolveContext, id: string) =>
    Object.entries(context.scenarios).flatMap(([sid, raw]) => {
      // A player with its own copy of the list doesn't follow the deck file.
      const players = (raw as { players?: Record<string, { deck?: string; list?: unknown }> }).players ?? {}
      return Object.values(players).some((p) => p?.deck === id && !p.list) ? [sid] : []
    })

  app.openapi(
    createRoute({
      method: 'get',
      path: '/decks',
      summary: 'List decks',
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              name: z.string().optional(),
              size: z.object({ main: z.number(), extra: z.number() }).optional(),
              usedBy: z.array(z.string()).openapi({ description: 'Scenarios that use this deck' }),
              owner: z.string().optional().openapi({ description: 'The account it belongs to' }),
              errors: z.array(z.string()).optional(),
            }),
          ),
          'Decks',
        ),
      },
    }),
    (c) => {
      const context = ctx()
      return c.json(
        Object.entries(context.decks).map(([id, raw]) => {
          const owner = deckOwner(id) ?? accounts?.adminId
          try {
            const d = expandDeck(parseDeck(raw, `deck ${id}`), context.db)
            return { id: d.id, name: d.name, size: d.size, usedBy: usedBy(context, id), ...(owner && { owner }) }
          } catch (e) {
            return { id, usedBy: usedBy(context, id), ...(owner && { owner }), errors: [e instanceof Error ? e.message : String(e)] }
          }
        }),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/decks/{id}',
      summary: "A deck with every card's text and stats",
      request: { params: IdParam },
      responses: { 200: json(ExpandedDeckSchema.extend({ usedBy: z.array(z.string()) }), 'The deck'), ...errors },
    }),
    (c) => {
      const context = ctx()
      const { id } = c.req.valid('param')
      const raw = context.decks[id]
      if (!raw) return c.json({ error: `no deck "${id}"`, details: [`known: ${Object.keys(context.decks).join(', ') || 'none'}`] }, 404)
      try {
        return c.json({ ...expandDeck(parseDeck(raw, `deck ${id}`), context.db), usedBy: usedBy(context, id) }, 200)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 422)
      }
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/decks',
      summary: 'Create a deck from a decklist and save it to decks/<id>.json',
      description:
        'Give either list (pasted text, one card per line, e.g. "3 Ash Blossom & Joyous Spring") or cards. Extra Deck cards are sorted out by type. Cards missing from the local DB are fetched from YGOPRODeck unless fetch is false; names that match no real card fail with 422 and suggestions.',
      request: body(
        z
          .object({
            id: DeckSchema.shape.id,
            name: z.string().min(1),
            list: z.string().optional(),
            cards: z.array(z.object({ name: z.string().min(1), count: z.int().min(1) }).strict()).optional(),
            fetch: z.boolean().optional(),
            overwrite: z.boolean().optional(),
            owner: z.string().optional().openapi({ description: 'The account to save it for (the admin only; default: yours)' }),
          })
          .strict()
          .refine((b) => !!b.list !== !!b.cards, { message: 'give either list or cards' }),
      ),
      responses: {
        201: json(ExpandedDeckSchema.extend({ path: z.string().optional(), fetched: z.array(z.string()), skipped: z.array(z.string()) }), 'The saved deck'),
        409: json(ErrorSchema, 'Deck exists'),
        422: json(ErrorSchema.extend({ unknown: z.array(z.object({ name: z.string(), suggestions: z.array(z.string()) })) }), 'Unknown card names'),
        400: json(ErrorSchema, 'Bad request'),
      },
    }),
    async (c) => {
      const { id, name, list, cards, fetch = true, overwrite = false, owner } = c.req.valid('json')
      if (ctx().decks[id] && !overwrite) return c.json({ error: `decks/${id}.json already exists (pass overwrite: true to replace it)` }, 409)
      const me = c.get('me')
      if (ctx().decks[id] && !owns(me, deckOwner(id))) fail(403, "that deck isn't yours to change")
      if (owner && accounts && !me?.admin) fail(403, 'only the admin can save a deck for someone else')
      if (owner && accounts && !accounts.byId(owner)) fail(404, `no account ${owner}`)
      // The admin's decks are the repo's; anyone else's are kept apart.
      const keeper = [owner ?? me?.id].find((o) => o && o !== accounts?.adminId)
      const { entries, skipped }: { entries: DeckEntry[]; skipped: string[] } = list ? parseDeckList(list) : { entries: cards!, skipped: [] }
      if (entries.length === 0) return c.json({ error: 'no cards in the list' }, 400)

      let missing = entries.filter((e) => !ctx().db.byName(e.name)).map((e) => e.name)
      let fetched: string[] = []
      let suggestions: Record<string, string[]> = {}
      if (missing.length && fetch && addCards) {
        const r = await addCards(missing)
        fetched = r.added.map((card) => card.name)
        suggestions = Object.fromEntries(r.unknown.map((u) => [u.name, u.suggestions]))
      }
      const db = ctx().db
      const built = buildDeck(id, name, entries, db, overwrite ? (ctx().decks[id] as DeckFile | undefined)?.character : undefined)
      missing = built.unknown
      if (missing.length) {
        const unknown = missing.map((n) => ({ name: n, suggestions: suggestions[n] ?? db.closeMatches(n, 5) }))
        return c.json({ error: `unknown card${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, unknown }, 422)
      }
      const path = writeFile?.('decks', built.file, overwrite, keeper)
      return c.json({ ...expandDeck(built.file, db), ...(path && { path }), fetched, skipped }, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/decks/{id}',
      summary: 'Delete a deck file',
      description: "Refused while a scenario uses the deck, since the scenario wouldn't load without it.",
      request: { params: IdParam },
      responses: { 200: json(z.object({ path: z.string() }), 'Deleted'), 409: json(ErrorSchema, 'In use'), ...errors },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const context = ctx()
      if (!context.decks[id]) return c.json({ error: `no deck "${id}"` }, 404)
      const users = usedBy(context, id)
      if (users.length) return c.json({ error: `"${id}" is used by ${users.join(', ')}`, details: users }, 409)
      if (!removeFile) return c.json({ error: 'decks are read-only here' }, 400)
      return c.json({ path: removeFile('decks', id) }, 200)
    },
  )

  // Sessions ------------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions',
      summary: 'Create a session from a scenario position, or from decks',
      description: 'atStep is a position: 0 is the setup, n is after step n. It defaults to the end of the scenario.',
      request: body(
        z
          .object({
            scenario: z.string().optional(),
            atStep: z.int().min(0).optional(),
            deck: z.string().optional(),
            opponentDeck: z.string().optional(),
            seed: z.int().optional(),
            title: z.string().optional(),
          })
          .strict(),
      ),
      responses: { 201: json(SessionSchema, 'The new session'), ...errors },
    }),
    (c) => c.json(sessions.create(c.req.valid('json')), 201),
  )

  app.openapi(createRoute({ method: 'get', path: '/sessions', summary: 'List sessions', responses: { 200: json(z.array(SummarySchema), 'Sessions') } }), (c) =>
    c.json(
      sessions.list().map((s) => summaryFor(s, (c.get('me') as Account | undefined)?.id)),
      200,
    ),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/sessions/{id}',
      summary: 'A session: its log (as a scenario file) and current state',
      request: { params: IdParam },
      responses: { 200: json(SessionSchema, 'The session'), ...errors },
    }),
    (c) => c.json(sessions.get(c.req.valid('param').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/sessions/{id}',
      summary: 'Rename a session',
      request: { params: IdParam, ...body(z.object({ title: z.string().trim().min(1) }).strict()) },
      responses: { 200: json(SessionSchema, 'The renamed session'), ...errors },
    }),
    (c) => c.json(sessions.rename(c.req.valid('param').id, c.req.valid('json').title), 200),
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/sessions/{id}',
      summary: 'Delete a session, with its game and Claude chat',
      description: '409 if another session starts from this one (details lists them).',
      request: { params: IdParam },
      responses: { 200: json(z.object({ deleted: z.string() }), 'Deleted'), 409: json(ErrorSchema, 'Other sessions start from it'), ...errors },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      sessions.remove(id)
      return c.json({ deleted: id }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/steps',
      summary: 'Apply a step',
      description:
        'Checked with tableRules first. Errors (physically impossible moves) always reject; warnings only reject with strict: true. reveal paces it: omitted shows it at once, {afterMs} after a delay, "onNext" when the viewer clicks Next. Queued steps show in order.',
      request: { params: IdParam, ...body(StepSchema.extend({ strict: z.boolean().optional(), reveal: RevealSchema.optional() })) },
      responses: {
        200: json(z.object({ state: z.unknown(), events: z.array(z.unknown()), issues: z.array(IssueSchema), position: z.number(), revealed: z.number() }), 'Applied'),
        422: json(z.object({ error: z.string(), issues: z.array(IssueSchema) }), 'Rejected'),
        404: json(ErrorSchema, 'Not found'),
        409: json(ErrorSchema, 'A viewer step while steps are queued'),
      },
    }),
    (c) => {
      const { strict, reveal, ...step } = c.req.valid('json')
      const r = sessions.apply(c.req.valid('param').id, step, { strict, reveal })
      if (!r.ok) return c.json({ error: 'step rejected', issues: r.issues }, 422)
      return c.json({ state: r.state, events: r.events, issues: r.issues, position: r.position, revealed: r.revealed }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/undo',
      summary: 'Drop the last step (a queued one first)',
      request: {
        params: IdParam,
        body: { content: { 'application/json': { schema: z.object({ author: z.enum(['user', 'claude']).optional() }).strict() } }, required: false },
      },
      responses: { 200: json(SessionSchema, 'The session'), 409: json(ErrorSchema, 'Nothing to undo'), ...errors },
    }),
    async (c) => {
      const { author } = (await c.req.json().catch(() => ({}))) as { author?: string }
      return c.json(sessions.undo(c.req.valid('param').id, { byUser: author === 'user' }), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/fork',
      summary: 'A new session from this one at a position (default: its end)',
      request: { params: IdParam, ...body(z.object({ atStep: z.int().min(0).optional() }).strict()) },
      responses: { 201: json(SessionSchema, 'The new session'), ...errors },
    }),
    (c) => c.json(sessions.fork(c.req.valid('param').id, c.req.valid('json').atStep), 201),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/rules',
      summary: 'Turn the rules on for a free-play table, or off for a game',
      description:
        'on: a free-play table carries on under the rules engine from the board as it lies, against the simple bot, on your turn in Main Phase 1. It stays the same session. off: a table with the rules on goes back to moving freely, from where the game stands; any other game is left as it was and its board opens on a new table.',
      request: { params: IdParam, ...body(z.object({ on: z.boolean() }).strict()) },
      responses: { 201: json(SessionSchema, 'The session it is now'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      return c.json(c.req.valid('json').on ? await games.fromTable(id) : games.toTable(id), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/export',
      summary: 'The session as a scenario file; with write: true, also saved to scenarios/<id>.json',
      request: {
        params: IdParam,
        ...body(
          z
            .object({
              id: z
                .string()
                .regex(/^[a-z0-9-]+$/)
                .optional(),
              title: z.string().optional(),
              write: z.boolean().optional(),
              overwrite: z.boolean().optional(),
            })
            .strict(),
        ),
      },
      responses: { 200: json(z.object({ file: z.unknown(), path: z.string().optional() }), 'Exported'), ...errors, 409: json(ErrorSchema, 'File exists') },
    }),
    (c) => {
      const { write, overwrite = false, ...as } = c.req.valid('json')
      const file = sessions.export(c.req.valid('param').id, as)
      if (write && accounts && !c.get('me')?.admin) fail(403, 'only the admin can save scenarios')
      if (!write || !writeFile) return c.json({ file }, 200)
      try {
        return c.json({ file, path: writeFile('scenarios', file, overwrite) }, 200)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 409)
      }
    },
  )

  // Games ---------------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/games',
      summary: 'Start a game on the YGOPro rules engine',
      description:
        'A session whose steps come from the rules engine. Players in bots (default ["p2"]) are answered by a random bot, its steps paced so they can be watched. Its steps can\'t be posted; a move is taken back with /sessions/{id}/game/undo.',
      request: body(
        z
          .object({
            deck: z.string().optional(),
            scenario: z.string().optional().describe("Start from this scenario's setup (hands, fields, LP) instead of decks and opening hands"),
            opponentDeck: z.string().optional(),
            seed: z.int().optional(),
            bots: z.array(PlayerSchema).optional(),
            bot: z.enum(['random', 'agent']).optional().describe('Which bot answers for bots: random (default) or agent, the trained one, which plays only the decks in GET /games/opponents'),
            claude: PlayerSchema.optional().describe('Claude plays this side instead of the bot (needs a Claude login)'),
            lesson: z.boolean().optional().describe('Claude runs the game as a lesson: it plays both sides, sets up positions and hands you a side to try (needs a Claude login)'),
            topic: z.string().optional().describe('What you want the lesson to teach'),
            model: ModelChoiceSchema.optional().describe("Claude's model (default opus)"),
            coach: z.boolean().optional().describe('Claude also coaches you (default true)'),
            watch: z.boolean().optional().describe('In a bot game, Claude sits beside you as a coach to ask: it sees your side and answers nothing (needs a Claude login)'),
            knowsDeck: z.boolean().optional().describe("With watch: Claude is given the bot's decklist (default true)"),
            respond: RespondSchema.optional().describe('When you are asked to respond with a chain (default auto)'),
            title: z.string().optional(),
          })
          .strict()
          .refine((o) => !o.deck !== !o.scenario, { message: 'give a deck or a scenario' }),
      ),
      responses: { 201: json(SessionSchema, 'The new game'), 501: json(ErrorSchema, "No rules engine, no Claude login, or the trained bot isn't running"), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const opts = c.req.valid('json')
      if ((opts.claude || opts.lesson || opts.watch) && !(claude && (await claude.account())))
        return c.json({ error: `${opts.lesson ? 'a lesson with' : 'playing'} Claude needs a Claude login (run \`claude\` and log in)` }, 501)
      // Against a bot, Claude sits beside you to be asked, when there's a login for it.
      const watch = opts.watch ?? (!opts.claude && !opts.lesson && (opts.bots ?? ['p2']).length === 1 && !!(claude && (await claude.account())))
      return c.json(await games.create({ ...opts, watch }), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/games/opponents',
      summary: 'Which bots can be played here, and with which decks',
      description: 'The random bot plays any deck. The trained bot (ygo-agent) plays only decks made of cards it was trained on, and only when its service is set up and running.',
      responses: {
        200: json(
          z.object({
            agent: z.object({ available: z.boolean(), reason: z.string().optional().describe("Why it can't be played, when it can't"), decks: z.array(z.string()).describe('Deck ids it can play') }),
          }),
          'The bots',
        ),
      },
    }),
    async (c) => {
      await games?.loadAgent()
      const decks = games?.agentDecks()
      const up = !!decks && (await games!.agentUp())
      const reason = !decks ? "It isn't set up on this server." : !up ? "Its service isn't running (docker compose up -d ygo-agent)." : undefined
      return c.json({ agent: { available: up, ...(reason && { reason }), decks: decks ?? [] } }, 200)
    },
  )

  // Claude ---------------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'get',
      path: '/claude',
      summary: 'Whether a Claude login is available for the Claude features',
      description: "The app works without one; with one, Claude can play and coach. It's the Claude Code login on this machine.",
      responses: { 200: json(z.object({ available: z.boolean(), email: z.string().optional(), plan: z.string().optional() }), 'Login status') },
    }),
    async (c) => {
      const a = claude && (await claude.account())
      // Whose login it is, for the admin only.
      return c.json({ available: !!a, ...(a && owns(c.get('me'), undefined) && a) }, 200)
    },
  )

  const needClaude = () => {
    if (!claude) throw new SessionError(409, 'Claude is not set up here')
    return claude.service
  }
  const claudeResponses = { 200: json(SessionSchema, 'The game'), 409: json(ErrorSchema, "Claude isn't playing in this session"), ...errors }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/attempt',
      summary: 'Have Claude try to win a game you lost',
      description:
        "A new game from the same shuffle against the same bot, with Claude playing your side by itself: it gets your notes on the deck, the bot's decklist and lines tried on a copy, but not the bot's hand. It runs whether or not you watch. After a win it teaches you how; after a loss with tries left it starts the next, linked from this one's chat.",
      request: {
        params: IdParam,
        ...body(z.object({ tries: z.int().min(1).max(3).optional().openapi({ description: 'How many tries it gets (default 1)' }), model: ModelChoiceSchema.optional() }).strict()),
      },
      responses: { 201: json(SessionSchema, "The new game, Claude's first try"), 409: json(ErrorSchema, "Not a finished game of yours against a bot"), 501: json(ErrorSchema, 'No Claude login'), ...errors },
    }),
    async (c) => {
      if (!(claude && (await claude.account()))) return c.json({ error: 'this needs a Claude login (run `claude` and log in)' }, 501)
      return c.json(await claude.service.attempt(c.req.valid('param').id, c.req.valid('json')), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/claude/chat',
      summary: 'Say something to Claude',
      description: "It replies (and plays, if it's asked something) on its next run. Sent while it's thinking, it waits for that run to end.",
      request: {
        params: IdParam,
        ...body(
          z
            .object({
              text: z.string().min(1),
              show: z.boolean().optional().openapi({ description: 'Show Claude your hidden cards and question with this message only, e.g. to ask for a hint' }),
            })
            .strict(),
        ),
      },
      responses: claudeResponses,
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const { text, show } = c.req.valid('json')
      needClaude().chat(id, text, show)
      return c.json(sessions.get(id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/claude/stop',
      summary: "Stop Claude's current run",
      description: 'Claude then waits until you chat or resume, even if the rules engine is asking it something.',
      request: { params: IdParam },
      responses: claudeResponses,
    }),
    async (c) => {
      const { id } = c.req.valid('param')
      await needClaude().stop(id)
      return c.json(sessions.get(id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/claude/resume',
      summary: 'Let Claude carry on after Stop',
      request: { params: IdParam },
      responses: claudeResponses,
    }),
    (c) => {
      const { id } = c.req.valid('param')
      needClaude().resume(id)
      return c.json(sessions.get(id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/claude/settings',
      summary: "Change Claude's model or coaching",
      description: 'Applies from its next run.',
      request: { params: IdParam, ...body(ClaudeSettingsSchema) },
      responses: claudeResponses,
    }),
    (c) => {
      const { id } = c.req.valid('param')
      needClaude().settings(id, c.req.valid('json'))
      return c.json(sessions.get(id), 200)
    },
  )

  // Claude on the home page ------------------------------------------------------

  const needHome = async () => {
    if (!home || !(await claude?.account())) throw new SessionError(501, 'the chat needs a Claude login (run `claude` and log in)')
    return home
  }
  const homeResponses = { 200: json(HomeViewSchema, 'The chat'), 501: json(ErrorSchema, 'No Claude login'), ...errors }
  const TextSchema = z.object({ text: z.string().min(1) }).strict()

  const ideasResponse = { 200: json(z.array(IdeaSchema), 'Every idea, oldest first'), ...errors }
  app.openapi(createRoute({ method: 'get', path: '/ideas', summary: 'Ideas jotted down from the header, to go through later', responses: ideasResponse }), (c) => c.json(ideas.list().filter((i) => owns(c.get('me'), i.owner)), 200))
  app.openapi(createRoute({ method: 'post', path: '/ideas', summary: 'Jot down an idea', request: body(NewIdeaSchema), responses: ideasResponse }), (c) => {
    const { text, where } = c.req.valid('json')
    const owner = c.get('me')?.id
    ideas.save([...ideas.list(), { id: `i-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, at: Date.now(), ...(where && { where }), ...(owner && { owner }) }])
    return c.json(ideas.list(), 200)
  })
  app.openapi(createRoute({ method: 'patch', path: '/ideas/{id}', summary: 'Reword an idea', request: { params: IdParam, ...body(NewIdeaSchema.pick({ text: true })) }, responses: ideasResponse }), (c) => {
    const { id } = c.req.valid('param')
    if (!ideas.list().some((i) => i.id === id)) throw new SessionError(404, 'no such idea')
    ideas.save(ideas.list().map((i) => (i.id === id ? { ...i, text: c.req.valid('json').text } : i)))
    return c.json(ideas.list(), 200)
  })
  app.openapi(createRoute({ method: 'delete', path: '/ideas/{id}', summary: 'Delete an idea', request: { params: IdParam }, responses: ideasResponse }), (c) => {
    ideas.save(ideas.list().filter((i) => i.id !== c.req.valid('param').id))
    return c.json(ideas.list(), 200)
  })

  app.openapi(createRoute({ method: 'get', path: '/home', summary: 'Your chats with Claude on the home page, newest first', responses: { 200: json(z.array(HomeThreadSchema), 'The chats') } }), (c) => c.json(home?.list().filter((t) => owns(c.get('me'), t.owner)) ?? [], 200))

  app.openapi(
    createRoute({
      method: 'post',
      path: '/home',
      summary: 'Start a chat with Claude about what to play or learn',
      description: 'It is named after this first message. Poll the chat for the reply.',
      request: body(HomeAskSchema),
      responses: homeResponses,
    }),
    async (c) => {
      const { text, model } = c.req.valid('json')
      return c.json((await needHome()).start(text, model), 200)
    },
  )

  app.openapi(createRoute({ method: 'get', path: '/home/{id}', summary: 'A chat with Claude from the home page', request: { params: IdParam }, responses: homeResponses }), (c) => {
    if (!home) throw new SessionError(404, 'no chats here')
    const { id } = c.req.valid('param')
    if (!owns(c.get('me'), ownerOf('home', id))) fail(403, "that's someone else's chat")
    return c.json(home.view(id), 200)
  })

  app.openapi(
    createRoute({
      method: 'post',
      path: '/home/{id}/chat',
      summary: 'Say something in a chat',
      description: "Poll the chat for the reply. Sent while Claude is answering, it waits for that answer.",
      request: { params: IdParam, ...body(TextSchema) },
      responses: homeResponses,
    }),
    async (c) => {
      const { id } = c.req.valid('param')
      const h = await needHome()
      h.ask(id, c.req.valid('json').text)
      return c.json(h.view(id), 200)
    },
  )

  app.openapi(createRoute({ method: 'post', path: '/home/{id}/stop', summary: "Stop Claude's answer", request: { params: IdParam }, responses: homeResponses }), async (c) => {
    const { id } = c.req.valid('param')
    const h = await needHome()
    await h.stop(id)
    return c.json(h.view(id), 200)
  })

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/home/{id}',
      summary: "Rename a chat, or change its model",
      request: { params: IdParam, ...body(z.object({ title: z.string().min(1).optional(), model: ModelChoiceSchema.optional() }).strict()) },
      responses: homeResponses,
    }),
    (c) => {
      if (!home) throw new SessionError(404, 'no chats here')
      const { id } = c.req.valid('param')
      const { title, model } = c.req.valid('json')
      if (title) home.rename(id, title)
      if (model) home.settings(id, { model })
      return c.json(home.view(id), 200)
    },
  )

  app.openapi(
    createRoute({ method: 'delete', path: '/home/{id}', summary: 'Delete a chat', request: { params: IdParam }, responses: { 200: json(z.object({ deleted: z.string() }), 'Deleted'), ...errors } }),
    async (c) => {
      if (!home) throw new SessionError(404, 'no chats here')
      const { id } = c.req.valid('param')
      await home.remove(id)
      return c.json({ deleted: id }, 200)
    },
  )

  // Claude as a tutor on a lesson ----------------------------------------------

  const needTutor = async () => {
    if (!tutor || !(await claude?.account())) throw new SessionError(501, 'the tutor needs a Claude login (run `claude` and log in)')
    return tutor
  }
  // Each account has its own chat on a lesson; the admin's is the lesson's own.
  const tutorChat = (c: Context) => {
    const { id } = c.req.param() as { id: string }
    const me = c.get('me') as Account | undefined
    return me && !me.admin ? `${id}~${me.id}` : id
  }
  const tutorResponses = { 200: json(TutorViewSchema, 'The chat'), 501: json(ErrorSchema, 'No Claude login'), ...errors }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/scenarios/{id}/tutor',
      summary: 'The chat with Claude about a lesson',
      request: { params: IdParam },
      responses: tutorResponses,
    }),
    async (c) => c.json((await needTutor()).view(tutorChat(c)), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/scenarios/{id}/tutor/chat',
      summary: 'Ask Claude about the lesson',
      description: "Poll the chat for the reply. Claude learns the steps up to position, never the ones after. Sent while it's answering, it waits for that answer.",
      request: { params: IdParam, ...body(TutorAskSchema) },
      responses: tutorResponses,
    }),
    async (c) => {
      const id = tutorChat(c)
      const { text, position } = c.req.valid('json')
      const t = await needTutor()
      t.ask(id, position, text)
      return c.json(t.view(id), 200)
    },
  )

  app.openapi(
    createRoute({ method: 'post', path: '/scenarios/{id}/tutor/stop', summary: "Stop Claude's answer", request: { params: IdParam }, responses: tutorResponses }),
    async (c) => {
      const id = tutorChat(c)
      const t = await needTutor()
      await t.stop(id)
      return c.json(t.view(id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/scenarios/{id}/tutor/settings',
      summary: "Change the tutor's model",
      request: { params: IdParam, ...body(z.object({ model: ModelChoiceSchema.optional() }).strict()) },
      responses: tutorResponses,
    }),
    async (c) => {
      const id = tutorChat(c)
      const t = await needTutor()
      t.settings(id, c.req.valid('json'))
      return c.json(t.view(id), 200)
    },
  )

  app.openapi(
    createRoute({ method: 'delete', path: '/scenarios/{id}/tutor', summary: 'Clear the chat and start over', request: { params: IdParam }, responses: tutorResponses }),
    async (c) => {
      const id = tutorChat(c)
      const t = await needTutor()
      await t.clear(id)
      return c.json(t.view(id), 200)
    },
  )

  // Reviewing a finished game with Claude ----------------------------------------

  const needReview = async () => {
    if (!review || !(await claude?.account())) throw new SessionError(501, 'reviewing with Claude needs a Claude login (run `claude` and log in)')
    return review
  }
  const reviewResponses = { 200: json(ReviewViewSchema, 'The review'), 409: json(ErrorSchema, 'No review, or the game is still going'), 501: json(ErrorSchema, 'No Claude login'), ...errors }
  const reviewRoute = (method: 'post' | 'delete', path: string, summary: string, description?: string) =>
    createRoute({ method, path: `/sessions/{id}/review${path}`, summary, ...(description && { description }), request: { params: IdParam }, responses: reviewResponses })

  app.openapi(
    reviewRoute('post', '', 'Review a finished game with Claude', "Opens the review in place of the game's chat (a new one, or the one you had). The session's SSE stream then carries it as review."),
    async (c) => c.json((await needReview()).start(c.req.valid('param').id), 200),
  )

  app.openapi(reviewRoute('post', '/close', "Close the review and go back to the game's chat", 'The review is kept for next time.'), async (c) =>
    c.json((await needReview()).close(c.req.valid('param').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/review/chat',
      summary: 'Ask Claude about the game',
      description: "Claude gets the table at position. The reply arrives on the session's SSE stream. Sent while it's answering, it waits for that answer.",
      request: { params: IdParam, ...body(ReviewChatSchema) },
      responses: reviewResponses,
    }),
    async (c) => {
      const { text, position } = c.req.valid('json')
      return c.json((await needReview()).chat(c.req.valid('param').id, text, position), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/review/moment',
      summary: 'Have Claude take you through a moment it marked',
      description: "Claude gets the table just before the move, at position step - 1. Its reply arrives on the session's SSE stream.",
      request: { params: IdParam, ...body(ReviewMomentSchema) },
      responses: reviewResponses,
    }),
    async (c) => c.json((await needReview()).moment(c.req.valid('param').id, c.req.valid('json').step), 200),
  )

  app.openapi(reviewRoute('post', '/stop', "Stop Claude's answer"), async (c) => c.json(await (await needReview()).stop(c.req.valid('param').id), 200))

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/review/settings',
      summary: "Change the review's model",
      request: { params: IdParam, ...body(z.object({ model: ModelChoiceSchema.optional() }).strict()) },
      responses: reviewResponses,
    }),
    async (c) => c.json((await needReview()).settings(c.req.valid('param').id, c.req.valid('json')), 200),
  )

  app.openapi(reviewRoute('delete', '', 'Clear the review and start over'), async (c) => c.json(await (await needReview()).clear(c.req.valid('param').id), 200))

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/answer',
      summary: "The viewer's answer to the rules engine's question (game.prompt), as option indices",
      request: { params: IdParam, ...body(GameAnswerSchema) },
      responses: { 200: json(SessionSchema, 'The game'), 409: json(ErrorSchema, 'That question is not open'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      const mine = seat(c, id)
      const view = await games.answer(id, undefined, c.req.valid('json'), mine)
      tellMove(id, mine)
      return c.json(view, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/forfeit',
      summary: 'Give up the game',
      description: "The viewer gives up a game that's still going, whoever's move it is: the other side wins (game.winner, with reason 0). A lesson can't be forfeited.",
      request: { params: IdParam },
      responses: { 200: json(SessionSchema, 'The game'), 409: json(ErrorSchema, 'Already over, or a lesson'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      return c.json(await games.forfeit(id, seat(c, id)), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/undo',
      summary: "Take back the viewer's last move",
      description:
        "The game goes back to the question their last move began with (a choice in the Main or Battle Phase, or a response they chose to make), and what followed is dropped. Draws and shuffles repeat. Allowed a few times a game (game.undos is how many are left), when it's their move or the game is over.",
      request: { params: IdParam },
      responses: { 200: json(SessionSchema, 'The game'), 409: json(ErrorSchema, 'Nothing to take back, or none left'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      const mine = seat(c, id)
      // Against a friend, the other player is asked first.
      if (!mine) return c.json(await games.undo(id), 200)
      const v = await games.askTakeback(id, mine)
      tell(id, sessions.export(id).duel!.seats![mine === 'p1' ? 'p2' : 'p1'], (them) => ({ title: 'Take-back?', body: `${them} asks to take back their last move`, tag: `move-${id}` }))
      return c.json(v, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/takeback',
      summary: "Answer the other player's request to take back their move",
      description: 'In a game against a friend: accept takes their last move back (and what followed it); otherwise they are told no.',
      request: { params: IdParam, ...body(z.object({ accept: z.boolean() }).strict()) },
      responses: { 200: json(SessionSchema, 'The game'), 409: json(ErrorSchema, 'Nothing to answer'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      const mine = seat(c, id) ?? fail(403, "you're not playing this game")
      const v = await games.answerTakeback(id, mine, c.req.valid('json').accept)
      tellMove(id, mine)
      return c.json(v, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/rematch',
      summary: 'Ask for a rematch of a finished game against a friend, or answer their asking',
      description:
        'The first to ask waits for the other; when they accept (or ask too), a new game starts with the same decks and whoever went second going first. Its id is in file.duel.rematch.session. accept false says no.',
      request: { params: IdParam, ...body(z.object({ accept: z.boolean().default(true) }).strict()) },
      responses: { 200: json(SessionSchema, 'The finished game'), 409: json(ErrorSchema, "It isn't over, or you're waiting for them"), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      const mine = seat(c, id) ?? fail(403, "you're not playing this game")
      const { accept } = c.req.valid('json')
      const old = sessions.get(id)
      const duel = old.file.duel!
      if (!duel.winner && !duel.forfeit) fail(409, "the game isn't over yet")
      const asked = duel.rematch
      if (asked?.session) return c.json(old, 200)
      if (!accept) {
        if (!asked || asked.by === mine) fail(409, 'nothing to say no to')
        return c.json(sessions.appendGame(id, [], { ...duel, rematch: { ...asked!, refused: true } }), 200)
      }
      if (!asked || asked.refused || asked.by === mine) {
        if (asked?.by === mine && !asked.refused) fail(409, "you've asked: waiting for them")
        const v = sessions.appendGame(id, [], { ...duel, rematch: { by: mine } })
        tell(id, duel.seats![mine === 'p1' ? 'p2' : 'p1'], (them) => ({ title: 'Rematch?', body: `${them} wants a rematch`, tag: `rematch-${id}` }))
        return c.json(v, 200)
      }
      // The same decks, and the other player goes first (p1 does).
      const seats = duel.seats!
      const responds = Object.fromEntries(Object.entries(duel.responds ?? {}).map(([p, r]) => [p === 'p1' ? 'p2' : 'p1', r]))
      const view = await acting.run(old.owner ?? accounts?.adminId ?? '', () =>
        games.create({
          deck: old.players.p2.deck!,
          opponentDeck: old.players.p1.deck!,
          bots: [],
          seats: { p1: seats.p2, p2: seats.p1 },
          names: { p1: old.players.p2.name, p2: old.players.p1.name },
          responds,
          title: old.title,
        }),
      )
      return c.json(sessions.appendGame(id, [], { ...duel, rematch: { ...asked, session: view.id } }), 200)
    },
  )

  // Notifications, per device: the key to subscribe with (none: they're off here).
  app.openapi(createRoute({ method: 'get', path: '/push', summary: "The server's key for notifications (none: they're off here)", responses: { 200: json(z.object({ key: z.string().optional() }), 'The key') } }), (c) =>
    c.json({ ...(push.key && { key: push.key }) }, 200),
  )
  const PushSubscriptionSchema = z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })
  app.openapi(
    createRoute({ method: 'post', path: '/push', summary: 'Turn on notifications for this device', request: body(PushSubscriptionSchema), responses: { 200: json(z.object({ on: z.boolean() }), 'On'), ...errors } }),
    (c) => {
      push.subscribe(meOr401(c).id, c.req.valid('json'))
      return c.json({ on: true }, 200)
    },
  )
  app.openapi(
    createRoute({ method: 'post', path: '/push/off', summary: 'Turn off notifications for this device', request: body(z.object({ endpoint: z.string() })), responses: { 200: json(z.object({ on: z.boolean() }), 'Off'), ...errors } }),
    (c) => {
      push.unsubscribe(c.req.valid('json').endpoint, meOr401(c).id)
      return c.json({ on: false }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/table/nudge',
      summary: "Nudge the other player when it's their move",
      description: 'A notification on their devices (at most one a minute).',
      request: { params: IdParam },
      responses: { 200: json(z.object({ nudged: z.boolean() }), 'Whether it was sent'), ...errors },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const { me, seat } = atTable(c, id)
      const last = nudged.get(id) ?? 0
      if (Date.now() - last < 60_000) return c.json({ nudged: false }, 200)
      nudged.set(id, Date.now())
      const them = sessions.export(id).duel!.seats![seat === 'p1' ? 'p2' : 'p1']
      void push.notify(them, { title: `${me.name} nudges you`, body: `Your move against ${me.name}`, url: `/?session=${id}`, tag: `move-${id}` })
      return c.json({ nudged: true }, 200)
    },
  )

  // Around a game against a friend: the chat, and the fun.
  const atTable = (c: Context, id: string) => {
    const me = meOr401(c)
    return { me, seat: seat(c, id) ?? fail(403, "you're not playing this game") }
  }
  // Claude answers the table from what both players can see (neither hand),
  // or one player privately, from their side.
  const claudeAnswers = (id: string, asker: Account, only: Player | undefined) => {
    const v = sessions.get(id)
    const names = { p1: v.players.p1.name, p2: v.players.p2.name }
    const board = only ? describeTable(v.state, only, ctx().db) : describeTable(v.state, 'p1', ctx().db, false, hiddenOf(v.state, 'p1'))
    const sides = only
      ? `You're advising ${names[only]} privately: nobody else sees this. "Your" side below is theirs.`
      : `You're in the group chat of a game between ${names.p1} and ${names.p2}, and both read what you say. Below, "your" side is ${names.p1}'s and "your opponent's" is ${names.p2}'s. Neither player's hidden cards are shown to you, and you never guess at them.`
    const system = `You're Claude, at the table of a Yu-Gi-Oh! game between two friends, answering in a chat. ${sides} Keep it short and friendly, a few sentences at most, plain text.`
    const message = `The table now:\n${board}\n\nThe chat so far:\n${table.transcript(id, only && asker.id)}\n\nAnswer ${asker.name}'s last message.`
    void table.answer(id, only && asker.id, () => quick!(system, message, 30_000), () => sessions.touch(id))
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/table/chat',
      summary: 'Say something in a game against a friend',
      description: 'Everyone at the table sees it. Mention @claude and Claude answers the table. hidden: only Claude sees it, and answers you alone (it can use your hand).',
      request: { params: IdParam, ...body(z.object({ text: z.string().min(1).max(1000), hidden: z.boolean().optional() }).strict()) },
      responses: { 200: json(SessionSchema, 'The game'), ...errors },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const { me, seat } = atTable(c, id)
      const { text, hidden } = c.req.valid('json')
      table.say(id, me, text, hidden ? me.id : undefined)
      // Mentioning the other player (@rob, or @Rob) tells them.
      const them = sessions.export(id).duel!.seats![seat === 'p1' ? 'p2' : 'p1']
      const other = accounts?.byId(them)
      if (!hidden && other && new RegExp(`@(${other.username}|${other.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i').test(text))
        tell(id, them, () => ({ title: `${me.name} mentioned you`, body: text.slice(0, 140), tag: `chat-${id}` }))
      if (quick && (hidden || /@claude\b/i.test(text))) claudeAnswers(id, me, hidden ? seat : undefined)
      return c.json(sessions.touch(id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/table/fun',
      summary: 'A sound on both screens, or an emoji on a card',
      request: {
        params: IdParam,
        ...body(
          z
            .object({
              sound: z.enum(SOUNDS).optional(),
              emoji: z.enum(EMOJI).optional(),
              card: z.object({ player: PlayerSchema, zone: z.string(), index: z.int().min(0) }).optional().openapi({ description: 'The slot the emoji goes on, from your side of the table' }),
            })
            .strict(),
        ),
      },
      responses: { 200: json(SessionSchema, 'The game'), ...errors },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const { me, seat } = atTable(c, id)
      const f = c.req.valid('json')
      // Your side of the table is p1 to you.
      const card = f.card && seat === 'p2' ? { ...f.card, player: f.card.player === 'p1' ? ('p2' as const) : ('p1' as const) } : f.card
      table.fun(id, me, { ...f, ...(card && { card }) })
      return c.json(sessions.touch(id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/reopen',
      summary: 'Go back to a chance to respond that was passed for you',
      description: 'The game goes back to that chance (game.skipped[].at) and asks you after all; what came after is dropped. It does not use up a take-back.',
      request: { params: IdParam, ...body(z.object({ at: z.int().min(0) }).strict()) },
      responses: { 200: json(SessionSchema, 'The game'), 409: json(ErrorSchema, 'No passed chance there'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      return c.json(await games.reopen(c.req.valid('param').id, c.req.valid('json').at), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/game/settings',
      summary: 'Change when you are asked to respond',
      description:
        'all: at every chance you have something to activate. auto: not when nothing happened (your trigger effects aside), nor after your own move. advise: as auto, with Claude saying whether it would respond. claude: as auto, and Claude passes for you where responding is plainly not worth it. Chances the rules or Claude passed are in game.skipped. The Claude levels need a Claude login; without one they behave as auto.',
      request: { params: IdParam, ...body(z.object({ respond: RespondSchema }).strict()) },
      responses: { 200: json(SessionSchema, 'The game'), 501: json(ErrorSchema, 'No rules engine'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const { id } = c.req.valid('param')
      return c.json(await games.setRespond(id, c.req.valid('json').respond, seat(c, id)), 200)
    },
  )

  // Lessons ------------------------------------------------------------------

  const conflict = { 409: json(ErrorSchema, 'Conflict') }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/next',
      summary: "The viewer's Next: show the first queued step",
      request: { params: IdParam },
      responses: { 200: json(SessionSchema, 'The session'), ...conflict, ...errors },
    }),
    (c) => c.json(sessions.next(c.req.valid('param').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/cursor',
      summary: 'Point the viewer at a position, or replay from..position',
      description:
        "Viewers following along jump there; anyone who has scrubbed away gets a 'Back to live' button instead. Only shown positions (up to lesson.revealed) are allowed.",
      request: { params: IdParam, ...body(CursorSchema.omit({ seq: true }).strict()) },
      responses: { 200: json(SessionSchema, 'The session'), ...errors },
    }),
    (c) => c.json(sessions.present(c.req.valid('param').id, c.req.valid('json')), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/prompt',
      summary: 'Ask the viewer something: ack, choice, move or text',
      description: 'One prompt at a time. It shows once no steps are queued. The answer arrives as an "answer" event from /wait.',
      request: { params: IdParam, ...body(PromptSchema) },
      responses: { 201: json(LessonViewSchema.shape.prompt.unwrap(), 'The open prompt'), ...conflict, ...errors },
    }),
    (c) => c.json(sessions.ask(c.req.valid('param').id, c.req.valid('json')), 201),
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/sessions/{id}/prompt',
      summary: 'Withdraw the open prompt',
      request: { params: IdParam },
      responses: { 200: json(SessionSchema, 'The session'), ...conflict, ...errors },
    }),
    (c) => c.json(sessions.withdraw(c.req.valid('param').id), 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sessions/{id}/prompt/answer',
      summary: "The viewer's answer (the browser sends this)",
      description: 'choice: the option index. text: the text. ack and move: nothing else.',
      request: { params: IdParam, ...body(AnswerSchema) },
      responses: { 200: json(SessionSchema, 'The session'), ...conflict, ...errors },
    }),
    (c) => c.json(sessions.answer(c.req.valid('param').id, c.req.valid('json')), 200),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/sessions/{id}/wait',
      summary: 'Long-poll for what the viewer does',
      description: `Returns the events after since as soon as there are any, or none after timeout seconds (default ${WAIT_DEFAULT_S}, max ${WAIT_MAX_S}). Pass the returned cursor as the next since. Without since, waits for the next new event.`,
      request: {
        params: IdParam,
        query: z.object({ since: z.coerce.number().int().min(0).optional(), timeout: z.coerce.number().min(0).max(WAIT_MAX_S).optional() }),
      },
      responses: { 200: json(z.object({ events: z.array(LessonEventSchema), cursor: z.int() }), 'Events (possibly none)'), ...errors },
    }),
    async (c) => {
      const { since, timeout = WAIT_DEFAULT_S } = c.req.valid('query')
      return c.json(await sessions.wait(c.req.valid('param').id, since, timeout * 1000), 200)
    },
  )

  // SSE: the full session after every change, starting with the current one.
  app.get('/sessions/:id/events', (c) => {
    const id = c.req.param('id')
    sessions.export(id) // a 404 before the stream starts
    const me = c.get('me')
    return streamSSE(c, async (stream) => {
      let n = 0
      const send = (v: SessionView) => stream.writeSSE({ event: 'session', data: JSON.stringify(viewFor(v, me)), id: String(n++) })
      // A player at the table: the other one sees they're here.
      const here = me && seatOf(sessions.export(id).duel, me.id) ? (present.get(id) ?? present.set(id, new Map()).get(id)!) : undefined
      if (here) {
        here.set(me!.id, (here.get(me!.id) ?? 0) + 1)
        setTimeout(() => sessions.has(id) && sessions.touch(id))
      }
      // Listen before the first view: a game that isn't loaded yet starts
      // loading when it's viewed, and says so when it's ready.
      const off = sessions.subscribe(id, (v) => void send(v))
      await send(sessions.get(id))
      let open = true
      stream.onAbort(() => {
        open = false
        off()
        if (here) {
          here.set(me!.id, here.get(me!.id)! - 1)
          if (sessions.has(id)) sessions.touch(id)
        }
      })
      // Keep the connection alive until the client goes away.
      while (open) {
        await stream.sleep(15000)
        if (open) await stream.writeSSE({ event: 'ping', data: '' })
      }
    })
  })

  app.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'Duel Table API', version: '1.0.0', description: 'Drive a Yu-Gi-Oh table from outside the browser.' } })

  return app
}
