// Zod schemas for scenario and deck files, and for engine actions/steps (the
// API validates requests with these too). Pure: shared by browser and server.
import { z } from 'zod'
import type { Action, Intent, Modifier, Step, ZoneRef } from '../engine/types'

export const PlayerSchema = z.enum(['p1', 'p2'])
export const PositionSchema = z.enum(['atk', 'def'])
export const PhaseSchema = z.enum(['draw', 'standby', 'main1', 'battle', 'main2', 'end'])
export const PileZoneSchema = z.enum(['deck', 'hand', 'extraDeck', 'gy', 'banished'])
export const PlayerZoneSchema = z.enum(['deck', 'hand', 'extraDeck', 'gy', 'banished', 'monster', 'spellTrap', 'fieldSpell'])
export const ZoneNameSchema = z.enum([...PlayerZoneSchema.options, 'extraMonster'])
export const SummonMethodSchema = z.enum(['normal', 'tribute', 'flip', 'special', 'fusion', 'synchro', 'xyz', 'link', 'ritual'])

const iid = z.string().min(1)

export const ZoneRefSchema = z
  .object({ player: PlayerSchema.optional(), zone: ZoneNameSchema, slot: z.int().min(0).optional() })
  .strict()
  .refine((r) => r.zone === 'extraMonster' || r.player, { message: 'player is required for this zone' })

export const CauseSchema = z.object({ card: iid.optional(), reason: z.enum(['cost', 'effect', 'battle', 'rule', 'manual']) }).strict()

export const ModifierSchema = z
  .object({
    id: z.string().min(1),
    target: iid,
    kind: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean()]).optional(),
    op: z.enum(['add', 'set', 'multiply']).optional(),
    label: z.string().optional(),
    source: iid.optional(),
    until: z.enum(['endOfTurn', 'endOfNextTurn', 'permanent', 'leavesField']),
  })
  .strict()

export const CustomCardSchema = z
  .object({
    name: z.string().min(1),
    text: z.string(),
    kind: z.enum(['monster', 'spell', 'trap', 'extra']).optional(),
    atk: z.number().optional(),
    def: z.number().optional(),
  })
  .strict()

const action = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) => z.object({ type: z.literal(type), cause: CauseSchema.optional(), ...shape }).strict()

export const ActionSchema = z.discriminatedUnion('type', [
  action('move', {
    card: iid,
    to: ZoneRefSchema,
    faceUp: z.boolean().optional(),
    position: PositionSchema.optional(),
    index: z.int().min(0).optional(),
    summon: SummonMethodSchema.optional(),
  }),
  action('draw', { player: PlayerSchema, count: z.int().min(1).optional() }),
  action('shuffle', { player: PlayerSchema, zone: PileZoneSchema }),
  action('lp', { player: PlayerSchema, delta: z.number().optional(), set: z.number().optional() }),
  action('phase', { phase: PhaseSchema }),
  action('nextTurn', {}),
  action('attach', { card: iid, to: iid }),
  action('detach', { card: iid, to: ZoneRefSchema.optional() }),
  action('flip', { card: iid }),
  action('position', { card: iid, position: PositionSchema }),
  action('reveal', { cards: z.array(iid) }),
  action('highlight', { cards: z.array(iid) }),
  action('arrow', { from: iid, to: iid }),
  action('modify', { modifier: ModifierSchema }),
  action('unmodify', { id: z.string() }),
  action('chainPush', { card: iid, label: z.string().optional(), player: PlayerSchema.optional() }),
  action('chainResolve', {}),
  action('create', {
    card: iid,
    cardId: z.int().optional(),
    custom: CustomCardSchema.optional(),
    owner: PlayerSchema,
    to: ZoneRefSchema,
    faceUp: z.boolean().optional(),
    position: PositionSchema.optional(),
  }),
  action('remove', { card: iid }),
])

export const IntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('activate'), card: iid, effect: z.string().optional() }).strict(),
  z.object({ type: z.literal('normalSummon'), card: iid }).strict(),
  z.object({ type: z.literal('tributeSummon'), card: iid, tributes: z.array(iid).optional() }).strict(),
  z.object({ type: z.literal('specialSummon'), card: iid, method: SummonMethodSchema.optional() }).strict(),
  z.object({ type: z.literal('set'), card: iid }).strict(),
  z.object({ type: z.literal('attack'), attacker: iid, target: iid.optional() }).strict(),
  z.object({ type: z.literal('declarePhase'), phase: PhaseSchema }).strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
])

export const StepSchema = z
  .object({
    label: z.string().optional(),
    narration: z.string().optional(),
    intent: IntentSchema.optional(),
    actions: z.array(ActionSchema),
    author: z.enum(['user', 'claude']).optional(),
  })
  .strict()

// Keep the Zod schemas and the engine's hand-written types in lockstep.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const assert = <T extends true>() => undefined as unknown as T
assert<Same<z.infer<typeof ActionSchema>, Action>>()
assert<Same<z.infer<typeof StepSchema>, Step>>()
assert<Same<z.infer<typeof IntentSchema>, Intent>>()
assert<Same<z.infer<typeof ModifierSchema>, Omit<Modifier, 'turn'>>>()
assert<Same<z.infer<typeof ZoneRefSchema>, ZoneRef>>()

export const CardRefSchema = z.union([z.string().min(1), z.object({ custom: CustomCardSchema }).strict()])

export const PlacementSchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      faceUp: z.boolean().optional(),
      position: PositionSchema.optional(),
      materials: z.array(z.string()).optional(),
    })
    .strict(),
  z.null(),
])

// The anime character a deck belongs to: Claude plays as them with it.
export const CharacterSchema = z
  .object({
    name: z.string().min(1),
    from: z.string().min(1).describe('the series, e.g. Yu-Gi-Oh! GX'),
    personality: z.string().min(1).describe('how they talk and duel, for Claude to play them'),
  })
  .strict()

export const DeckSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    character: CharacterSchema.optional(),
    main: z.array(z.object({ name: z.string().min(1), count: z.int().min(1) }).strict()),
    extra: z.array(z.object({ name: z.string().min(1), count: z.int().min(1) }).strict()).default([]),
  })
  .strict()

export const ScenarioPlayerSchema = z
  .object({
    name: z.string().min(1),
    lp: z.number().optional(),
    deck: z.string().optional().describe('id of a file in decks/'),
    list: DeckSchema.optional().describe(
      "A copy of the deck as it was when this game started, used instead of decks/<deck>, so editing the deck doesn't change the game",
    ),
    cards: z.array(CardRefSchema).optional().describe('cards owned in addition to the deck'),
  })
  .strict()
  // cards: [] is a player with nothing, on a table Claude lays out by hand.
  .refine((p) => p.deck || p.list || p.cards, { message: 'give a deck, cards, or both' })

// Where cards start, zone by zone; whatever isn't placed is shuffled into the
// Deck. A Deck placement is its top cards, top first.
export const SetupSchema = z
  .object({
    p1: z.partialRecord(PlayerZoneSchema, z.array(PlacementSchema)).optional(),
    p2: z.partialRecord(PlayerZoneSchema, z.array(PlacementSchema)).optional(),
    extraMonster: z
      .array(
        z.union([
          z.null(),
          z.object({ player: PlayerSchema, name: z.string(), position: PositionSchema.optional(), materials: z.array(z.string()).optional() }).strict(),
        ]),
      )
      .max(2)
      .optional(),
  })
  .strict()
export type Setup = z.infer<typeof SetupSchema>

export const ScenarioSchema = z
  .object({
    $schema: z.string().optional(),
    id: z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase-with-dashes'),
    title: z.string().min(1),
    description: z.string().optional(),
    demo: z.boolean().optional().describe('An example Claude plays out in a chat: shown there, and left out of your lists'),
    seed: z.int().optional(),
    extends: z
      .object({ scenario: z.string(), atStep: z.int().min(-1) })
      .strict()
      .optional(),
    players: z.object({ p1: ScenarioPlayerSchema, p2: ScenarioPlayerSchema }).strict().optional(),
    setup: SetupSchema.optional(),
    start: z
      .object({ turn: z.int().min(1).optional(), activePlayer: PlayerSchema.optional(), phase: PhaseSchema.optional() })
      .strict()
      .optional(),
    steps: z.array(StepSchema).default([]),
    duel: z
      .object({
        responses: z.array(z.string()).describe('Answers given to the rules engine so far (base64); the steps are derived from them'),
        bots: z.array(PlayerSchema).optional().describe('Players a bot answers for'),
        bot: z.enum(['random', 'agent']).optional().describe('Which bot: the trained one (ygo-agent) or, by default, the random one'),
        claude: PlayerSchema.optional().describe('The player Claude answers for'),
        lesson: z.boolean().optional().describe('Claude runs the game as a lesson, answering for whichever players it holds'),
        table: z.boolean().optional().describe('Carried over from a free-play table, which it can go back to'),
        shuffled: z.boolean().optional().describe('The Decks were shuffled from the seed (games saved before that replay unshuffled)'),
        winner: PlayerSchema.optional().describe('Who won, once the duel is over'),
        undone: z.int().optional().describe('Moves taken back so far'),
        yours: z.array(z.int()).optional().describe("In a lesson: the answers that began a move the person made themselves, which they can take back"),
        forfeit: PlayerSchema.optional().describe('The player who gave up, if the duel ended that way'),
        startedAt: z.number().optional().describe('When the game began (ms since the epoch)'),
        endedAt: z.number().optional().describe('When it ended'),
        respond: z.enum(['all', 'auto', 'advise', 'claude']).optional().describe('When the person is asked to respond with a chain (default auto)'),
        skipped: z
          .array(z.object({ at: z.int(), cards: z.array(z.string()), to: z.string().optional(), by: z.enum(['rules', 'claude']), why: z.string().optional(), turn: z.int().optional() }))
          .optional()
          .describe('Chances to respond that were passed for the person'),
        asked: z.int().optional().describe('An answer index where the person asked to be given a passed chance after all'),
      })
      .strict()
      .optional()
      .describe('A game on the YGOPro rules engine'),
  })
  .strict()
  .refine((s) => s.extends || s.players, { message: 'a scenario needs players (or extends another scenario)', path: ['players'] })
  .refine((s) => !(s.extends && (s.players || s.setup || s.start || s.seed !== undefined)), {
    message: 'a fork inherits players, setup, start and seed from its parent; remove them',
    path: ['extends'],
  })

export type ScenarioFile = z.infer<typeof ScenarioSchema>
export type DeckFile = z.infer<typeof DeckSchema>
export type Character = z.infer<typeof CharacterSchema>
