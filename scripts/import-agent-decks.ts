// Adds the decks ygo-agent was trained on to decks/, as decks of ours
// (docs/BOT-PLAN.md). Reads its .ydk lists at the commit its released model
// matches, and names the cards through YGOPRODeck. Run `npm run fetch-cards`
// afterwards for their card data and images.
//
// Usage: npm run import-agent-decks
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getJson, type ApiCard } from '../server/ygoprodeck.ts'
import type { DeckFile } from '../src/scenarios/schema.ts'

const ROOT = new URL('..', import.meta.url).pathname
const COMMIT = '13e22951c886697115a7ff078de172f3e8fa9f08'
const RAW = `https://raw.githubusercontent.com/sbl1996/ygo-agent/${COMMIT}/assets/deck`

// Its file names, and what we call them. Variants of one deck keep a number.
const DECKS: Record<string, string> = {
  BestowedDragon: 'Bystial Dragon Link',
  BestowedDragon2: 'Bystial Dragon Link 2',
  BestowedDragonF: 'Bystial Dragon Link 3',
  Blackwing: 'Blackwing',
  BlueEyes: 'Blue-Eyes',
  Branded: 'Branded',
  Branded60: 'Branded (60 cards)',
  CenturIon: 'Centur-Ion',
  CenturIon2: 'Centur-Ion 2',
  Chimera: 'Chimera',
  CyberDragon: 'Cyber Dragon',
  Eld: 'Eldlich',
  Floowandereeze: 'Floowandereeze',
  Floowandereeze2: 'Floowandereeze 2',
  Hero: 'HERO',
  Labrynth: 'Labrynth',
  MaxDragon: 'Blue-Eyes Chaos MAX',
  NatRunick: 'Naturia Runick',
  Pachycephalo: 'Dinosaur',
  Shaddoll: 'Shaddoll',
  SinfulSnake: 'Sinful Spoils Snake-Eye',
  SinfulSnake2: 'Sinful Spoils Snake-Eye 2',
  SinfulSnakeKash: 'Sinful Spoils Snake-Eye Kashtira',
  SkyStrikerAce: 'Sky Striker',
  SnakeEyeAlter: 'Snake-Eye Alternative',
  SnakeEyeFire: 'Snake-Eye Fire King',
  SnakeEyeFire2: 'Snake-Eye Fire King 2',
  SnakeEyeTear: 'Snake-Eye Tearlaments',
  TenyiSword: 'Tenyi Swordsoul',
  Voiceless: 'Voiceless Voice',
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// A .ydk is card codes, one a line, under #main, #extra and !side.
function parseYdk(text: string) {
  const main: number[] = []
  const extra: number[] = []
  let into: number[] | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#main')) into = main
    else if (line.startsWith('#extra')) into = extra
    else if (line.startsWith('!side')) into = undefined
    else if (/^\d+$/.test(line)) into?.push(Number(line))
  }
  return { main, extra }
}

async function main() {
  const lists = new Map<string, { main: number[]; extra: number[] }>()
  for (const file of Object.keys(DECKS)) {
    const res = await fetch(`${RAW}/${file}.ydk`)
    if (!res.ok) throw new Error(`${res.status} ${file}.ydk`)
    lists.set(file, parseYdk(await res.text()))
  }
  const codes = [...new Set([...lists.values()].flatMap((l) => [...l.main, ...l.extra]))]
  const names = new Map<number, string>()
  for (let i = 0; i < codes.length; i += 20) {
    const body = await getJson<{ data?: ApiCard[] }>(`cardinfo.php?${new URLSearchParams({ id: codes.slice(i, i + 20).join(',') })}`)
    for (const c of body.data ?? []) for (const id of [c.id, ...c.card_images.map((im) => im.id)]) names.set(id, c.name)
  }
  const unknown = codes.filter((c) => !names.has(c))
  if (unknown.length) throw new Error(`YGOPRODeck doesn't know ${unknown.join(', ')}`)
  const entries = (cs: number[]) => {
    const counts = new Map<string, number>()
    for (const c of cs) counts.set(names.get(c)!, (counts.get(names.get(c)!) ?? 0) + 1)
    return [...counts].map(([name, count]) => ({ name, count }))
  }
  for (const [file, list] of lists) {
    const id = `trained-${slug(DECKS[file])}`
    const deck: DeckFile = { id, name: `${DECKS[file]} (trained)`, main: entries(list.main), extra: entries(list.extra) }
    await writeFile(join(ROOT, 'decks', `${id}.json`), JSON.stringify(deck, null, 2) + '\n')
  }
  console.log(`Wrote ${lists.size} decks. Now run: npm run fetch-cards`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
