// The trained bot: ygo-agent, a neural net served over HTTP (docker-compose's
// ygo-agent, docs/BOT-PLAN.md). Each question from the rules core is sent
// with the table as its player sees it, and it gives back a probability per
// option; we play the likeliest. It picks cards one at a time, so a question
// that takes several is several calls.
//
// It knows only the cards in data/ygo-agent/code_list.txt. Any other card is
// sent as unknown (code 0) with its stats. A question it can't take (its
// schema has gaps) or a failed call gives undefined, and the caller falls
// back to the random bot.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Phase, Player } from '../../src/engine'
import { indexOf, type OcgDuel } from './duel'
import { LOC, M, type Ocg, type PromptMsg } from './lib'

export const agentUrl = () => process.env.YGO_AGENT_URL

let codeList: Set<number> | undefined
// The cards it has an embedding for.
export function agentCodes(root: string): Set<number> {
  return (codeList ??= new Set(
    readFileSync(join(root, 'data/ygo-agent/code_list.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map(Number),
  ))
}

// Everything about a card on the table, from the core.
const QUERY_ALL = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 | 0x10000 | 0x20000 | 0x80000 | 0x800000
const STATUS_NEGATED = 0x0001 | 0x400000 // disabled, forbidden
const FACEDOWN = 0x2 | 0x8

const LOCATIONS: [number, string][] = [
  [LOC.deck, 'deck'],
  [LOC.hand, 'hand'],
  [LOC.mzone, 'mzone'],
  [LOC.szone, 'szone'],
  [LOC.grave, 'grave'],
  [LOC.removed, 'removed'],
  [LOC.extra, 'extra'],
]
// What the other player can't see of these is every card in them.
const HIDDEN = new Set<number>([LOC.deck, LOC.hand, LOC.extra])
const POSITIONS: Record<number, string> = { 0x1: 'faceup_attack', 0x2: 'facedown_attack', 0x3: 'attack', 0x4: 'faceup_defense', 0x5: 'faceup', 0x8: 'facedown_defense', 0xa: 'facedown', 0xc: 'defense' }
const ATTRIBUTES = ['earth', 'water', 'fire', 'wind', 'light', 'dark', 'divine']
const RACES = [
  'warrior', 'spellcaster', 'fairy', 'fiend', 'zombie', 'machine', 'aqua', 'pyro', 'rock', 'windbeast', 'plant', 'insect', 'thunder',
  'dragon', 'beast', 'beast_warrior', 'dinosaur', 'fish', 'sea_serpent', 'reptile', 'psycho', 'devine', 'creator_god', 'wyrm', 'cyberse', 'illusion',
] // prettier-ignore
const TYPES: [number, string][] = [
  [0x1, 'monster'], [0x2, 'spell'], [0x4, 'trap'], [0x10, 'normal'], [0x20, 'effect'], [0x40, 'fusion'], [0x80, 'ritual'], [0x100, 'trap_monster'],
  [0x200, 'spirit'], [0x400, 'union'], [0x800, 'dual'], [0x1000, 'tuner'], [0x2000, 'synchro'], [0x4000, 'token'], [0x10000, 'quick_play'],
  [0x20000, 'continuous'], [0x40000, 'equip'], [0x80000, 'field'], [0x100000, 'counter'], [0x200000, 'flip'], [0x400000, 'toon'], [0x800000, 'xyz'],
  [0x1000000, 'pendulum'], [0x2000000, 'special'], [0x4000000, 'link'],
] // prettier-ignore
const PHASES: Record<Phase, string> = { draw: 'draw', standby: 'standby', main1: 'main1', battle: 'battle_step', main2: 'main2', end: 'end' }
// The system strings it has a feature for; any other description is sent as none.
const SYSTEM_STRINGS = new Set([
  1050, 1051, 1052, 1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061, 1062, 1063, 1064, 1066, 1067, 1068, 1069, 1070, 1071, 1072, 1073, 1074, 1075, 1076,
  1080, 1081, 1150, 1151, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1162, 1163, 1164, 1165, 1166, 1167, 1168, 1169, 1190, 1191, 1192,
  1193, 1, 30, 31, 80, 81, 90, 91, 92, 93, 94, 95, 96, 97, 98, 200, 203, 210, 218, 219, 220, 221, 222, 1621, 1622,
]) // prettier-ignore
const DESCRIPTION_LIMIT = 10000

const lowestBit = (bits: number, names: string[]) => names[Math.max(0, 31 - Math.clz32(bits & -bits))] ?? 'none'

// Where the game stands, for the player the bot answers for.
export type AgentContext = { ocg: Ocg; duel: OcgDuel; me: Player; turn: number; phase: Phase; active: Player }

type Place = { controller: number; location: number; sequence: number; subsequence?: number }
type Pred = { prob: number; response: number; can_finish: boolean }
// A question in its words, and the answer each option stands for (by its
// place in the reply).
type Ask = { data: Record<string, unknown>; answer: (index: number) => Uint8Array | undefined }

export class AgentBot {
  private url: string
  private codes: Set<number>
  private duelId?: string
  private index = 0
  private prev = 0
  // Questions it couldn't take, for the log.
  readonly missed: string[] = []

  constructor(url: string, codes: Set<number>) {
    this.url = url.replace(/\/$/, '')
    this.codes = codes
  }

  // The response to play, or undefined to fall back.
  async respond(m: PromptMsg, ctx: AgentContext): Promise<Uint8Array | undefined> {
    try {
      return await this.pick(m, ctx)
    } catch (e) {
      this.missed.push(`${m.constructor.name}: ${(e as Error).message}`)
      if (this.missed.length > 200) this.missed.shift()
      // A failed call leaves its record of the duel unusable: start another.
      void this.close()
      return undefined
    }
  }

  async close() {
    const id = this.duelId
    this.duelId = undefined
    this.index = this.prev = 0
    if (id) await fetch(`${this.url}/v0/duels/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  private async pick(m: PromptMsg, ctx: AgentContext): Promise<Uint8Array | undefined> {
    const me = indexOf(ctx.me)
    const loc = (c: Place) => this.location(c, me)
    const info = (c: Place & { code: number }) => ({ code: this.code(ctx, c.code), controller: c.controller === me ? 'me' : 'opponent', location: locationName(c.location), sequence: c.sequence })
    const one = (ask: Ask) => this.predict(ctx, ask.data).then((preds) => ask.answer(best(preds)))

    if (m instanceof M.YGOProMsgSelectIdleCmd) {
      const cmds: [string, number, (Place & { code: number; desc?: number }) | undefined][] = [
        ...m.summonableCards.map((c) => ['summon', M.IdleCmdType.SUMMON, c] as [string, number, typeof c]),
        ...m.spSummonableCards.map((c) => ['sp_summon', M.IdleCmdType.SPSUMMON, c] as [string, number, typeof c]),
        ...m.reposableCards.map((c) => ['reposition', M.IdleCmdType.REPOS, c] as [string, number, typeof c]),
        ...m.msetableCards.map((c) => ['mset', M.IdleCmdType.MSET, c] as [string, number, typeof c]),
        ...m.ssetableCards.map((c) => ['set', M.IdleCmdType.SSET, c] as [string, number, typeof c]),
        ...m.activatableCards.map((c) => ['activate', M.IdleCmdType.ACTIVATE, c] as [string, number, typeof c]),
        ...(m.canBp ? [['to_bp', M.IdleCmdType.TO_BP, undefined] as [string, number, undefined]] : []),
        ...(m.canEp ? [['to_ep', M.IdleCmdType.TO_EP, undefined] as [string, number, undefined]] : []),
      ]
      return one({
        data: {
          msg_type: 'select_idlecmd',
          idle_cmds: cmds.map(([cmd_type, , c], i) => ({ cmd_type, ...(c && { data: { card_info: info(c), effect_description: this.desc(ctx, c.code, c.desc ?? 0), response: i } }) })),
        },
        answer: (i) => m.prepareResponse(cmds[i][1], cmds[i][2] as never),
      })
    }
    if (m instanceof M.YGOProMsgSelectBattleCmd) {
      const cmds: [string, number, (Place & { code: number; desc?: number; directAttack?: number }) | undefined][] = [
        ...m.attackableCards.map((c) => ['attack', M.BattleCmdType.ATTACK, c] as [string, number, typeof c]),
        ...m.activatableCards.map((c) => ['activate', M.BattleCmdType.ACTIVATE, c] as [string, number, typeof c]),
        ...(m.canM2 ? [['to_m2', M.BattleCmdType.TO_M2, undefined] as [string, number, undefined]] : []),
        ...(m.canEp ? [['to_ep', M.BattleCmdType.TO_EP, undefined] as [string, number, undefined]] : []),
      ]
      return one({
        data: {
          msg_type: 'select_battlecmd',
          battle_cmds: cmds.map(([cmd_type, , c], i) => ({
            cmd_type,
            ...(c && { data: { card_info: info(c), effect_description: this.desc(ctx, c.code, c.desc ?? 0), direct_attackable: !!c.directAttack, response: i } }),
          })),
        },
        answer: (i) => m.prepareResponse(cmds[i][1], cmds[i][2] as never),
      })
    }
    if (m instanceof M.YGOProMsgSelectChain) {
      const forced = m.chains.some((c) => c.forced)
      return one({
        data: {
          msg_type: 'select_chain',
          forced,
          chains: m.chains.map((c, i) => ({ code: this.code(ctx, c.code), location: loc(c), effect_description: this.desc(ctx, c.code, c.desc), response: i })),
        },
        answer: (i) => (i < m.chains.length ? m.prepareResponse(m.chains[i]) : m.defaultResponse()),
      })
    }
    if (m instanceof M.YGOProMsgSelectEffectYn) {
      return one({
        data: { msg_type: 'select_effectyn', code: this.code(ctx, m.code), location: loc(m), effect_description: this.desc(ctx, m.code, m.desc) },
        answer: (i) => m.prepareResponse(i === 0),
      })
    }
    if (m instanceof M.YGOProMsgSelectYesNo) {
      return one({ data: { msg_type: 'select_yesno', effect_description: this.desc(ctx, 0, m.desc) }, answer: (i) => m.prepareResponse(i === 0) })
    }
    if (m instanceof M.YGOProMsgSelectPosition) {
      const positions = [0x1, 0x2, 0x4, 0x8].filter((b) => m.positions & b)
      return one({ data: { msg_type: 'select_position', code: this.code(ctx, m.code), positions: positions.map((p) => POSITIONS[p]) }, answer: (i) => m.prepareResponse(positions[i]) })
    }
    if (m instanceof M.YGOProMsgSelectOption) {
      return one({
        data: { msg_type: 'select_option', options: m.options.map((o, i) => ({ code: this.desc(ctx, 0, o), response: i })) },
        answer: (i) => m.prepareResponse(M.IndexResponse(i)),
      })
    }
    if (m instanceof M.YGOProMsgSelectPlaceCommon) {
      if (m.count > 1) throw new Error('more than one zone')
      const places = m.getSelectablePlaces()
      return one({
        data: {
          msg_type: m instanceof M.YGOProMsgSelectDisField ? 'select_disfield' : 'select_place',
          count: m.count,
          places: places.map((p) => ({ controller: p.player === me ? 'me' : 'opponent', location: locationName(p.location), sequence: p.sequence })),
        },
        answer: (i) => m.prepareResponse([places[i]]),
      })
    }
    if (m instanceof M.YGOProMsgSelectUnselectCard) {
      const cards = m.selectableCards
      return one({
        data: {
          msg_type: 'select_unselect_card',
          finishable: !!m.finishable,
          cancelable: !!m.cancelable,
          min: m.min,
          max: m.max,
          selected_cards: [],
          selectable_cards: cards.map((c, i) => ({ location: loc(c), response: i })),
        },
        answer: (i) => m.prepareResponse(i < cards.length ? M.IndexResponse(i) : null),
      })
    }
    if (m instanceof M.YGOProMsgSelectCard || m instanceof M.YGOProMsgSelectTribute) {
      // One card a call, until it finishes or has the most it may take. Each
      // option's response is its card's place in the list, or -1 to finish.
      const tribute = m instanceof M.YGOProMsgSelectTribute
      const selected: number[] = []
      while (selected.length < m.max) {
        const preds = await this.predict(ctx, {
          msg_type: tribute ? 'select_tribute' : 'select_card',
          cancelable: !!m.cancelable,
          min: m.min,
          max: m.max,
          cards: m.cards.map((c, i) => ({ location: loc(c), response: i, ...(tribute && { level: (c as { releaseParam: number }).releaseParam }) })),
          selected,
        })
        const i = preds[best(preds)].response
        if (i < 0 || i >= m.cards.length || selected.includes(i)) break
        selected.push(i)
      }
      if (selected.length < m.min) throw new Error('finished with too few cards')
      return m.prepareResponse(selected.map((i) => M.IndexResponse(i)))
    }
    if (m instanceof M.YGOProMsgSelectSum) {
      const card = (c: Place & { opParam: number }, i: number) => ({ location: loc(c), level1: c.opParam & 0xffff, level2: c.opParam >>> 16, response: i })
      const selected: number[] = []
      for (;;) {
        const preds = await this.predict(ctx, {
          msg_type: 'select_sum',
          overflow: m.mode !== 0,
          level_sum: m.sumVal,
          min: m.min,
          max: m.max,
          cards: m.cards.map(card),
          must_cards: m.mustSelectCards.map(card),
          selected,
        })
        const pick = preds[best(preds)]
        const i = pick.response
        if (i < 0 || i >= m.cards.length || selected.includes(i)) throw new Error('no card to add to the sum')
        selected.push(i)
        if (pick.can_finish) break
      }
      return m.prepareResponse(selected.map((i) => M.IndexResponse(i)))
    }
    if (m instanceof M.YGOProMsgAnnounceAttrib) {
      const bits = ATTRIBUTES.map((_, i) => 1 << i).filter((b) => m.availableAttributes & b)
      return one({
        data: { msg_type: 'announce_attrib', count: m.count, attributes: bits.map((b, i) => ({ attribute: lowestBit(b, ATTRIBUTES), response: i })) },
        answer: (i) => m.prepareResponse(bits[i]),
      })
    }
    if (m instanceof M.YGOProMsgAnnounceNumber) {
      return one({
        data: { msg_type: 'announce_number', count: m.count, numbers: m.numbers.map((number, i) => ({ number, response: i })) },
        answer: (i) => m.prepareResponse(M.IndexResponse(i)),
      })
    }
    throw new Error('not a question it takes')
  }

  // One call: the question with the table, for a probability per option.
  private async predict(ctx: AgentContext, data: Record<string, unknown>): Promise<Pred[]> {
    if (!this.duelId) {
      const created = (await this.post('/v0/duels')) as { duelId: string; index: number }
      this.duelId = created.duelId
      this.index = created.index
      this.prev = 0
    }
    const other = ctx.me === 'p1' ? 'p2' : 'p1'
    const body = {
      index: this.index,
      prev_action_idx: this.prev,
      input: {
        global: {
          my_lp: ctx.duel.lp(ctx.me),
          op_lp: ctx.duel.lp(other),
          turn: ctx.turn,
          phase: PHASES[ctx.phase],
          is_first: ctx.me === 'p1',
          is_my_turn: ctx.active === ctx.me,
        },
        cards: [...this.cards(ctx, ctx.me, false), ...this.cards(ctx, other, true)].slice(0, 160),
        action_msg: { data },
      },
    }
    const res = (await this.post(`/v0/duels/${this.duelId}/predict`, body)) as { error?: string; index?: number; predict_results?: { action_preds: Pred[] } }
    if (res.error || !res.predict_results) throw new Error(res.error ?? 'no prediction')
    this.index = res.index!
    const preds = res.predict_results.action_preds
    this.prev = best(preds)
    return preds
  }

  private async post(path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(this.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`${res.status} from the bot`)
    return res.json()
  }

  // A player's cards as the bot sees them: its own in full, the other's
  // hidden ones as blanks.
  private cards(ctx: AgentContext, player: Player, opponent: boolean): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    const controller = opponent ? 'opponent' : 'me'
    const blank = (location: string, sequence: number, position: string) => ({
      code: 0, location, sequence, controller, position, overlay_sequence: -1, attribute: 'none', race: 'none', level: 0, counter: 0, negated: false, attack: 0, defense: 0, types: [],
    }) // prettier-ignore
    for (const [bit, location] of LOCATIONS) {
      const found = ctx.duel.fieldCards(player, bit, QUERY_ALL)
      for (const [sequence, c] of found.entries()) {
        if (!c || c.empty || !c.code) continue
        const position = POSITIONS[c.position ?? 0] ?? 'none'
        if (opponent && (HIDDEN.has(bit) || (c.position ?? 0) & FACEDOWN)) {
          out.push(blank(location, sequence, HIDDEN.has(bit) ? 'facedown' : position))
          continue
        }
        const type = c.type ?? 0
        out.push({
          code: this.code(ctx, c.code),
          location,
          sequence,
          controller,
          position: bit === LOC.deck ? 'facedown' : position,
          overlay_sequence: -1,
          attribute: lowestBit(c.attribute ?? 0, ATTRIBUTES),
          race: lowestBit(c.race ?? 0, RACES),
          level: ((c.level ?? 0) & 0xff) || ((c.rank ?? 0) & 0xff) || (c.link ?? 0),
          counter: c.counters?.[0]?.count ?? 0,
          negated: !!((c.status ?? 0) & STATUS_NEGATED),
          attack: Math.max(0, c.attack ?? 0),
          defense: Math.max(0, c.defense ?? 0),
          types: TYPES.filter(([b]) => type & b).map(([, t]) => t),
        })
        for (const [i, code] of (c.overlayCards ?? []).entries()) {
          const data = ctx.ocg.card(code)
          out.push({
            ...blank(location, sequence, 'faceup'),
            code: this.code(ctx, code),
            overlay_sequence: i,
            attribute: lowestBit(data?.attribute ?? 0, ATTRIBUTES),
            race: lowestBit(data?.race ?? 0, RACES),
            attack: Math.max(0, data?.atk ?? 0),
            defense: Math.max(0, data?.def ?? 0),
            types: TYPES.filter(([b]) => (data?.type ?? 0) & b).map(([, t]) => t),
          })
        }
      }
    }
    return out
  }

  // The code it knows a card by: its own, or the card it's another printing
  // of. 0 if it doesn't know it.
  private code(ctx: AgentContext, code: number): number {
    if (this.codes.has(code)) return code
    const alias = ctx.ocg.card(code)?.alias
    return alias && this.codes.has(alias) ? alias : 0
  }

  // An effect's description: a card's nth text (code << 4 | n) or a system
  // string. Sent as none unless it has a feature for it.
  private desc(ctx: AgentContext, code: number, desc: number): number {
    if (desc < DESCRIPTION_LIMIT) return SYSTEM_STRINGS.has(desc) ? desc : 0
    const known = this.code(ctx, desc >>> 4)
    return known && (!code || this.code(ctx, code)) ? known * 16 + (desc & 0xf) : 0
  }

  private location(c: Place, me: number) {
    const overlay = !!(c.location & LOC.overlay)
    return { controller: c.controller === me ? 'me' : 'opponent', location: locationName(c.location & ~LOC.overlay), sequence: c.sequence, overlay_sequence: overlay ? (c.subsequence ?? 0) : -1 }
  }
}

function locationName(location: number): string {
  const found = LOCATIONS.find(([bit]) => location & bit)
  if (!found) throw new Error(`a location it has no name for (${location})`)
  return found[1]
}

// The likeliest option; one it can't take has probability -1.
function best(preds: Pred[]): number {
  let at = 0
  for (const [i, p] of preds.entries()) if (p.prob > preds[at].prob) at = i
  if (!preds.length || preds[at].prob < 0) throw new Error('no option it can take')
  return at
}
