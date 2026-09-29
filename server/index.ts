// The local API. Binds to 127.0.0.1 only: it can write files in this repo
// (and fetch cards from YGOPRODeck into it).
import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { createApp, WAIT_MAX_S } from './app'
import { diskStore, repoContext, ROOT, writeRepoFile } from './files'
import { GameService } from './games'
import { loadOcg, ocgDataDir } from './ocg/lib'
import { SessionService } from './sessions'
import { addCards } from './ygoprodeck'

const port = Number(process.env.API_PORT ?? 5181)
const ctx = repoContext()
const sessions = new SessionService(ctx, diskStore(join(ROOT, 'sessions')))
const games = new GameService(sessions, ctx, () => loadOcg(join(ROOT, ocgDataDir())))
const app = createApp({ sessions, ctx, games, writeFile: writeRepoFile(), addCards: (names) => addCards(names, ROOT) })

// Node's default 5-minute request timeout would cut long-polls (/wait) short.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port, serverOptions: { requestTimeout: (WAIT_MAX_S + 60) * 1000 } }, (info) => {
  console.log(`Duel Table API on http://127.0.0.1:${info.port}/api (spec: /api/openapi.json)`)
})
