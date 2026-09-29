// Builds data/cards.json from every card named in decks/ and scenarios/, and
// downloads their images into public/cards/ (see server/ygoprodeck.ts).
//
// Usage: npm run fetch-cards [-- --force] [-- "Extra Card Name" ...]
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CardDbFile } from '../src/data/cardDb.ts'
import { fetchByNames, getJson, suggest, trim, writeImages, type ApiCard } from '../server/ygoprodeck.ts'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'data/cards.json')
const IMG_DIR = join(ROOT, 'public/cards')

async function readJsonDir(dir: string): Promise<unknown[]> {
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))))
}

// Card names appear as plain strings in deck entries, scenario player card
// lists and setup zones. Custom cards are objects and are skipped.
function collectNames(decks: unknown[], scenarios: unknown[]): Set<string> {
  const names = new Set<string>()
  const addStrings = (xs: unknown) => {
    if (Array.isArray(xs)) for (const x of xs) if (typeof x === 'string') names.add(x)
  }
  for (const d of decks as { main?: { name: string }[]; extra?: { name: string }[] }[]) {
    for (const e of [...(d.main ?? []), ...(d.extra ?? [])]) names.add(e.name)
  }
  for (const s of scenarios as Record<string, any>[]) {
    for (const p of Object.values(s.players ?? {}) as any[]) {
      addStrings(p.cards)
      addStrings(p.extra)
    }
    for (const zones of Object.values(s.setup ?? {}) as any[]) {
      for (const v of Object.values(zones ?? {})) {
        addStrings(v)
        if (Array.isArray(v)) for (const x of v) if (x && typeof x.name === 'string' && !x.custom) names.add(x.name)
      }
    }
  }
  return names
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const extraNames = args.filter((a) => !a.startsWith('--'))

  const names = collectNames(await readJsonDir(join(ROOT, 'decks')), await readJsonDir(join(ROOT, 'scenarios')))
  for (const n of extraNames) names.add(n)

  const existing: CardDbFile | null = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : null
  const [{ database_version }] = await getJson<{ database_version: string }[]>('checkDBVer.php')
  const have = new Set(existing?.cards.map((c) => c.name))
  const missing = [...names].filter((n) => !have.has(n))

  let cards = existing?.cards ?? []
  if (force || !existing || existing.dbVersion !== database_version) {
    console.log(`Fetching ${names.size} cards (DB ${database_version})`)
    const fetched = await fetchByNames([...names].sort())
    cards = fetched.map(trim)
    console.log(`Downloaded ${await writeImages(fetched, ROOT)} images`)
  } else if (missing.length) {
    console.log(`Fetching ${missing.length} new cards`)
    const fetched = await fetchByNames(missing)
    cards = [...cards.filter((c) => names.has(c.name)), ...fetched.map(trim)]
    console.log(`Downloaded ${await writeImages(fetched, ROOT)} images`)
  } else {
    console.log(`data/cards.json is up to date (DB ${database_version})`)
  }

  cards.sort((a, b) => a.name.localeCompare(b.name))
  const file: CardDbFile = { dbVersion: database_version, cards }
  await writeFile(OUT, JSON.stringify(file, null, 2) + '\n')

  // Images can go missing independently of the JSON (they're gitignored).
  const lacking = cards.filter((c) => !existsSync(join(IMG_DIR, 'small', `${c.id}.jpg`)))
  if (lacking.length) {
    console.log(`Re-downloading images for ${lacking.length} cards`)
    const body = await getJson<{ data?: ApiCard[] }>(
      `cardinfo.php?${new URLSearchParams({ id: lacking.map((c) => c.id).join(',') })}`,
    )
    console.log(`Downloaded ${await writeImages(body.data ?? [], ROOT)} images`)
  }

  const got = new Set(cards.map((c) => c.name))
  const unknown = [...names].filter((n) => !got.has(n))
  for (const n of unknown) console.error(`Unknown card "${n}". Did you mean: ${(await suggest(n)).join(', ') || 'no matches'}`)
  console.log(`Wrote ${cards.length} cards to data/cards.json`)
  if (unknown.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
