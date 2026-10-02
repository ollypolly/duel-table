// Card names in text (narration, Claude's chat, lesson questions) become links
// to the card. Names match whole and exactly as printed, longest first, so
// "Dark Magician Girl" wins over "Dark Magician". Your decks are linked the
// same way, by name or id, wherever the words aren't a card's.
import type { Root } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import type { CardData, CardDb } from '../data/cardDb'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const CARD_HREF = '#card-'

export function cardNames(db: CardDb) {
  const byName = new Map(db.all().map((c) => [c.name, c]))
  const names = [...byName.keys()].filter((n) => n.length >= 4).sort((a, b) => b.length - a.length)
  // Letters, digits and hyphens either side mean it's part of a longer word.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${names.map(escape).join('|')})(?![\\p{L}\\p{N}-])`, 'gu')

  // The text in pieces: plain strings and the cards named in it.
  const split = (text: string): (string | CardData)[] => {
    const parts: (string | CardData)[] = []
    let at = 0
    for (const m of text.matchAll(pattern)) {
      if (m.index > at) parts.push(text.slice(at, m.index))
      parts.push(byName.get(m[0])!)
      at = m.index + m[0].length
    }
    if (at < text.length) parts.push(text.slice(at))
    return parts
  }

  // A remark plugin: each name becomes a link to CARD_HREF + its id, left
  // alone inside code and existing links.
  const remark = () => (tree: Root) =>
    findAndReplace(tree, [pattern, (name: string) => ({ type: 'link', url: `${CARD_HREF}${byName.get(name)!.id}`, children: [{ type: 'text', value: name }] })], {
      ignore: ['link', 'linkReference', 'inlineCode', 'code'],
    })

  return { split, remark }
}

export const DECK_HREF = '#deck-'

// Deck names and ids in text become links to DECK_HREF + the deck's id. Run
// after the cards' plugin, so a card's name is never read as a deck's.
export function deckNames(decks: { id: string; name: string }[]) {
  const byText = new Map(decks.flatMap((d) => [[d.id, d.id], [d.name, d.id]] as const).filter(([text]) => text.length >= 4))
  const texts = [...byText.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${texts.map(escape).join('|')})(?![\\p{L}\\p{N}-])`, 'gu')
  const remark = () => (tree: Root) =>
    texts.length
      ? findAndReplace(tree, [pattern, (text: string) => ({ type: 'link', url: `${DECK_HREF}${byText.get(text)!}`, children: [{ type: 'text', value: text }] })], { ignore: ['link', 'linkReference', 'inlineCode', 'code'] })
      : undefined
  return { remark, id: (text: string) => byText.get(text) }
}
