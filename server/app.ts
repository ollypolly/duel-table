// HTTP transport over the session service. Routes are defined from Zod
// schemas (the same ones scenario files use), which also generates the
// OpenAPI spec at /api/openapi.json.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import type { CardDb } from '../src/data/cardDb'
import { imagePath } from '../src/data/cardDb'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import { parseDeck } from '../src/scenarios/resolve'
import { DeckSchema, StepSchema } from '../src/scenarios/schema'
import { AnswerSchema, CursorSchema, LessonEventSchema, LessonViewSchema, PromptSchema, RevealSchema } from '../src/api/lesson'
import { ClaudeSettingsSchema, GameAnswerSchema, GameViewSchema, ModelChoiceSchema } from '../src/api/game'
import { PlayerSchema } from '../src/scenarios/schema'
import type { ClaudeService } from './claude/service'
import type { GameService } from './games'
import { buildDeck, expandDeck, parseDeckList, type DeckEntry } from './decks'
import type { ClaudeAccount } from './claude/agent'
import type { WriteRepoFile } from './files'
import { SessionError, type SessionService } from './sessions'
import type { FetchResult } from './ygoprodeck'

const ErrorSchema = z.object({ error: z.string(), details: z.array(z.string()).optional() })
const IssueSchema = z.object({ severity: z.enum(['error', 'warning']), message: z.string(), action: z.number().optional() })
const SummarySchema = z.object({ id: z.string(), title: z.string(), steps: z.number(), basedOn: z.string().optional() })
const SessionSchema = SummarySchema.extend({
  file: z.unknown().openapi({ description: 'The session as a scenario file' }),
  state: z.unknown().openapi({ description: 'BoardState after the last step (queued ones included)' }),
  lesson: LessonViewSchema,
  game: GameViewSchema.optional().openapi({ description: 'For games on the rules engine' }),
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
  addCards?: (names: string[]) => Promise<FetchResult> // without it, unknown cards aren't fetched
  games?: GameService // without it, there are no games on the rules engine
  // Claude as a player; account says whether a Claude login is available.
  claude?: { service: ClaudeService; account: () => Promise<ClaudeAccount | undefined> }
}

export function createApp({ sessions, ctx, writeFile, addCards, games, claude }: AppDeps) {
  const app = new OpenAPIHono({
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

  // Scenarios -----------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'get',
      path: '/scenarios',
      summary: 'List scenarios',
      responses: { 200: json(z.array(z.object({ id: z.string(), title: z.string().optional(), steps: z.number().optional(), errors: z.array(z.string()).optional() })), 'Scenarios') },
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
      responses: { 200: json(z.object({ id: z.string(), title: z.string(), steps: z.array(StepSchema), warnings: z.array(z.string()), file: z.unknown() }), 'Scenario'), ...errors },
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
      request: { params: z.object({ id: z.coerce.number().int().openapi({ param: { name: 'id', in: 'path' } }) }) },
      responses: { 200: json(z.unknown(), 'The card'), 404: json(ErrorSchema, 'Unknown passcode') },
    }),
    (c) => {
      const found = card(c.req.valid('param').id)
      return found ? c.json(found, 200) : c.json({ error: `no card ${c.req.valid('param').id}` }, 404)
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

  app.openapi(
    createRoute({
      method: 'get',
      path: '/decks',
      summary: 'List decks',
      responses: { 200: json(z.array(z.object({ id: z.string(), name: z.string().optional(), size: z.object({ main: z.number(), extra: z.number() }).optional(), errors: z.array(z.string()).optional() })), 'Decks') },
    }),
    (c) => {
      const context = ctx()
      return c.json(
        Object.entries(context.decks).map(([id, raw]) => {
          try {
            const d = expandDeck(parseDeck(raw, `deck ${id}`), context.db)
            return { id: d.id, name: d.name, size: d.size }
          } catch (e) {
            return { id, errors: [e instanceof Error ? e.message : String(e)] }
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
      summary: 'A deck with every card\'s text and stats',
      request: { params: IdParam },
      responses: { 200: json(ExpandedDeckSchema, 'The deck'), ...errors },
    }),
    (c) => {
      const context = ctx()
      const { id } = c.req.valid('param')
      const raw = context.decks[id]
      if (!raw) return c.json({ error: `no deck "${id}"`, details: [`known: ${Object.keys(context.decks).join(', ') || 'none'}`] }, 404)
      try {
        return c.json(expandDeck(parseDeck(raw, `deck ${id}`), context.db), 200)
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
      const { id, name, list, cards, fetch = true, overwrite = false } = c.req.valid('json')
      if (ctx().decks[id] && !overwrite) return c.json({ error: `decks/${id}.json already exists (pass overwrite: true to replace it)` }, 409)
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
      const built = buildDeck(id, name, entries, db)
      missing = built.unknown
      if (missing.length) {
        const unknown = missing.map((n) => ({ name: n, suggestions: suggestions[n] ?? db.closeMatches(n, 5) }))
        return c.json({ error: `unknown card${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, unknown }, 422)
      }
      const path = writeFile?.('decks', built.file, overwrite)
      return c.json({ ...expandDeck(built.file, db), ...(path && { path }), fetched, skipped }, 201)
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

  app.openapi(
    createRoute({ method: 'get', path: '/sessions', summary: 'List sessions', responses: { 200: json(z.array(SummarySchema), 'Sessions') } }),
    (c) => c.json(sessions.list(), 200),
  )

  app.openapi(
    createRoute({ method: 'get', path: '/sessions/{id}', summary: 'A session: its log (as a scenario file) and current state', request: { params: IdParam }, responses: { 200: json(SessionSchema, 'The session'), ...errors } }),
    (c) => c.json(sessions.get(c.req.valid('param').id), 200),
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
      request: { params: IdParam, body: { content: { 'application/json': { schema: z.object({ author: z.enum(['user', 'claude']).optional() }).strict() } }, required: false } },
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
      path: '/sessions/{id}/export',
      summary: 'The session as a scenario file; with write: true, also saved to scenarios/<id>.json',
      request: {
        params: IdParam,
        ...body(z.object({ id: z.string().regex(/^[a-z0-9-]+$/).optional(), title: z.string().optional(), write: z.boolean().optional(), overwrite: z.boolean().optional() }).strict()),
      },
      responses: { 200: json(z.object({ file: z.unknown(), path: z.string().optional() }), 'Exported'), ...errors, 409: json(ErrorSchema, 'File exists') },
    }),
    (c) => {
      const { write, overwrite = false, ...as } = c.req.valid('json')
      const file = sessions.export(c.req.valid('param').id, as)
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
        'A session whose steps come from the rules engine. Players in bots (default ["p2"]) are answered by a random bot, its steps paced so they can be watched. Its steps can\'t be posted or undone.',
      request: body(
        z
          .object({
            deck: z.string(),
            opponentDeck: z.string().optional(),
            seed: z.int().optional(),
            bots: z.array(PlayerSchema).optional(),
            claude: PlayerSchema.optional().describe('Claude plays this side instead of the bot (needs a Claude login)'),
            model: ModelChoiceSchema.optional().describe("Claude's model (default opus)"),
            coach: z.boolean().optional().describe('Claude also coaches you (default true)'),
            title: z.string().optional(),
          })
          .strict(),
      ),
      responses: { 201: json(SessionSchema, 'The new game'), 501: json(ErrorSchema, 'No rules engine, or no Claude login'), ...errors },
    }),
    async (c) => {
      if (!games) return c.json({ error: 'the rules engine is not set up here' }, 501)
      const opts = c.req.valid('json')
      if (opts.claude && !(claude && (await claude.account()))) return c.json({ error: 'playing Claude needs a Claude login (run `claude` and log in)' }, 501)
      return c.json(await games.create(opts), 201)
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
      return c.json({ available: !!a, ...a }, 200)
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
      path: '/sessions/{id}/claude/chat',
      summary: 'Say something to Claude',
      description: "It replies (and plays, if it's asked something) on its next run. Sent while it's thinking, it waits for that run to end.",
      request: { params: IdParam, ...body(z.object({ text: z.string().min(1) }).strict()) },
      responses: claudeResponses,
    }),
    (c) => {
      const { id } = c.req.valid('param')
      needClaude().chat(id, c.req.valid('json').text)
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
      return c.json(await games.answer(c.req.valid('param').id, 'p1', c.req.valid('json')), 200)
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
      description: "Viewers following along jump there; anyone who has scrubbed away gets a 'Back to live' button instead. Only shown positions (up to lesson.revealed) are allowed.",
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
    createRoute({ method: 'delete', path: '/sessions/{id}/prompt', summary: 'Withdraw the open prompt', request: { params: IdParam }, responses: { 200: json(SessionSchema, 'The session'), ...conflict, ...errors } }),
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
    const first = sessions.get(id)
    return streamSSE(c, async (stream) => {
      let n = 0
      const send = (v: unknown) => stream.writeSSE({ event: 'session', data: JSON.stringify(v), id: String(n++) })
      await send(first)
      const off = sessions.subscribe(id, (v) => void send(v))
      let open = true
      stream.onAbort(() => {
        open = false
        off()
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
