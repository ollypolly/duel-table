// YGOPRODeck client, shared by `npm run fetch-cards` and POST /decks. Their
// terms: stay under 20 req/s (we go one request at a time) and never hotlink
// images, so images are downloaded into public/cards/.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCardDb, normalise, type CardData, type CardDbFile } from '../src/data/cardDb'

const API = 'https://db.ygoprodeck.com/api/v7'
const BATCH = 20
const DELAY_MS = 150

export type ApiCard = {
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

export async function getJson<T>(path: string): Promise<T> {
  await sleep(DELAY_MS)
  const url = `${API}/${path}`
  const res = await fetch(url)
  if (!res.ok && res.status !== 400) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}

export function trim(c: ApiCard): CardData {
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

export async function fetchByNames(names: string[]): Promise<ApiCard[]> {
  const found: ApiCard[] = []
  for (let i = 0; i < names.length; i += BATCH) {
    const body = await getJson<{ data?: ApiCard[] }>(`cardinfo.php?${new URLSearchParams({ name: names.slice(i, i + BATCH).join('|') })}`)
    found.push(...(body.data ?? []))
  }
  return found
}

// fname is a substring match, so search on short prefixes of the longest
// few words (one of them usually survives a typo) and let cardDb rank the
// results by edit distance.
export async function suggest(name: string): Promise<string[]> {
  const words = [...new Set(name.split(/[\s-]+/).filter((w) => w.length >= 3))].sort((a, b) => b.length - a.length).slice(0, 3)
  const cards = new Map<number, CardData>()
  for (const w of words) {
    const body = await getJson<{ data?: ApiCard[] }>(`cardinfo.php?${new URLSearchParams({ fname: w.slice(0, 4) })}`)
    for (const c of body.data ?? []) cards.set(c.id, trim(c))
  }
  return createCardDb({ dbVersion: '', cards: [...cards.values()] }).closeMatches(name, 5)
}

async function download(url: string, path: string): Promise<boolean> {
  if (existsSync(path)) return false
  await sleep(DELAY_MS)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  return true
}

// Only the first artwork is used; card ids match the first image id.
export async function writeImages(cards: ApiCard[], root: string): Promise<number> {
  const dir = join(root, 'public/cards')
  await mkdir(join(dir, 'small'), { recursive: true })
  let n = 0
  for (const c of cards) {
    const img = c.card_images[0]
    if (await download(img.image_url, join(dir, `${c.id}.jpg`))) n++
    if (await download(img.image_url_small, join(dir, 'small', `${c.id}.jpg`))) n++
  }
  return n
}

export type FetchResult = { added: CardData[]; unknown: { name: string; suggestions: string[] }[] }

// Fetch cards by name and add them (and their images) to data/cards.json.
// Names are matched case and punctuation insensitively: a miss whose closest
// suggestion is the same name spelled differently is fetched under that name.
export async function addCards(names: string[], root: string): Promise<FetchResult> {
  const fetched = await fetchByNames(names)
  const got = new Set(fetched.map((c) => normalise(c.name)))
  const unknown: FetchResult['unknown'] = []
  const respelled: string[] = []
  for (const name of names.filter((n) => !got.has(normalise(n)))) {
    const suggestions = await suggest(name)
    if (suggestions[0] && normalise(suggestions[0]) === normalise(name)) respelled.push(suggestions[0])
    else unknown.push({ name, suggestions })
  }
  if (respelled.length) fetched.push(...(await fetchByNames(respelled)))

  if (fetched.length) {
    const path = join(root, 'data/cards.json')
    const file = JSON.parse(await readFile(path, 'utf8')) as CardDbFile
    const have = new Set(file.cards.map((c) => c.id))
    const added = fetched.map(trim).filter((c) => !have.has(c.id))
    file.cards = [...file.cards, ...added].sort((a, b) => a.name.localeCompare(b.name))
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`)
    await writeImages(fetched, root)
    return { added, unknown }
  }
  return { added: [], unknown }
}
