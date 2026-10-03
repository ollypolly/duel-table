// Node-side file access: the card DB, decks and scenarios from the repo, and
// the sessions/ directory. Read on demand so edits show up without a restart.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

// The card DB is reloaded when data/cards.json changes (POST /decks and
// `npm run fetch-cards` both add cards).
export function repoContext(root = ROOT): () => ResolveContext {
  let db = loadCardDb(root)
  let loadedAt = statSync(join(root, 'data/cards.json')).mtimeMs
  return () => {
    const mtime = statSync(join(root, 'data/cards.json')).mtimeMs
    if (mtime !== loadedAt) [db, loadedAt] = [loadCardDb(root), mtime]
    return { db, decks: { ...readJsonDir(join(root, 'decks')), ...friendsDecks(root) }, scenarios: readJsonDir(join(root, 'scenarios')) }
  }
}

// A friend's decks aren't committed: they're kept under sessions/decks/<account id>/.
// The repo's (in decks/) are the admin's.
const ownedDir = (root: string, owner: string) => join(root, 'sessions', 'decks', owner)
const owners = (root: string) => (existsSync(join(root, 'sessions', 'decks')) ? readdirSync(join(root, 'sessions', 'decks')) : [])
const friendsDecks = (root: string) => Object.assign({}, ...owners(root).map((o) => readJsonDir(ownedDir(root, o)))) as Record<string, unknown>

// The account a deck belongs to; undefined for the repo's.
export const deckOwner =
  (root = ROOT) =>
  (id: string): string | undefined =>
    owners(root).find((o) => deckPath(ownedDir(root, o), id))

// The file in dir with that id: dir/<id>.json, or whichever file has it.
const deckPath = (dir: string, id: string) => {
  if (!existsSync(dir)) return undefined
  const named = join(dir, `${id}.json`)
  return existsSync(named)
    ? named
    : readdirSync(dir)
        .map((f) => join(dir, f))
        .find((p) => p.endsWith('.json') && (readJson(p) as { id?: string }).id === id)
}

export function diskStore(dir: string): SessionStore {
  return {
    load: () => Object.values(readJsonDir(dir)) as ScenarioFile[],
    save: (file) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${file.id}.json`), `${JSON.stringify(file, null, 2)}\n`)
    },
    remove: (id) => rmSync(join(dir, `${id}.json`), { force: true }),
    updatedAt: (id) => (existsSync(join(dir, `${id}.json`)) ? statSync(join(dir, `${id}.json`)).mtimeMs : undefined),
    // The file is written in place, so its birth is when the session began (0 where the disk doesn't keep one).
    createdAt: (id) => (existsSync(join(dir, `${id}.json`)) ? statSync(join(dir, `${id}.json`)).birthtimeMs || undefined : undefined),
  }
}

// Delete a deck file: from decks/, or from whichever account has it.
export type RemoveRepoFile = (dir: 'decks', id: string) => string

export const removeRepoFile =
  (root = ROOT): RemoveRepoFile =>
  (dir, id) => {
    const path = [join(root, dir), ...owners(root).map((o) => ownedDir(root, o))].map((d) => deckPath(d, id)).find(Boolean)
    if (!path) throw new Error(`no ${dir} file for "${id}"`)
    rmSync(path)
    return relative(root, path)
  }

// Write a scenario or deck file into the repo, or a deck into its owner's
// (a deck being replaced stays where it is). Refuses to overwrite by default.
export type WriteRepoFile = (dir: 'scenarios' | 'decks', file: { id: string }, overwrite: boolean, owner?: string) => string

export const writeRepoFile =
  (root = ROOT): WriteRepoFile =>
  (dir, file, overwrite, owner) => {
    const where = dir === 'decks' ? deckOwner(root)(file.id) : undefined
    const folder = (where ?? (dir === 'decks' && owner)) ? ownedDir(root, (where ?? owner)!) : join(root, dir)
    const path = join(folder, `${file.id}.json`)
    if (existsSync(path) && !overwrite) throw new Error(`${relative(root, path)} already exists (pass overwrite: true to replace it)`)
    mkdirSync(folder, { recursive: true })
    let json = JSON.stringify(file, null, 2)
    // Decks keep one card per line, as they're written by hand.
    if (dir === 'decks') json = json.replace(/\{\n\s+("name": .*),\n\s+("count": \d+)\n\s+\}/g, '{ $1, $2 }')
    writeFileSync(path, `${json}\n`)
    return relative(root, path)
  }
