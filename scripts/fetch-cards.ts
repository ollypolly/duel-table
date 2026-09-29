// Builds data/cards.json from every card named in decks/ and scenarios/, and
// downloads their images into public/cards/. YGOPRODeck terms: stay under
// 20 req/s (we go one request at a time) and never hotlink images.
//
// Usage: npm run fetch-cards [-- --force] [-- "Extra Card Name" ...]
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCardDb, type CardData, type CardDbFile } from '../src/data/cardDb.ts'

const API = 'https://db.ygoprodeck.com/api/v7'
const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'data/cards.json')
const IMG_DIR = join(ROOT, 'public/cards')
const BATCH = 20
const DELAY_MS = 150

type ApiCard = {
  id: number
  name: string
  type: string
  frameType: string
  desc: string
  atk?: number
  def?: number
  level?: number
  linkval?: number
  attribute?: string
  race: string
  archetype?: string
  card_images: { id: number; image_url: string; image_url_small: string }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson<T>(url: string): Promise<T> {
  await sleep(DELAY_MS)
  const res = await fetch(url)
  if (!res.ok && res.status !== 400) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}

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

function trim(c: ApiCard): CardData {
  const isXyz = c.type.includes('XYZ')
  const isLink = c.type.includes('Link')
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    frameType: c.frameType,
    desc: c.desc.replace(/\r\n/g, '\n'),
    ...(c.atk !== undefined && { atk: c.atk }),
    ...(c.def !== undefined && !isLink && { def: c.def }),
    ...(c.level !== undefined && !isXyz && { level: c.level }),
    ...(c.level !== undefined && isXyz && { rank: c.level }),
    ...(c.linkval !== undefined && { linkval: c.linkval }),
    ...(c.attribute && { attribute: c.attribute }),
    race: c.race,
    ...(c.archetype && { archetype: c.archetype }),
  }
}

async function fetchByNames(names: string[]): Promise<ApiCard[]> {
  const found: ApiCard[] = []
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH)
    const url = `${API}/cardinfo.php?${new URLSearchParams({ name: batch.join('|') })}`
    const body = await getJson<{ data?: ApiCard[]; error?: string }>(url)
    found.push(...(body.data ?? []))
  }
  return found
}

// fname is a substring match, so search on a short prefix of the longest word
// (survives most typos) and let cardDb rank the results by edit distance.
async function suggest(name: string): Promise<string[]> {
  const word = name.split(/[\s-]+/).sort((a, b) => b.length - a.length)[0].slice(0, 5)
  const body = await getJson<{ data?: ApiCard[] }>(`${API}/cardinfo.php?${new URLSearchParams({ fname: word })}`)
  return createCardDb({ dbVersion: '', cards: (body.data ?? []).map(trim) }).closeMatches(name, 5)
}

async function download(url: string, path: string): Promise<boolean> {
  if (existsSync(path)) return false
  await sleep(DELAY_MS)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const extraNames = args.filter((a) => !a.startsWith('--'))

  const names = collectNames(await readJsonDir(join(ROOT, 'decks')), await readJsonDir(join(ROOT, 'scenarios')))
  for (const n of extraNames) names.add(n)

  const existing: CardDbFile | null = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : null
  const [{ database_version }] = await getJson<{ database_version: string }[]>(`${API}/checkDBVer.php`)
  const have = new Set(existing?.cards.map((c) => c.name))
  const missing = [...names].filter((n) => !have.has(n))

  let cards = existing?.cards ?? []
  if (force || !existing || existing.dbVersion !== database_version) {
    console.log(`Fetching ${names.size} cards (DB ${database_version})`)
    const fetched = await fetchByNames([...names].sort())
    cards = fetched.map(trim)
    await writeImages(fetched)
  } else if (missing.length) {
    console.log(`Fetching ${missing.length} new cards`)
    const fetched = await fetchByNames(missing)
    cards = [...cards.filter((c) => names.has(c.name)), ...fetched.map(trim)]
    await writeImages(fetched)
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
      `${API}/cardinfo.php?${new URLSearchParams({ id: lacking.map((c) => c.id).join(',') })}`,
    )
    await writeImages(body.data ?? [])
  }

  const got = new Set(cards.map((c) => c.name))
  const unknown = [...names].filter((n) => !got.has(n))
  for (const n of unknown) console.error(`Unknown card "${n}". Did you mean: ${(await suggest(n)).join(', ') || 'no matches'}`)
  console.log(`Wrote ${cards.length} cards to data/cards.json`)
  if (unknown.length) process.exitCode = 1
}

// Only the first artwork is used; card ids match the first image id.
async function writeImages(cards: ApiCard[]) {
  await mkdir(join(IMG_DIR, 'small'), { recursive: true })
  let n = 0
  for (const c of cards) {
    const img = c.card_images[0]
    if (await download(img.image_url, join(IMG_DIR, `${c.id}.jpg`))) n++
    if (await download(img.image_url_small, join(IMG_DIR, 'small', `${c.id}.jpg`))) n++
  }
  console.log(`Downloaded ${n} images`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
