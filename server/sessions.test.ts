// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diskStore, repoContext } from './files'
import { SessionError, SessionService } from './sessions'

const ctx = repoContext()
const service = () => new SessionService(ctx)
const drawStep = { label: 'You draw', actions: [{ type: 'draw' as const, player: 'p1' as const }] }

describe('SessionService', () => {
  it('creates a session from a scenario at a position', () => {
    const s = service().create({ scenario: 'free-table', atStep: 0 })
    expect(s.file.extends).toEqual({ scenario: 'free-table', atStep: -1 })
    expect(s.steps).toBe(0)
    expect(s.state.players.p1.zones.hand).toEqual([])
    const end = service().create({ scenario: 'free-table' })
    expect(end.steps).toBe(1)
    expect(end.state.players.p1.zones.hand).toHaveLength(5)
  })

  it('creates a session from decks', () => {
    const s = service().create({ deck: 'chazz-armed-ojama', seed: 3 })
    expect(s.file.players?.p2.deck).toBe('chazz-armed-ojama')
    expect(s.state.players.p2.zones.deck).toHaveLength(40)
  })

  it('rejects bad create options', () => {
    const svc = service()
    expect(() => svc.create({})).toThrow(SessionError)
    expect(() => svc.create({ scenario: 'nope' })).toThrow(/no scenario "nope"/)
    expect(() => svc.create({ scenario: 'free-table', atStep: 9 })).toThrow(/atStep must be 0-1/)
  })

  it('applies steps, reports issues and undoes', () => {
    const svc = service()
    const { id } = svc.create({ scenario: 'free-table' })
    const r = svc.apply(id, drawStep)
    expect(r.ok && r.position).toBe(2)
    expect(r.ok && r.events).toContainEqual(expect.objectContaining({ type: 'drew', player: 'p1' }))
    expect(svc.get(id).state.players.p1.zones.hand).toHaveLength(6)

    const bad = svc.apply(id, { actions: [{ type: 'move', card: 'p1-nope-1', to: { player: 'p1', zone: 'gy' } }] })
    expect(bad).toEqual({ ok: false, issues: [expect.objectContaining({ severity: 'error' })] })

    const hand = svc.get(id).state.players.p1.zones.hand[0]
    const warn = { actions: [{ type: 'move' as const, card: hand, to: { player: 'p2' as const, zone: 'gy' as const } }] }
    expect(svc.apply(id, warn, { strict: true }).ok).toBe(false)
    const lenient = svc.apply(id, warn)
    expect(lenient.ok && lenient.issues).toEqual([expect.objectContaining({ severity: 'warning' })])

    svc.undo(id)
    svc.undo(id)
    expect(svc.get(id).steps).toBe(1)
    expect(() => svc.undo(id)).toThrow(/nothing to undo/)
  })

  it('forks at a position, inside or after the inherited steps', () => {
    const svc = service()
    const { id } = svc.create({ scenario: 'free-table' })
    svc.apply(id, drawStep)
    svc.apply(id, drawStep)
    expect(svc.fork(id, 2).file).toMatchObject({ extends: { scenario: 'free-table', atStep: 0 }, steps: [{ ...drawStep, author: 'claude' }] })
    expect(svc.fork(id, 0).file).toMatchObject({ extends: { scenario: 'free-table', atStep: -1 }, steps: [] })
    expect(svc.fork(id).steps).toBe(3)
    expect(svc.list()).toHaveLength(4)
  })

  it('notifies subscribers after every change', () => {
    const svc = service()
    const { id } = svc.create({ scenario: 'free-table' })
    const seen: number[] = []
    const off = svc.subscribe(id, (v) => seen.push(v.steps))
    svc.apply(id, drawStep)
    svc.undo(id)
    off()
    svc.apply(id, drawStep)
    expect(seen).toEqual([2, 1])
  })

  it('exports as a scenario file that resolves on its own', () => {
    const svc = service()
    const { id } = svc.create({ scenario: 'free-table' })
    svc.apply(id, drawStep)
    const file = svc.export(id, { id: 'my-line', title: 'My line' })
    expect(file).toEqual({ id: 'my-line', title: 'My line', extends: { scenario: 'free-table', atStep: 0 }, steps: [{ ...drawStep, author: 'claude' }] })
  })

  it('persists to disk and reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duel-sessions-'))
    const svc = new SessionService(ctx, diskStore(dir))
    const { id } = svc.create({ scenario: 'free-table' })
    svc.apply(id, drawStep)
    expect(readdirSync(dir)).toEqual([`${id}.json`])
    expect(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).steps).toEqual([{ ...drawStep, author: 'claude' }])
    const reloaded = new SessionService(ctx, diskStore(dir))
    expect(reloaded.get(id).steps).toBe(2)
  })

  it('lists who is playing, renames and deletes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duel-sessions-'))
    const svc = new SessionService(ctx, diskStore(dir))
    const removed: string[] = []
    svc.onRemove.push((id) => removed.push(id))
    const { id } = svc.create({ deck: 'chazz-armed-ojama', opponentDeck: 'super-quant', opponentName: 'Claude', seed: 1 })
    expect(svc.list()).toEqual([
      expect.objectContaining({
        id,
        kind: 'board',
        turn: expect.any(Number),
        updatedAt: expect.any(String),
        players: { p1: expect.objectContaining({ name: 'You', deck: 'chazz-armed-ojama' }), p2: expect.objectContaining({ name: 'Claude', deck: 'super-quant' }) },
      }),
    ])
    expect(svc.rename(id, 'Quant OTK').title).toBe('Quant OTK')
    expect(new SessionService(ctx, diskStore(dir)).get(id).title).toBe('Quant OTK')
    svc.remove(id)
    expect(removed).toEqual([id])
    expect(readdirSync(dir)).toEqual([])
    expect(() => svc.get(id)).toThrow(SessionError)
  })
})

describe('lessons', () => {
  const setup = () => {
    const svc = service()
    const { id } = svc.create({ scenario: 'free-table' })
    return { svc, id, lesson: () => svc.get(id).lesson }
  }
  afterEach(() => vi.useRealTimers())

  it('shows steps at once by default', () => {
    const { svc, id, lesson } = setup()
    const r = svc.apply(id, drawStep)
    expect(r.ok && r.revealed).toBe(2)
    expect(lesson()).toMatchObject({ revealed: 2, queued: 0, cursor: { position: 2 } })
  })

  it('queues onNext steps until Next, and later steps behind them', () => {
    const { svc, id, lesson } = setup()
    svc.apply(id, drawStep, { reveal: 'onNext' })
    svc.apply(id, drawStep)
    expect(svc.get(id).steps).toBe(3)
    expect(lesson()).toMatchObject({ revealed: 1, queued: 2, waiting: 'next', cursor: { position: 1 } })
    svc.next(id)
    expect(lesson()).toMatchObject({ revealed: 2, queued: 1, waiting: 'timer' })
    expect(() => svc.apply(id, { ...drawStep, author: 'user' })).toThrow(/queued/)
  })

  it('reveals afterMs steps on a timer, one after another', async () => {
    vi.useFakeTimers()
    const { svc, id, lesson } = setup()
    const seen: number[] = []
    svc.subscribe(id, (v) => seen.push(v.lesson.revealed))
    svc.apply(id, drawStep, { reveal: { afterMs: 1000 } })
    svc.apply(id, drawStep, { reveal: { afterMs: 1000 } })
    await vi.advanceTimersByTimeAsync(999)
    expect(lesson().revealed).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(lesson().revealed).toBe(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(lesson()).toMatchObject({ revealed: 3, queued: 0 })
    expect(seen.at(-1)).toBe(3)
  })

  it('undo drops a queued step before a shown one', () => {
    const { svc, id, lesson } = setup()
    svc.apply(id, drawStep)
    svc.apply(id, drawStep, { reveal: 'onNext' })
    svc.undo(id)
    expect(lesson()).toMatchObject({ revealed: 2, queued: 0 })
    svc.undo(id)
    expect(lesson()).toMatchObject({ revealed: 1, cursor: { position: 1 } })
  })

  it('moves the presenter cursor, only to shown positions', () => {
    const { svc, id, lesson } = setup()
    svc.apply(id, drawStep)
    const before = lesson().cursor.seq
    svc.present(id, { position: 1 })
    expect(lesson().cursor).toEqual({ position: 1, seq: before + 1 })
    svc.present(id, { from: 0, position: 2 })
    expect(lesson().cursor).toMatchObject({ from: 0, position: 2 })
    svc.apply(id, drawStep, { reveal: 'onNext' })
    expect(() => svc.present(id, { position: 3 })).toThrow(/0-2/)
    expect(() => svc.present(id, { from: 2, position: 2 })).toThrow(/before/)
  })

  it('runs a prompt from ask to answer, one at a time', async () => {
    const { svc, id, lesson } = setup()
    const p = svc.ask(id, { type: 'choice', message: 'Chain Ash?', options: ['Yes', 'No'] })
    expect(lesson().prompt).toMatchObject({ id: p.id, type: 'choice' })
    expect(() => svc.ask(id, { type: 'ack', message: 'Hi' })).toThrow(/still open/)
    expect(() => svc.answer(id, { id: p.id, choice: 5 })).toThrow(/choice must be 0-1/)
    svc.answer(id, { id: p.id, choice: 1 })
    expect(lesson().prompt).toBeUndefined()
    const { events } = await svc.wait(id, 0, 0)
    expect(events).toContainEqual(expect.objectContaining({ type: 'answer', choice: { index: 1, option: 'No' } }))
    expect(() => svc.answer(id, { id: p.id })).toThrow(/isn't open/)
  })

  it("records a move prompt's steps as the viewer's", async () => {
    const { svc, id } = setup()
    const p = svc.ask(id, { type: 'move', message: 'Draw a card' })
    svc.apply(id, { ...drawStep, author: 'user' })
    svc.answer(id, { id: p.id })
    const { events, cursor } = await svc.wait(id, 0, 0)
    expect(events.map((e) => e.type)).toEqual(['step', 'revealed', 'answer'])
    expect(events[0]).toMatchObject({ type: 'step', position: 2, step: { author: 'user' } })
    expect(events[2]).toMatchObject({ steps: [2] })
    expect(cursor).toBe(events[2].seq)
    expect(svc.get(id).file.steps[0].author).toBe('user')
  })

  it("doesn't let the viewer answer a prompt that isn't showing yet", () => {
    const { svc, id } = setup()
    svc.apply(id, drawStep, { reveal: 'onNext' })
    const p = svc.ask(id, { type: 'ack', message: 'Seen it?' })
    expect(() => svc.answer(id, { id: p.id })).toThrow(/still queued/)
    svc.next(id)
    svc.answer(id, { id: p.id })
  })

  it('wait returns as soon as something happens', async () => {
    const { svc, id } = setup()
    const { cursor } = await svc.wait(id, undefined, 0)
    const waiting = svc.wait(id, cursor, 60_000)
    svc.apply(id, drawStep, { reveal: 'onNext' })
    svc.next(id)
    const r = await waiting
    expect(r.events).toEqual([expect.objectContaining({ type: 'revealed', via: 'next', position: 2 })])
    expect(r.cursor).toBeGreaterThan(cursor)
  })

  it('wait times out with no events and the same cursor', async () => {
    vi.useFakeTimers()
    const { svc, id } = setup()
    const waiting = svc.wait(id, undefined, 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await waiting).toEqual({ events: [], cursor: 0 })
  })
})

