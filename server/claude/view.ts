// The table as one player sees it, as text for Claude. Fair play rests on
// this: Claude only learns about the game through these functions, so they
// never mention an iid (iids spell out card names) or a card hidden from the
// viewer.
import { PICK_KINDS, type GamePrompt } from '../../src/api/game'
import type { CardDb } from '../../src/data/cardDb'
import { locate, type BoardState, type Iid, type Player } from '../../src/engine'
import { cardFace } from '../../src/view/boardView'

const other = (p: Player): Player => (p === 'p1' ? 'p2' : 'p1')

// Whether viewer can see what a card is.
export function seenBy(state: BoardState, iid: Iid, viewer: Player, db: CardDb): boolean {
  const card = state.cards[iid]
  const loc = locate(state, iid)
  if (!card || !loc) return false
  if (state.revealed.includes(iid)) return true
  if ('materialOf' in loc) return true
  const { zone, player } = loc.zone
  switch (zone) {
    case 'deck':
      return false
    case 'hand':
    case 'extraDeck':
      return player === viewer || card.faceUp
    case 'gy':
      return true
    case 'banished':
      return card.faceUp || player === viewer
    default:
      return card.faceUp || cardFace(state, iid, db).controller === viewer
  }
}

// The table from viewer's side. shown: the opponent is showing viewer their
// hidden cards (to get advice), so those are named too.
export function describeTable(state: BoardState, viewer: Player, db: CardDb, shown = false): string {
  const name = (iid: Iid) => cardFace(state, iid, db).name
  const known = (iid: Iid) => seenBy(state, iid, viewer, db) || (shown && seenBy(state, iid, other(viewer), db))
  const card = (iid: Iid) => (known(iid) ? `${name(iid)}${state.cards[iid].faceUp ? '' : ' (face-down)'}` : 'face-down card')
  const monster = (iid: Iid) => {
    const f = cardFace(state, iid, db)
    const pos = `${f.faceUp ? '' : 'face-down '}${f.position === 'def' ? 'Defense' : 'Attack'}`
    const stats = known(iid) && f.atk !== undefined ? `, ATK ${f.atk}${f.def !== undefined ? ` / DEF ${f.def}` : ''}` : ''
    const mats = state.cards[iid].materials.length ? `, ${state.cards[iid].materials.length} material(s): ${state.cards[iid].materials.map(name).join(', ')}` : ''
    return `${known(iid) ? f.name : 'face-down monster'} (${pos}${stats}${mats})`
  }
  const slots = (ids: (Iid | null)[], describe: (iid: Iid) => string) =>
    ids
      .map((iid, i) => (iid ? `${i + 1}: ${describe(iid)}` : null))
      .filter(Boolean)
      .join('; ') || 'empty'
  const list = (ids: Iid[]) => (ids.length ? ids.map(name).join(', ') : 'empty')
  // Hidden piles: the cards viewer knows, and a count of the rest.
  const pile = (ids: Iid[]) => {
    const seen = ids.filter(known)
    const rest = ids.length - seen.length
    return [...seen.map(name), rest && `${rest} hidden`].filter(Boolean).join(', ') || 'empty'
  }

  const side = (p: Player) => {
    const z = state.players[p].zones
    const lines = [
      `${p === viewer ? 'Your' : "Your opponent's"} side: ${state.players[p].lp} LP`,
      `  Hand (${z.hand.length}): ${pile(z.hand)}`,
      `  Monster Zones: ${slots(z.monster, monster)}`,
      `  Spell & Trap Zones: ${slots(z.spellTrap, card)}`,
      `  Field Zone: ${slots(z.fieldSpell, card)}`,
      `  GY (${z.gy.length}): ${list(z.gy)}`,
      `  Banished (${z.banished.length}): ${pile(z.banished)}`,
      `  Deck: ${z.deck.length} cards`,
      `  Extra Deck (${z.extraDeck.length}): ${pile(z.extraDeck)}`,
    ]
    return lines.join('\n')
  }
  const emz = state.extraMonster
    .map((iid, i) => (iid ? `${i === 0 ? 'left' : 'right'}: ${monster(iid)}, ${cardFace(state, iid, db).controller === viewer ? 'yours' : "your opponent's"}` : null))
    .filter(Boolean)
  const turn = `Turn ${state.turn}: ${state.activePlayer === viewer ? 'YOUR turn' : "your OPPONENT's turn"}, ${state.phase} phase`
  const chain = state.chain.length
    ? `Chain (resolves last first): ${state.chain.map((l, i) => `CL${i + 1} ${name(l.card)} (${l.player === viewer ? 'yours' : "your opponent's"})`).join(', ')}`
    : ''
  return [turn, side(other(viewer)), emz.length ? `Extra Monster Zones: ${emz.join('; ')}` : '', side(viewer), chain].filter(Boolean).join('\n')
}

// Names of the cards viewer knows (everything but the Decks), to give Claude
// their texts.
export function knownCards(state: BoardState, viewer: Player, db: CardDb, shown = false): string[] {
  const names = Object.keys(state.cards).flatMap((iid) => {
    const loc = locate(state, iid)
    if (!loc || ('zone' in loc && loc.zone.zone === 'deck')) return []
    const known = seenBy(state, iid, viewer, db) || (shown && seenBy(state, iid, other(viewer), db))
    return known ? [cardFace(state, iid, db).name] : []
  })
  return [...new Set(names)]
}

// player's deck as viewer may know it. given: viewer has the decklist (their
// own, or one they've been shown); otherwise only the cards they can see now.
type DeckList = { name?: string; main: { name: string; count: number }[]; extra?: { name: string; count: number }[] }
export function describeDeck(state: BoardState, player: Player, viewer: Player, db: CardDb, list: DeckList | undefined, given: boolean): string {
  const whose = player === viewer ? 'Your' : "Your opponent's"
  const name = (iid: Iid) => cardFace(state, iid, db).name
  const tally = (names: string[]) => {
    const n = new Map<string, number>()
    for (const x of names) n.set(x, (n.get(x) ?? 0) + 1)
    return [...n].sort(([a], [b]) => a.localeCompare(b)).map(([x, c]) => `${c}x ${x}`).join(', ') || 'none'
  }
  const entries = (es: { name: string; count: number }[] = []) => es.map((e) => `${e.count}x ${e.name}`).join(', ') || 'none'
  const size = (es: { count: number }[] = []) => es.reduce((n, e) => n + e.count, 0)
  const owned = Object.values(state.cards).filter((c) => c.owner === player).map((c) => c.iid)
  if (!given) {
    const seen = owned.filter((iid) => seenBy(state, iid, viewer, db))
    return `You haven't been given ${player === viewer ? 'this' : "your opponent's"} decklist. Their cards you can see now: ${tally(seen.map(name))}. The history has what was played earlier.`
  }
  const lines = list
    ? [`${whose} deck${list.name ? `: ${list.name}` : ''}`, `Main Deck (${size(list.main)}): ${entries(list.main)}`, `Extra Deck (${size(list.extra)}): ${entries(list.extra)}`]
    : [`${whose} cards (${owned.length}): ${tally(owned.map(name))}`]
  // Their own Deck's contents follow from the list and what's out of it; the order doesn't.
  if (player === viewer) lines.push(`Still in the Deck (${state.players[player].zones.deck.length}, in an order nobody knows): ${tally(state.players[player].zones.deck.map(name))}`)
  else lines.push(`Not seen yet (in their Deck, hand, Extra Deck or face-down): ${tally(owned.filter((iid) => !seenBy(state, iid, viewer, db)).map(name))}`)
  return lines.join('\n')
}

export function cardText(db: CardDb, name: string): string {
  const c = db.byName(name)
  if (!c) return `No card named "${name}".`
  const stats = [
    c.attribute,
    c.race,
    c.level != null && `Level ${c.level}`,
    c.rank != null && `Rank ${c.rank}`,
    c.linkval != null && `Link ${c.linkval}`,
    c.atk != null && `ATK ${c.atk}`,
    c.def != null && `DEF ${c.def}`,
  ].filter(Boolean)
  return `${c.name} (${c.type}${stats.length ? `; ${stats.join(', ')}` : ''})\n${c.desc}`
}

// A step label with the names of cards viewer can't see blanked out (a Set
// from the opponent's hand, a card they added to their hand). A name stays
// if any copy of that card is visible to viewer.
export function publicLabel(label: string, state: BoardState, viewer: Player, db: CardDb): string {
  const visible = new Set<string>()
  const hidden = new Set<string>()
  for (const iid of Object.keys(state.cards)) (seenBy(state, iid, viewer, db) ? visible : hidden).add(cardFace(state, iid, db).name)
  const secret = [...hidden].filter((n) => !visible.has(n)).sort((a, b) => b.length - a.length)
  return secret.reduce((l, n) => l.split(n).join('a card'), label)
}

// An option as Claude reads it: the card it's about named in place of its
// iid. Picking questions already name the card in the label (hidden ones as
// "Face-down card"); actions like "Normal Summon" don't.
export function optionLabel(prompt: GamePrompt, i: number, state: BoardState, viewer: Player, db: CardDb): string {
  const o = prompt.options[i]
  if (!o.card || !state.cards[o.card] || PICK_KINDS.includes(prompt.kind)) return o.label
  return `${seenBy(state, o.card, viewer, db) ? cardFace(state, o.card, db).name : 'Face-down card'}: ${o.label}`
}

// theirs: it's someone else's question (the opponent's, shown to viewer for
// advice; the person's, to their coach), introduced with that line.
export function describeQuestion(prompt: GamePrompt, state: BoardState, viewer: Player, db: CardDb, theirs?: string): string {
  const how = prompt.min === prompt.max ? (prompt.max === 1 ? 'pick one' : `pick ${prompt.max}`) : `pick ${prompt.min} to ${prompt.max}`
  const why = prompt.source ? `, ${prompt.source.when === 'activating' ? 'to activate' : 'for the effect of'} ${prompt.source.name}` : ''
  const head = theirs ? `${theirs}: "${prompt.message}"${why} (${how})` : `Question ${prompt.id}: ${prompt.message}${why} (${how})`
  return [head, ...prompt.options.map((_, i) => `  ${i}. ${optionLabel(prompt, i, state, viewer, db)}`)].join('\n')
}
