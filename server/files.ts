// Node-side file access: the card DB, decks and scenarios from the repo, and
// the sessions/ directory. Read on demand so edits show up without a restart.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createCardDb, type CardDbFile } from '../src/data/cardDb'
import type { ResolveContext } from '../src/scenarios/resolve'
import type { ScenarioFile } from '../src/scenarios/schema'
import type { SessionStore } from './sessions'

export const ROOT = resolve(import.meta.dirname, '..')

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

// id → raw JSON for every file in a directory (the id field, else the filename).
export function readJsonDir(dir: string): Record<string, unknown> {
  if (!existsSync(dir)) return {}
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const json = readJson(join(dir, f))
        return [(json as { id?: string }).id ?? f.replace(/\.json$/, ''), json]
      }),
  )
}

export function loadCardDb(root = ROOT) {
  return createCardDb(readJson(join(root, 'data/cards.json')) as CardDbFile)
}

export function repoContext(root = ROOT): () => ResolveContext {
  const db = loadCardDb(root)
  return () => ({ db, decks: readJsonDir(join(root, 'decks')), scenarios: readJsonDir(join(root, 'scenarios')) })
}

export function diskStore(dir: string): SessionStore {
  return {
    load: () => Object.values(readJsonDir(dir)) as ScenarioFile[],
    save: (file) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${file.id}.json`), `${JSON.stringify(file, null, 2)}\n`)
    },
  }
}

// Write an exported session into scenarios/. Refuses to overwrite by default.
export function writeScenario(file: ScenarioFile, { overwrite = false, root = ROOT } = {}): string {
  const path = join(root, 'scenarios', `${file.id}.json`)
  if (existsSync(path) && !overwrite) throw new Error(`scenarios/${file.id}.json already exists (pass overwrite: true to replace it)`)
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
  return relative(root, path)
}
