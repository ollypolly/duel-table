// Decks for the API: parse a pasted decklist, build a deck file from it
// (resolving names and splitting Main/Extra by card type), and expand a deck
// with full card data for reading.
import { isExtraDeckCard, normalise, type CardData, type CardDb } from '../src/data/cardDb'
import type { DeckFile } from '../src/scenarios/schema'

export type DeckEntry = { name: string; count: number }

// One card per line: "3 Ash Blossom", "3x Ash Blossom", "Ash Blossom x3" or
// just "Ash Blossom". Blank lines and "#" or "//" comments are skipped, and so
// is everything under a "Side Deck" heading. Main/Extra headings are accepted
// but not needed: cards are sorted into the Extra Deck by type.
export function parseDeckList(text: string): { entries: DeckEntry[]; skipped: string[] } {
  const counts = new Map<string, DeckEntry>()
  const skipped: string[] = []
  let side = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//')) continue
    const heading = line.match(/^[#!]?\s*(main|extra|side)\b[\w\s]*:?$/i)
    if (heading) {
      side = heading[1].toLowerCase() === 'side'
      continue
    }
    if (line.startsWith('#') || side) continue
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i) ?? line.match(/^(.+?)\s+x\s*(\d+)$/i)
    const [name, count] = !m ? [line, 1] : /^\d/.test(m[1]) ? [m[2], Number(m[1])] : [m[1], Number(m[2])]
    if (count < 1) {
      skipped.push(raw)
      continue
    }
    const key = normalise(name)
    const e = counts.get(key)
    if (e) e.count += count
    else counts.set(key, { name: name.trim(), count })
  }
  return { entries: [...counts.values()], skipped }
}

// Resolve names against the card DB and split Main/Extra. Names come out as
// the DB spells them. Deck-size problems are warnings, not errors: this is a
// practice table, not a tournament.
export function buildDeck(id: string, name: string, entries: DeckEntry[], db: CardDb) {
  const merged = new Map<number, { card: CardData; count: number }>()
  const unknown: string[] = []
  for (const e of entries) {
    const card = db.byName(e.name)
    if (!card) unknown.push(e.name)
    else merged.set(card.id, { card, count: (merged.get(card.id)?.count ?? 0) + e.count })
  }
  const all = [...merged.values()]
  const pick = (extra: boolean) => all.filter((x) => isExtraDeckCard(x.card) === extra).map((x) => ({ name: x.card.name, count: x.count }))
  const file: DeckFile = { id, name, main: pick(false), extra: pick(true) }
  return { file, unknown, warnings: deckWarnings(file) }
}

export function deckWarnings(deck: DeckFile): string[] {
  const size = (xs: DeckEntry[]) => xs.reduce((n, e) => n + e.count, 0)
  const main = size(deck.main)
  const extra = size(deck.extra)
  return [
    ...(main < 40 || main > 60 ? [`Main Deck has ${main} cards (40 to 60 is legal)`] : []),
    ...(extra > 15 ? [`Extra Deck has ${extra} cards (at most 15 is legal)`] : []),
    ...[...deck.main, ...deck.extra].filter((e) => e.count > 3).map((e) => `${e.count} copies of ${e.name} (at most 3 is legal)`),
  ]
}

// A deck with each card's full data (text, stats) beside its count.
export function expandDeck(deck: DeckFile, db: CardDb) {
  const expand = (xs: DeckEntry[]) => xs.map((e) => ({ count: e.count, ...(db.byName(e.name) ?? { name: e.name, unknown: true }) }))
  const size = (xs: DeckEntry[]) => xs.reduce((n, e) => n + e.count, 0)
  return {
    id: deck.id,
    name: deck.name,
    size: { main: size(deck.main), extra: size(deck.extra) },
    main: expand(deck.main),
    extra: expand(deck.extra),
    warnings: deckWarnings(deck),
  }
}
