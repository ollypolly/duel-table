// Card names in text (narration, Claude's chat, lesson questions) become links
// to the card. Names match whole and exactly as printed, longest first, so
// "Dark Magician Girl" wins over "Dark Magician".
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
