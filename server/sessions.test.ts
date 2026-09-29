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
    expect(svc.fork(id, 2).file).toMatchObject({ extends: { scenario: 'free-table', atStep: 0 }, steps: [drawStep] })
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
    expect(file).toEqual({ id: 'my-line', title: 'My line', extends: { scenario: 'free-table', atStep: 0 }, steps: [drawStep] })
  })

  it('persists to disk and reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duel-sessions-'))
    const svc = new SessionService(ctx, diskStore(dir))
    const { id } = svc.create({ scenario: 'free-table' })
    svc.apply(id, drawStep)
    expect(readdirSync(dir)).toEqual([`${id}.json`])
    expect(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).steps).toEqual([drawStep])
    const reloaded = new SessionService(ctx, diskStore(dir))
    expect(reloaded.get(id).steps).toBe(2)
  })
})
