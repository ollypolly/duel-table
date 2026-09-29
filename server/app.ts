// HTTP transport over the session service. Routes are defined from Zod
// schemas (the same ones scenario files use), which also generates the
// OpenAPI spec at /api/openapi.json.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import type { CardDb } from '../src/data/cardDb'
import { imagePath } from '../src/data/cardDb'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import { ScenarioSchema, StepSchema } from '../src/scenarios/schema'
import { SessionError, type SessionService } from './sessions'

const ErrorSchema = z.object({ error: z.string(), details: z.array(z.string()).optional() })
const IssueSchema = z.object({ severity: z.enum(['error', 'warning']), message: z.string(), action: z.number().optional() })
const SummarySchema = z.object({ id: z.string(), title: z.string(), steps: z.number(), basedOn: z.string().optional() })
const SessionSchema = SummarySchema.extend({
  file: z.unknown().openapi({ description: 'The session as a scenario file' }),
  state: z.unknown().openapi({ description: 'BoardState after the last step' }),
})
const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) })

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description })
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } } } })
const errors = { 400: json(ErrorSchema, 'Bad request'), 404: json(ErrorSchema, 'Not found'), 422: json(ErrorSchema, "Doesn't resolve") }

export function createApp({ sessions, ctx, writeScenario }: { sessions: SessionService; ctx: () => ResolveContext; writeScenario?: (file: z.infer<typeof ScenarioSchema>, overwrite: boolean) => string }) {
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
      description: 'Checked with tableRules first. Errors (physically impossible moves) always reject; warnings only reject with strict: true.',
      request: { params: IdParam, ...body(StepSchema.extend({ strict: z.boolean().optional() })) },
      responses: {
        200: json(z.object({ state: z.unknown(), events: z.array(z.unknown()), issues: z.array(IssueSchema), position: z.number() }), 'Applied'),
        422: json(z.object({ error: z.string(), issues: z.array(IssueSchema) }), 'Rejected'),
        404: json(ErrorSchema, 'Not found'),
      },
    }),
    (c) => {
      const { strict, ...step } = c.req.valid('json')
      const r = sessions.apply(c.req.valid('param').id, step, { strict })
      if (!r.ok) return c.json({ error: 'step rejected', issues: r.issues }, 422)
      return c.json({ state: r.state, events: r.events, issues: r.issues, position: r.position }, 200)
    },
  )

  app.openapi(
    createRoute({ method: 'post', path: '/sessions/{id}/undo', summary: 'Drop the last step', request: { params: IdParam }, responses: { 200: json(SessionSchema, 'The session'), 409: json(ErrorSchema, 'Nothing to undo'), ...errors } }),
    (c) => c.json(sessions.undo(c.req.valid('param').id), 200),
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
      if (!write || !writeScenario) return c.json({ file }, 200)
      try {
        return c.json({ file, path: writeScenario(file, overwrite) }, 200)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 409)
      }
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
