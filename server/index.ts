// The local API. Binds to 127.0.0.1 only: it can write files in this repo.
import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { createApp } from './app'
import { diskStore, repoContext, ROOT, writeScenario } from './files'
import { SessionService } from './sessions'

const port = Number(process.env.API_PORT ?? 5181)
const ctx = repoContext()
const sessions = new SessionService(ctx, diskStore(join(ROOT, 'sessions')))
const app = createApp({ sessions, ctx, writeScenario: (file, overwrite) => writeScenario(file, { overwrite }) })

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`Duel Table API on http://127.0.0.1:${info.port}/api (spec: /api/openapi.json)`)
})
