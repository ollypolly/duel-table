// Core engine types. Everything here is plain JSON so states and actions can be
// persisted, sent over HTTP and replayed deterministically.

export type Player = 'p1' | 'p2'
export type Iid = string // unique per game, e.g. "p1-ojamatch-2"
export type Position = 'atk' | 'def'
export type Phase = 'draw' | 'standby' | 'main1' | 'battle' | 'main2' | 'end'

export type PileZone = 'deck' | 'hand' | 'extraDeck' | 'gy' | 'banished'
export type SlotZone = 'monster' | 'spellTrap' | 'fieldSpell'
export type PlayerZone = PileZone | SlotZone
export type ZoneName = PlayerZone | 'extraMonster'

// `player` is ignored for the shared Extra Monster Zones. `slot` is required to
// address a specific slot; omitting it on a move picks the first empty one.
export type ZoneRef = { player?: Player; zone: ZoneName; slot?: number }

export type CustomCard = {
  name: string
  text: string
  kind?: 'monster' | 'spell' | 'trap' | 'extra'
  atk?: number
  def?: number
}

export type CardInstance = {
  iid: Iid
  cardId?: number // passcode; absent for custom cards
  custom?: CustomCard
  owner: Player
  faceUp: boolean
  position: Position
  materials: Iid[] // Xyz materials sit under the monster, not in a zone
}

export type PlayerState = {
  name: string
  lp: number
  zones: Record<PileZone, Iid[]> & Record<SlotZone, (Iid | null)[]>
}

export type ChainLink = { card: Iid; player: Player; label?: string }

// Known kinds get UI treatment; anything else is displayed via `label`.
export type ModifierKind = 'atk' | 'def' | 'name' | 'negated' | 'unaffected' | 'cannotAttack' | (string & {})
export type ModifierDuration = 'endOfTurn' | 'endOfNextTurn' | 'permanent' | 'leavesField'

export type Modifier = {
  id: string
  target: Iid
  kind: ModifierKind
  value?: number | string | boolean
  op?: 'add' | 'set' | 'multiply' // for atk/def; default add
  label?: string
  source?: Iid
  until: ModifierDuration
  turn?: number // stamped by the engine when applied
}

export type SummonMethod =
  | 'normal'
  | 'tribute'
  | 'flip'
  | 'special'
  | 'fusion'
  | 'synchro'
  | 'xyz'
  | 'link'
  | 'ritual'

export type HistoryEntry = {
  turn: number
  kind: 'summoned'
  player: Player
  card: Iid
  cardId?: number
  method: SummonMethod
}

export type TurnFlags = {
  normalSummonUsed: Record<Player, boolean>
  oncePerTurn: Record<string, true>
}

export type BoardState = {
  players: Record<Player, PlayerState>
  extraMonster: (Iid | null)[]
  cards: Record<Iid, CardInstance>
  turn: number
  activePlayer: Player
  phase: Phase
  chain: ChainLink[]
  modifiers: Modifier[]
  history: HistoryEntry[]
  turnFlags: TurnFlags
  rng: { seed: number; cursor: number }
  // Per-step presentation, cleared at the start of every step.
  revealed: Iid[]
  highlights: Iid[]
  arrows: { from: Iid; to: Iid }[]
}

export type Cause = {
  card?: Iid
  reason: 'cost' | 'effect' | 'battle' | 'rule' | 'manual'
}

type WithCause<T> = T & { cause?: Cause }

export type Action = WithCause<
  | {
      type: 'move'
      card: Iid
      to: ZoneRef
      faceUp?: boolean
      position?: Position
      index?: number // pile insert position, 0 = top
      summon?: SummonMethod
    }
  | { type: 'draw'; player: Player; count?: number }
  | { type: 'shuffle'; player: Player; zone: PileZone }
  | { type: 'lp'; player: Player; delta?: number; set?: number } // exactly one of delta/set
  | { type: 'phase'; phase: Phase }
  | { type: 'nextTurn' }
  | { type: 'attach'; card: Iid; to: Iid }
  | { type: 'detach'; card: Iid; to?: ZoneRef }
  | { type: 'flip'; card: Iid }
  | { type: 'position'; card: Iid; position: Position }
  | { type: 'reveal'; cards: Iid[] }
  | { type: 'highlight'; cards: Iid[] }
  | { type: 'arrow'; from: Iid; to: Iid }
  | { type: 'modify'; modifier: Omit<Modifier, 'turn'> }
  | { type: 'unmodify'; id: string }
  | { type: 'chainPush'; card: Iid; label?: string; player?: Player }
  | { type: 'chainResolve' }
>

export type ActionType = Action['type']

// A card's location: which zone it's in, and where. Materials report their host.
export type Location =
  | { zone: ZoneRef; index: number }
  | { materialOf: Iid; index: number }

export type EngineEvent =
  | { type: 'moved'; card: Iid; from: Location; to: Location; cause?: Cause }
  | { type: 'summoned'; card: Iid; method: SummonMethod; player: Player }
  | { type: 'drew'; player: Player; cards: Iid[] }
  | { type: 'shuffled'; player: Player; zone: PileZone }
  | { type: 'lpChanged'; player: Player; from: number; to: number; cause?: Cause }
  | { type: 'phaseChanged'; from: Phase; to: Phase }
  | { type: 'turnStarted'; turn: number; player: Player }
  | { type: 'flipped'; card: Iid; faceUp: boolean }
  | { type: 'positionChanged'; card: Iid; position: Position }
  | { type: 'revealed'; cards: Iid[] }
  | { type: 'modifierAdded'; modifier: Modifier }
  | { type: 'modifierRemoved'; modifier: Modifier; reason: 'unmodify' | 'expired' | 'leftField' }
  | { type: 'chainLinkAdded'; link: ChainLink; number: number }
  | { type: 'chainLinkResolved'; link: ChainLink; number: number }

export type ActionResult = { state: BoardState; events: EngineEvent[] }

// Game-level moves ("Normal Summon this"). Descriptive only in Level 1; a rules
// layer would turn these into primitive actions.
export type Intent =
  | { type: 'activate'; card: Iid; effect?: string }
  | { type: 'normalSummon'; card: Iid }
  | { type: 'tributeSummon'; card: Iid; tributes?: Iid[] }
  | { type: 'specialSummon'; card: Iid; method?: SummonMethod }
  | { type: 'set'; card: Iid }
  | { type: 'attack'; attacker: Iid; target?: Iid }
  | { type: 'declarePhase'; phase: Phase }
  | { type: 'endTurn' }

export type Step = {
  label?: string
  narration?: string
  intent?: Intent
  actions: Action[]
  author?: 'user' | 'claude' // who made it in a live session
}

export type Issue = {
  severity: 'error' | 'warning'
  message: string
  action?: number // index within the step's actions
}
