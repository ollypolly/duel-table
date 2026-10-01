// The core's questions as numbered options (GamePrompt), and the answer for
// a list of picked options. The same shape serves the browser and Claude.
// Questions nobody needs to think about (where exactly a card goes, sorting)
// are answered automatically.
import type { GamePrompt } from '../../src/api/game'
import type { Iid, Player } from '../../src/engine'
import { playerOf } from './duel'
import type { ChainPhase } from './game'
import { LOC, M, POS, type CardData, type Ocg, type PromptMsg } from './lib'
import { zoneFor, type Translator } from './translate'

type Option = GamePrompt['options'][number]
type Where = { controller: number; location: number; sequence: number }

export type Question =
  | { auto: Uint8Array }
  | { prompt: GamePrompt; answer(choices: number[]): Uint8Array }

type Context = { id: number; hint?: number; chain?: ChainPhase; ocg: Ocg; translator: Translator; codes: number[] }

const ATTRIBUTES = ['EARTH', 'WATER', 'FIRE', 'WIND', 'LIGHT', 'DARK', 'DIVINE']
const RACES = ['Warrior', 'Spellcaster', 'Fairy', 'Fiend', 'Zombie', 'Machine', 'Aqua', 'Pyro', 'Rock', 'Winged Beast', 'Plant', 'Insect', 'Thunder', 'Dragon', 'Beast', 'Beast-Warrior', 'Dinosaur', 'Fish', 'Sea Serpent', 'Reptile', 'Psychic', 'Divine-Beast', 'Creator God', 'Wyrm', 'Cyberse', 'Illusion']
const POSITIONS: [number, string][] = [
  [POS.faceUpAtk, 'Attack Position'],
  [POS.faceDownAtk, 'face-down Attack Position'],
  [POS.faceUpDef, 'Defense Position'],
  [POS.faceDownDef, 'face-down Defense Position'],
]
const HINT_SELECTMSG = 3
// The core's "select a card to..." hints where the card picked is lost:
// Tribute, discard, destroy, banish, send to the GY, return to the Deck,
// detach.
const LOSING_HINTS = [500, 501, 502, 503, 504, 507, 519]

export function question(m: PromptMsg, ctx: Context): Question {
  const { ocg, translator } = ctx
  const player = playerOf(m.responsePlayer())
  // Copies of a card in a pile are told apart per action (two Pots of
  // Desires can both be activated), so each label hands out its own.
  const handedOut = new Map<string, Set<Iid>>()
  const cardOf = (c: Where & { code: number }, label = '') => {
    const avoid = handedOut.get(label) ?? new Set<Iid>()
    handedOut.set(label, avoid)
    const iid = translator.cardAt(c, c.code, avoid)
    if (iid) avoid.add(iid)
    return iid
  }
  const name = (code: number) => ocg.card(code)?.name ?? `card ${code}`
  const text = (desc: number) => ocg.describe(desc)?.replace(/\[%ls\]/g, '').trim()
  const hint = (fallback: string) => (ctx.hint !== undefined && text(ctx.hint)?.replace(/\.$/, '')) || fallback
  // The effect that's asking: the top of the chain, while it's being
  // activated or is resolving.
  const top = ctx.chain && translator.state.chain.at(-1)
  const code = top && translator.state.cards[top.card]?.cardId
  const source = top && code !== undefined ? { name: name(code), card: top.card, when: ctx.chain! } : undefined
  // Picking from your own hand or field for a hint that says the card goes.
  const costly = (cards: Where[]) =>
    ctx.hint !== undefined && LOSING_HINTS.includes(ctx.hint) && cards.every((c) => playerOf(c.controller) === player && (c.location & (LOC.hand | LOC.mzone | LOC.szone)) !== 0)
  const cardOption = (c: Where & { code: number }, label: string, group?: string): Option => {
    const card = cardOf(c, label)
    return { label, ...(card && { card }), ...(group && { group }) }
  }
  // A card to pick, named unless it's hidden from the player picking.
  const pickOption = (c: Where & { code: number }, prefix = '', group?: string): Option => {
    const card = cardOf(c, `pick:${prefix}`)
    const hidden = playerOf(c.controller) !== player && !(card && translator.state.cards[card]?.faceUp)
    const label = `${prefix}${hidden ? 'Face-down card' : name(c.code)} (${where(c, player)})`
    return { label, ...(card && { card }), ...(group && { group }) }
  }
  const ask = (kind: GamePrompt['kind'], message: string, options: Option[], answer: (choices: number[]) => Uint8Array, min = 1, max = 1, lost: Where[] = []): Question => ({
    prompt: { id: ctx.id, player, kind, message, ...(source && { source }), ...(lost.length && costly(lost) && { costly: true }), options, min, max },
    answer,
  })

  if (m instanceof M.YGOProMsgSelectIdleCmd || m instanceof M.YGOProMsgSelectBattleCmd) {
    const picks: [number, object | undefined][] = []
    const options: Option[] = []
    const add = (type: number, card: (Where & { code: number }) | undefined, label: string, group: string) => {
      picks.push([type, card])
      options.push(card ? cardOption(card, label, group) : { label, group })
    }
    const activate = (c: Where & { code: number; desc: number }) => {
      const what = text(c.desc)
      return what && what !== 'Activate' ? `Activate: ${what}` : 'Activate'
    }
    if (m instanceof M.YGOProMsgSelectIdleCmd) {
      const T = M.IdleCmdType
      for (const c of m.summonableCards) add(T.SUMMON, c, 'Normal Summon', 'Summon')
      for (const c of m.spSummonableCards) add(T.SPSUMMON, c, 'Special Summon', 'Summon')
      for (const c of m.msetableCards) add(T.MSET, c, 'Set', 'Set')
      for (const c of m.ssetableCards) add(T.SSET, c, 'Set', 'Set')
      for (const c of m.reposableCards) add(T.REPOS, c, 'Change position', 'Position')
      for (const c of m.activatableCards) add(T.ACTIVATE, c, activate(c), 'Activate')
      if (m.canBp) add(T.TO_BP, undefined, 'Battle Phase', 'Phase')
      if (m.canEp) add(T.TO_EP, undefined, 'End turn', 'Phase')
      if (m.canShuffle) add(T.SHUFFLE, undefined, 'Shuffle hand', 'Phase')
      return ask('idle', 'Your move', options, ([i]) => m.prepareResponse(picks[i][0], picks[i][1] as never))
    }
    const T = M.BattleCmdType
    for (const c of m.attackableCards) add(T.ATTACK, c, c.directAttack ? 'Attack directly' : 'Attack', 'Attack')
    for (const c of m.activatableCards) add(T.ACTIVATE, c, activate(c), 'Activate')
    if (m.canM2) add(T.TO_M2, undefined, 'Main Phase 2', 'Phase')
    if (m.canEp) add(T.TO_EP, undefined, 'End turn', 'Phase')
    return ask('battle', 'Battle Phase', options, ([i]) => m.prepareResponse(picks[i][0], picks[i][1] as never))
  }

  if (m instanceof M.YGOProMsgSelectChain) {
    if (!m.chains.length) return { auto: m.defaultResponse() }
    const forced = m.chains.some((c) => c.forced)
    const options = m.chains.map((c) => cardOption(c, text(c.desc) ? `Activate: ${text(c.desc)}` : 'Activate', 'Activate'))
    if (!forced) options.push({ label: "Don't respond", group: 'Pass' })
    const to = translator.state.chain.at(-1)
    const toCode = to && translator.state.cards[to.card]?.cardId
    const respond = toCode !== undefined ? `Respond to ${name(toCode)}?` : 'Respond with a chain?'
    return ask('chain', forced ? 'Activate a trigger effect' : respond, options, ([i]) => (i === m.chains.length ? m.defaultResponse() : m.prepareResponse(m.chains[i])))
  }

  if (m instanceof M.YGOProMsgSelectEffectYn) {
    const card = cardOf(m)
    // The core's text has blanks for the card's name; two of them is its
    // stock "activate the trigger effect of" line.
    const raw = ocg.describe(m.desc) ?? ''
    const blanks = raw.split('[%ls]').length - 1
    const message = blanks === 1 ? raw.replace('[%ls]', name(m.code)) : `${name(m.code)}: ${blanks || !raw ? 'activate its effect?' : raw}`
    return { prompt: { id: ctx.id, player, kind: 'yesno', message, options: [{ label: 'Yes', ...(card && { card }) }, { label: 'No' }], min: 1, max: 1 }, answer: ([i]) => m.prepareResponse(i === 0) }
  }
  if (m instanceof M.YGOProMsgSelectYesNo) {
    return ask('yesno', text(m.desc) ?? 'Yes or no?', [{ label: 'Yes' }, { label: 'No' }], ([i]) => m.prepareResponse(i === 0))
  }
  if (m instanceof M.YGOProMsgSelectOption) {
    if (m.options.length === 1) return { auto: m.prepareResponse(m.options[0]) }
    return ask('option', hint('Choose an effect'), m.options.map((d, i) => ({ label: text(d) ?? `Option ${i + 1}` })), ([i]) => m.prepareResponse(m.options[i]))
  }

  if (m instanceof M.YGOProMsgSelectCard || m instanceof M.YGOProMsgSelectTribute) {
    const kind = m instanceof M.YGOProMsgSelectTribute ? 'tribute' : 'cards'
    const options = m.cards.map((c) => pickOption(c))
    return ask(kind, hint(kind === 'tribute' ? 'Select monsters to Tribute' : 'Select cards'), options, (is) => m.prepareResponse(is.map((i) => M.IndexResponse(i))), m.min, m.max, m.cards)
  }
  if (m instanceof M.YGOProMsgSelectUnselectCard) {
    const options = [
      ...m.selectableCards.map((c) => pickOption(c, '', 'Select')),
      ...m.unselectableCards.map((c) => pickOption(c, 'Unselect ', 'Unselect')),
    ]
    if (m.finishable) options.push({ label: 'Done', group: 'Done' })
    const all = [...m.selectableCards, ...m.unselectableCards]
    return ask('unselect', hint('Select cards'), options, ([i]) => (i >= all.length ? m.prepareResponse(null) : m.prepareResponse(all[i])), 1, 1, all)
  }
  if (m instanceof M.YGOProMsgSelectSum) {
    const options = m.cards.map((c) => pickOption(c))
    const message = `${hint('Select cards')} (they must add up to ${m.sumVal})`
    return ask('sum', message, options, (is) => m.prepareResponse(is.map((i) => m.cards[i])), 1, m.cards.length, m.cards)
  }

  if (m instanceof M.YGOProMsgSelectPosition) {
    const allowed = POSITIONS.filter(([bit]) => m.positions & bit)
    if (allowed.length === 1) return { auto: m.prepareResponse(allowed[0][0]) }
    return ask('position', `${name(m.code)}: which position?`, allowed.map(([, label]) => ({ label })), ([i]) => m.prepareResponse(allowed[i][0]))
  }

  // Which zone a card goes to: the first free one. Choosing zones to
  // disable (Disfield) matters more, so that's asked.
  if (m instanceof M.YGOProMsgSelectPlaceCommon) {
    const places = m.getSelectablePlaces()
    const n = Math.max(1, m.count)
    if (!(m instanceof M.YGOProMsgSelectDisField)) return { auto: m.prepareResponse(places.slice(0, n)) }
    const options = places.map((p) => ({ label: zoneName(p, player), zone: zoneFor({ controller: p.player, location: p.location, sequence: p.sequence }) }))
    return ask('place', hint('Choose zones'), options, (is) => m.prepareResponse(is.map((i) => places[i])), n, n)
  }

  if (m instanceof M.YGOProMsgAnnounceCard) {
    // Every declarable card if that's a short list, else those in this game.
    const everything = [...ocg.cards()].filter((c) => declarable(c, m.opcodes))
    const pool = everything.length <= 300 ? everything : ctx.codes.map((c) => ocg.card(c)).filter((c) => c && declarable(c, m.opcodes))
    const codes = [...new Set(pool.map((c) => c!.code))].sort((a, b) => name(a).localeCompare(name(b)))
    return ask('announce', hint('Declare a card name'), codes.map((c) => ({ label: name(c) })), ([i]) => m.prepareResponse(codes[i]))
  }
  if (m instanceof M.YGOProMsgAnnounceNumber) {
    return ask('announce', hint('Declare a number'), m.numbers.map((n) => ({ label: String(n) })), ([i]) => m.prepareResponse(i))
  }
  if (m instanceof M.YGOProMsgAnnounceRace || m instanceof M.YGOProMsgAnnounceAttrib) {
    const race = m instanceof M.YGOProMsgAnnounceRace
    const names = race ? RACES : ATTRIBUTES
    const mask = race ? m.availableRaces : m.availableAttributes
    const bits = names.map((_, i) => 1 << i).filter((b) => mask & b)
    const options = bits.map((b) => ({ label: names[Math.log2(b)] }))
    return ask('announce', hint(race ? 'Declare a Type' : 'Declare an Attribute'), options, (is) => m.prepareResponse(is.reduce((acc, i) => acc | bits[i], 0)), m.count, m.count)
  }

  // Sorting, rock-paper-scissors and the rest: the core's default.
  const fallback = m.defaultResponse()
  if (fallback) return { auto: fallback }
  throw new Error(`no way to ask ${m.constructor.name} yet`)
}

// The last "select a..." hint before a prompt (the last message), for its
// message.
export function selectHint(messages: unknown[], player: number): number | undefined {
  for (let i = messages.length - 2; i >= 0; i--) {
    const h = messages[i]
    if (h instanceof M.YGOProMsgHint && h.type === HINT_SELECTMSG && h.player === player) return h.desc
    if (h instanceof M.YGOProMsgResponseBase) return undefined
  }
  return undefined
}

// The core's test for "can this name be declared": a little stack machine
// over the card's data, as in ocgcore's is_declarable.
const OP = { add: 0x40000000, sub: 0x40000001, mul: 0x40000002, div: 0x40000003, and: 0x40000004, or: 0x40000005, neg: 0x40000006, not: 0x40000007, isCode: 0x40000100, isSetCard: 0x40000101, isType: 0x40000102, isRace: 0x40000103, isAttribute: 0x40000104 }
const TYPE_TOKEN = 0x4000

function inSet(setcodes: bigint, set: number): boolean {
  for (let s = setcodes; s > 0n; s >>= 16n) {
    const one = Number(s & 0xffffn)
    if ((one & 0xfff) === (set & 0xfff) && (one & set) === set) return true
  }
  return false
}

export function declarable(card: CardData, opcodes: number[]): boolean {
  if (card.type & TYPE_TOKEN || card.alias) return false
  const stack: number[] = []
  const pop = () => stack.pop() ?? 0
  for (const op of opcodes) {
    switch (op) {
      case OP.add: stack.push(pop() + pop()); break
      case OP.sub: { const r = pop(); stack.push(pop() - r); break }
      case OP.mul: stack.push(pop() * pop()); break
      case OP.div: { const r = pop(); const l = pop(); stack.push(r ? Math.trunc(l / r) : 0); break }
      case OP.and: { const r = pop(); const l = pop(); stack.push(r && l ? 1 : 0); break }
      case OP.or: { const r = pop(); const l = pop(); stack.push(r || l ? 1 : 0); break }
      case OP.neg: stack.push(-pop()); break
      case OP.not: stack.push(pop() ? 0 : 1); break
      case OP.isCode: stack.push(card.code === pop() ? 1 : 0); break
      case OP.isSetCard: stack.push(inSet(card.setcode, pop()) ? 1 : 0); break
      case OP.isType: stack.push(card.type & pop() ? 1 : 0); break
      case OP.isRace: stack.push(card.race & pop() ? 1 : 0); break
      case OP.isAttribute: stack.push(card.attribute & pop() ? 1 : 0); break
      default: stack.push(op)
    }
  }
  return stack.length !== 1 || stack[0] !== 0
}

const PLACES: Record<number, string> = { [LOC.deck]: 'Deck', [LOC.hand]: 'hand', [LOC.grave]: 'GY', [LOC.removed]: 'banished', [LOC.extra]: 'Extra Deck', [LOC.mzone]: 'field', [LOC.szone]: 'field' }

function where(c: Where, player: Player): string {
  const whose = playerOf(c.controller) === player ? 'your' : "opponent's"
  if (c.location & LOC.overlay) return `${whose} Xyz material`
  return `${whose} ${PLACES[c.location] ?? 'field'}`
}

function zoneName(p: { player: number; location: number; sequence: number }, player: Player): string {
  const whose = playerOf(p.player) === player ? 'Your' : "Opponent's"
  if (p.location === LOC.mzone) return p.sequence >= 5 ? `Extra Monster Zone ${p.sequence - 4}` : `${whose} Monster Zone ${p.sequence + 1}`
  if (p.location === LOC.szone) return p.sequence === 5 ? `${whose} Field Zone` : `${whose} Spell & Trap Zone ${p.sequence + 1}`
  return `${whose} zone`
}
