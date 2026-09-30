// Turns the rules core's messages into our engine's steps, so a duel on the
// core plays on the existing board, timeline and session stream.
//
// The core names cards by where they are (controller, location, sequence);
// we name them by iid. Field slots line up one to one. In piles (Deck, hand,
// GY, banished, Extra Deck) copies of a card are interchangeable, so a card
// leaving a pile is found by its code, and our Deck order never matters.
import {
  applyAction,
  type Action,
  type BoardState,
  type Iid,
  type Intent,
  type Phase,
  type Player,
  type Position,
  type Step,
  type SummonMethod,
  type ZoneRef,
} from '../../src/engine'
import { LOC, M, POS, QUERY, type Msg, type Ocg } from './lib'
import { playerOf, type OcgDuel } from './duel'

type Where = { controller: number; location: number; sequence: number; position?: number }

const PHASES: [number, Phase][] = [
  [0x01, 'draw'],
  [0x02, 'standby'],
  [0x04, 'main1'],
  [0xf8, 'battle'], // battle start/step, damage, damage calculation, battle
  [0x100, 'main2'],
  [0x200, 'end'],
]
const PHASE_ORDER = PHASES.map(([, p]) => p)
const phaseOf = (bits: number) => PHASES.find(([mask]) => bits & mask)?.[1]

const TYPE = { fusion: 0x40, ritual: 0x80, synchro: 0x2000, xyz: 0x800000, link: 0x4000000 }

export function zoneFor({ controller, location, sequence }: Where): ZoneRef {
  const player = playerOf(controller)
  switch (location) {
    case LOC.deck:
      return { player, zone: 'deck' }
    case LOC.hand:
      return { player, zone: 'hand' }
    case LOC.grave:
      return { player, zone: 'gy' }
    case LOC.removed:
      return { player, zone: 'banished' }
    case LOC.extra:
      return { player, zone: 'extraDeck' }
    case LOC.mzone:
      // Extra Monster Zones are numbered from each player's own left.
      if (sequence >= 5) return { zone: 'extraMonster', slot: controller === 0 ? sequence - 5 : 6 - sequence }
      return { player, zone: 'monster', slot: sequence }
    case LOC.szone:
      return sequence === 5 ? { player, zone: 'fieldSpell', slot: 0 } : { player, zone: 'spellTrap', slot: sequence }
  }
  throw new Error(`no zone for core location ${location}`)
}

const face = (pos: number): { faceUp: boolean; position: Position } => ({
  faceUp: !!(pos & (POS.faceUpAtk | POS.faceUpDef)),
  position: pos & (POS.faceUpDef | POS.faceDownDef) ? 'def' : 'atk',
})

const isField = (location: number) => location === LOC.mzone || location === LOC.szone

export class Translator {
  state: BoardState
  problems: string[] = [] // messages that didn't translate; empty when all is well
  private steps: Step[] = []
  private current?: Step
  private turns = 0
  private tokens = 0
  private ocg: Ocg
  private duel: OcgDuel

  constructor(initial: BoardState, ocg: Ocg, duel: OcgDuel) {
    this.state = initial
    this.ocg = ocg
    this.duel = duel
  }

  // Translate one batch (everything up to the next prompt). actor is who gave
  // the answer that led to it.
  feed(messages: Msg[], actor?: Player): Step[] {
    this.steps = []
    this.current = undefined
    for (const m of messages) {
      try {
        this.message(m, actor)
      } catch (e) {
        this.problems.push(`${m.constructor.name}: ${(e as Error).message}`)
      }
    }
    this.syncStats(actor)
    this.flush()
    return this.steps
  }

  // The card a prompt means, if we can place it. Copies in a pile are
  // interchangeable, so avoid says which were already handed out.
  cardAt(where: Where, code: number, avoid = new Set<Iid>()): Iid | undefined {
    try {
      const ref = zoneFor(where)
      if (!(where.location & LOC.overlay) && ref.slot === undefined) {
        const pile = this.state.players[ref.player!].zones[ref.zone as 'hand']
        return pile.find((i) => this.state.cards[i].cardId === code && !avoid.has(i)) ?? pile.find((i) => this.state.cards[i].cardId === code)
      }
      return this.from(where, code)
    } catch {
      return undefined
    }
  }

  name(iid: Iid) {
    const c = this.state.cards[iid]
    return c?.custom?.name ?? (c?.cardId !== undefined ? this.ocg.card(c.cardId)?.name : undefined) ?? iid
  }

  private message(m: Msg, actor?: Player) {
    const author = actor && (actor === 'p1' ? 'user' : 'claude')
    if (m instanceof M.YGOProMsgNewTurn) {
      if (this.turns++ === 0) return // the setup is already turn 1
      this.begin({ label: `Turn ${this.state.turn + 1}` }, author)
      this.act({ type: 'nextTurn' })
    } else if (m instanceof M.YGOProMsgNewPhase) {
      const phase = phaseOf(m.phase)
      if (!phase || phase === this.state.phase) return
      // A position that starts in Main Phase 1 has no Draw or Standby Phase to show.
      if (this.turns === 1 && PHASE_ORDER.indexOf(phase) < PHASE_ORDER.indexOf(this.state.phase)) return
      this.begin({ label: PHASE_LABEL[phase] }, author)
      this.act({ type: 'phase', phase })
    } else if (m instanceof M.YGOProMsgDraw) {
      for (const raw of m.cards)
        this.act({ type: 'move', card: this.inPile(playerOf(m.player), 'deck', raw & 0x7fffffff), to: { player: playerOf(m.player), zone: 'hand' } })
      this.labelIfNone(m.count === 1 ? 'Draw' : `Draw ${m.count}`, author)
    } else if (m instanceof M.YGOProMsgMove) {
      this.move(m, author)
    } else if (m instanceof M.YGOProMsgPosChange) {
      const iid = this.at({ ...m.card }, m.code)
      this.setPosition(iid, m.currentPosition, m.card.location === LOC.mzone)
      this.labelIfNone(`Change ${this.name(iid)}'s position`, author)
    } else if (m instanceof M.YGOProMsgSummoning || m instanceof M.YGOProMsgSpSummoning || m instanceof M.YGOProMsgFlipSummoning) {
      const iid = this.at(m, m.code)
      // A Flip Summon has no position message of its own: the new position
      // comes on this one.
      if (m instanceof M.YGOProMsgFlipSummoning) this.setPosition(iid, m.position, true)
      const method = m instanceof M.YGOProMsgSummoning ? 'normal' : m instanceof M.YGOProMsgFlipSummoning ? 'flip' : this.specialMethod(m.code)
      this.markSummon(iid, method)
      const intent: Intent = method === 'normal' ? { type: 'normalSummon', card: iid } : { type: 'specialSummon', card: iid, method }
      this.setLabel(`${SUMMON_LABEL[method]} ${this.name(iid)}`, intent, author)
    } else if (m instanceof M.YGOProMsgChaining) {
      const iid = this.at(m, m.code)
      this.begin({ label: `Activate ${this.name(iid)}`, intent: { type: 'activate', card: iid } }, author)
      this.act({ type: 'chainPush', card: iid, player: playerOf(m.controller) })
    } else if (m instanceof M.YGOProMsgChainSolved) {
      const link = this.state.chain.at(-1)
      if (!link) return
      this.begin({ label: `Resolve ${this.name(link.card)}` }, author)
      this.act({ type: 'chainResolve' })
    } else if (m instanceof M.YGOProMsgChainEnd) {
      while (this.state.chain.length) this.act({ type: 'chainResolve' })
    } else if (m instanceof M.YGOProMsgAttack) {
      const attacker = this.at(m.attacker)
      const target = m.defender.location ? this.at(m.defender) : undefined
      this.begin(
        { label: `${this.name(attacker)} attacks ${target ? this.name(target) : 'directly'}`, intent: { type: 'attack', attacker, ...(target && { target }) } },
        author,
      )
      this.act(target ? { type: 'arrow', from: attacker, to: target } : { type: 'highlight', cards: [attacker] })
    } else if (m instanceof M.YGOProMsgDamage || m instanceof M.YGOProMsgPayLpCost) {
      const value = m instanceof M.YGOProMsgDamage ? m.value : m.cost
      this.act({ type: 'lp', player: playerOf(m.player), delta: -value })
    } else if (m instanceof M.YGOProMsgRecover) {
      this.act({ type: 'lp', player: playerOf(m.player), delta: m.value })
    } else if (m instanceof M.YGOProMsgLpUpdate) {
      this.act({ type: 'lp', player: playerOf(m.player), set: m.lp })
    } else if (m instanceof M.YGOProMsgShuffleDeck) {
      this.act({ type: 'shuffle', player: playerOf(m.player), zone: 'deck' })
    } else if (m instanceof M.YGOProMsgConfirmCards) {
      const cards = m.cards.filter((c) => c.location !== LOC.deck).map((c) => this.at(c, c.code))
      if (cards.length) this.act({ type: 'reveal', cards })
    } else if (m instanceof M.YGOProMsgSwap) {
      throw new Error('swapping control of two monsters is not supported yet')
    }
  }

  // Bring a card to the core's position, from wherever ours is. Only
  // monsters turn sideways.
  private setPosition(iid: Iid, pos: number, monster: boolean) {
    const card = this.state.cards[iid]
    const now = face(pos)
    if (card.faceUp !== now.faceUp) this.act({ type: 'flip', card: iid })
    if (monster && card.position !== now.position) this.act({ type: 'position', card: iid, position: now.position })
  }

  private move(m: InstanceType<typeof M.YGOProMsgMove>, author?: Step['author']) {
    const { previous: from, current: to } = m
    const code = m.code & 0x7fffffff
    if (!from.location) {
      // A card from nowhere: a token.
      const player = playerOf(to.controller)
      const data = this.ocg.card(code)
      const card = `${player}-token-${++this.tokens}`
      this.act({
        type: 'create',
        card,
        owner: player,
        custom: { name: data?.name ?? 'Token', text: '', kind: 'monster', atk: data?.atk, def: data?.def },
        to: zoneFor(to),
        ...face(to.position),
      })
      this.labelIfNone(`Summon ${data?.name ?? 'a token'}`, author)
      return
    }
    const iid = this.from(from, code)
    if (!iid) return // a material already sent to the GY along with its host
    if (!to.location) {
      this.act({ type: 'remove', card: iid })
      return
    }
    if (to.location & LOC.overlay) {
      this.act({ type: 'attach', card: iid, to: this.host(to) })
      return
    }
    const dest = zoneFor(to)
    const opts: Partial<ReturnType<typeof face>> = isField(to.location) || to.location === LOC.removed ? face(to.position) : {}
    if (from.location & LOC.overlay) this.act({ type: 'detach', card: iid, to: dest })
    else this.act({ type: 'move', card: iid, to: dest, ...opts, ...(to.location === LOC.deck && { index: 0 }) })
    this.labelIfNone(moveLabel(this.name(iid), from.location, to.location, opts.faceUp), author)
  }

  // The card at a core location, before it moves.
  private from(where: Where, code: number): Iid | undefined {
    if (!(where.location & LOC.overlay)) return this.at(where, code)
    const host = this.state.cards[this.host(where)]
    const mat = host.materials.find((m) => this.state.cards[m].cardId === code)
    if (mat) return mat
    // Our engine sends materials to the GY when their host leaves the field;
    // the core reports them separately. Skip it if it's already there.
    const owner = playerOf(where.controller)
    const inGy = this.state.players.p1.zones.gy.concat(this.state.players.p2.zones.gy).find((i) => this.state.cards[i].cardId === code)
    if (inGy) return undefined
    throw new Error(`no material ${code} under ${host.iid} (${owner})`)
  }

  // An Xyz host for overlay locations. Materials can be attached while the
  // host is still in the Extra Deck, so ask the core which card that is.
  private host(where: Where): Iid {
    const location = where.location & ~LOC.overlay
    if (isField(location)) return this.at({ ...where, location })
    const card = this.duel.card(playerOf(where.controller), location, where.sequence, QUERY.code)
    return this.inPile(playerOf(where.controller), zoneFor({ ...where, location }).zone as 'extraDeck', card?.code ?? 0, true)
  }

  private at(where: Where, code?: number): Iid {
    const ref = zoneFor(where)
    if (ref.slot !== undefined) {
      const iid = ref.zone === 'extraMonster' ? this.state.extraMonster[ref.slot] : (this.state.players[ref.player!].zones[ref.zone as 'monster'][ref.slot] ?? null)
      if (!iid) throw new Error(`nothing in ${ref.player ?? ''} ${ref.zone} ${ref.slot}`)
      return iid
    }
    if (code === undefined) throw new Error(`need a code to find a card in ${ref.zone}`)
    return this.inPile(ref.player!, ref.zone as 'hand', code)
  }

  private inPile(player: Player, zone: 'deck' | 'hand' | 'gy' | 'banished' | 'extraDeck', code: number, preferHost = false): Iid {
    const pile = this.state.players[player].zones[zone]
    const matches = pile.filter((i) => this.state.cards[i].cardId === code)
    const iid = (preferHost && matches.find((i) => this.state.cards[i].materials.length)) || matches[0]
    if (!iid) throw new Error(`no ${this.ocg.card(code)?.name ?? code} in ${player}'s ${zone}`)
    return iid
  }

  private specialMethod(code: number): SummonMethod {
    const type = this.ocg.card(code)?.type ?? 0
    if (type & TYPE.link) return 'link'
    if (type & TYPE.xyz) return 'xyz'
    if (type & TYPE.synchro) return 'synchro'
    if (type & TYPE.fusion) return 'fusion'
    if (type & TYPE.ritual) return 'ritual'
    return 'special'
  }

  // A summon is announced after its move: mark the move in this step.
  private markSummon(iid: Iid, method: SummonMethod) {
    const move = this.current?.actions.findLast((a) => a.type === 'move' && a.card === iid)
    if (move?.type === 'move') move.summon = method
  }

  // ATK/DEF changed by effects show as modifiers the core keeps up to date.
  private syncStats(actor?: Player) {
    for (const player of ['p1', 'p2'] as const) {
      const cards = this.duel.fieldCards(player, LOC.mzone, QUERY.code | QUERY.position | QUERY.attack | QUERY.defense | QUERY.baseAttack | QUERY.baseDefense)
      cards.forEach((c, i) => {
        if (!c || c.empty || c.code === undefined) return
        const where = { controller: player === 'p1' ? 0 : 1, location: LOC.mzone, sequence: c.sequence ?? i }
        let iid: Iid
        try {
          iid = this.at(where)
        } catch {
          return
        }
        for (const [kind, now, base] of [
          ['atk', c.attack, c.baseAttack],
          ['def', c.defense, c.baseDefense],
        ] as const) {
          if (now === undefined || base === undefined) continue
          const id = `core-${kind}-${iid}`
          const had = this.state.modifiers.find((mod) => mod.id === id)
          if (had?.value === now || (!had && now === base)) continue
          if (!this.current) this.begin({}, actor && (actor === 'p1' ? 'user' : 'claude'))
          if (had) this.act({ type: 'unmodify', id })
          if (now !== base) this.act({ type: 'modify', modifier: { id, target: iid, kind, op: 'set', value: now, until: 'leavesField' } })
        }
      })
    }
  }

  private begin(head: Pick<Step, 'label' | 'intent'>, author?: Step['author']) {
    this.flush()
    this.current = { ...head, actions: [], ...(author && { author }) }
  }

  private setLabel(label: string, intent: Intent, author?: Step['author']) {
    if (!this.current) this.begin({}, author)
    if (!this.current!.intent) Object.assign(this.current!, { label, intent })
  }

  private labelIfNone(label: string, author?: Step['author']) {
    if (!this.current) this.begin({}, author)
    this.current!.label ??= label
  }

  private act(action: Action) {
    this.current ??= { actions: [] }
    this.state = applyAction(this.state, action).state
    this.current.actions.push(action)
  }

  private flush() {
    const s = this.current
    this.current = undefined
    if (!s?.actions.length) return
    if (!s.label) delete s.label
    this.steps.push(s)
  }
}

const PHASE_LABEL: Record<Phase, string> = {
  draw: 'Draw Phase',
  standby: 'Standby Phase',
  main1: 'Main Phase 1',
  battle: 'Battle Phase',
  main2: 'Main Phase 2',
  end: 'End Phase',
}

const SUMMON_LABEL: Record<SummonMethod, string> = {
  normal: 'Normal Summon',
  tribute: 'Tribute Summon',
  flip: 'Flip Summon',
  special: 'Special Summon',
  fusion: 'Fusion Summon',
  synchro: 'Synchro Summon',
  xyz: 'Xyz Summon',
  link: 'Link Summon',
  ritual: 'Ritual Summon',
}

function moveLabel(name: string, from: number, to: number, faceUp?: boolean) {
  if (isField(to) && faceUp === false) return `Set ${to === LOC.mzone ? 'a monster' : 'a card'}`
  if (to === LOC.grave) return `${name} goes to the GY`
  if (to === LOC.removed) return `${name} is banished`
  if (to === LOC.hand) return from === LOC.deck ? `Add ${name} to the hand` : `Return ${name} to the hand`
  if (to === LOC.deck) return `Return ${name} to the Deck`
  if (to === LOC.extra) return `Return ${name} to the Extra Deck`
  return `Move ${name}`
}

// Differences between our board and the core's, for tests and diagnostics.
export function diffWithCore(state: BoardState, duel: OcgDuel): string[] {
  const out: string[] = []
  const code = (i: Iid | null) => (i ? (state.cards[i].cardId ?? -1) : 0)
  for (const player of ['p1', 'p2'] as const) {
    const zones = state.players[player].zones
    const piles: [number, 'deck' | 'hand' | 'gy' | 'banished' | 'extraDeck'][] = [
      [LOC.deck, 'deck'],
      [LOC.hand, 'hand'],
      [LOC.grave, 'gy'],
      [LOC.removed, 'banished'],
      [LOC.extra, 'extraDeck'],
    ]
    for (const [location, zone] of piles) {
      const theirs = duel
        .fieldCards(player, location, QUERY.code)
        .filter((c) => c && !c.empty)
        .map((c) => c.code ?? 0)
        .sort()
      const ours = zones[zone].map(code).sort()
      if (theirs.join() !== ours.join()) out.push(`${player} ${zone}: core [${theirs}] vs ours [${ours}]`)
    }
    for (const location of [LOC.mzone, LOC.szone]) {
      const theirs = duel.fieldCards(player, location, QUERY.code | QUERY.position | QUERY.overlay)
      theirs.forEach((c, i) => {
        const sequence = c?.sequence ?? i
        if (location === LOC.szone && sequence > 5) return // pendulum zones share S/T slots under MR2020
        let ref: ZoneRef
        try {
          ref = zoneFor({ controller: player === 'p1' ? 0 : 1, location, sequence })
        } catch {
          return
        }
        let iid = ref.zone === 'extraMonster' ? state.extraMonster[ref.slot!] : state.players[player].zones[ref.zone as 'monster'][ref.slot!]
        if (ref.zone === 'extraMonster' && iid && state.cards[iid].owner !== player) iid = null // the other player's
        const want = c && !c.empty ? (c.code ?? 0) : 0
        const got = iid ? (state.cards[iid].cardId ?? state.cards[iid].custom?.name) : 0
        if (want !== got && !(want && iid && state.cards[iid].custom)) out.push(`${player} ${ref.zone} ${ref.slot}: core ${want} vs ours ${got}`)
        if (want && iid && location === LOC.mzone) {
          const materials = (c?.overlayCards ?? []).toSorted().join()
          const ours = state.cards[iid].materials.map(code).toSorted().join()
          if (materials !== ours) out.push(`${player} ${ref.zone} ${ref.slot}: materials core [${materials}] vs ours [${ours}]`)
        }
        if (want && iid && c?.position !== undefined) {
          const f = face(c.position)
          const card = state.cards[iid]
          if (card.faceUp !== f.faceUp || (location === LOC.mzone && card.position !== f.position)) out.push(`${player} ${ref.zone} ${ref.slot}: position differs`)
        }
      })
    }
    const lp = duel.lp(player)
    if (lp !== state.players[player].lp) out.push(`${player} LP: core ${lp} vs ours ${state.players[player].lp}`)
  }
  return out
}
