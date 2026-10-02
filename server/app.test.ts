// @vitest-environment node
import { createCardDb } from '../src/data/cardDb'
import { createApp } from './app'
import { repoContext } from './files'
import { SessionService } from './sessions'

const ctx = repoContext()
const setup = () => {
  const written: unknown[] = []
  const app = createApp({ sessions: new SessionService(ctx), ctx, writeFile: (dir, file) => (written.push(file), `${dir}/${file.id}.json`) })
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }
  return { call, written }
}

describe('API', () => {
  it('lists and shows scenarios', async () => {
    const { call } = setup()
    const list = await call('GET', '/scenarios')
    expect(list.json).toContainEqual({ id: 'free-table', title: expect.any(String), steps: 1 })
    expect((await call('GET', '/scenarios/free-table')).json.steps).toHaveLength(1)
    expect((await call('GET', '/scenarios/nope')).status).toBe(404)
  })

  it('looks cards up by name and passcode', async () => {
    const { call } = setup()
    const byName = await call('GET', '/cards?name=ojamatch')
    expect(byName.json).toMatchObject({ name: 'Ojamatch', image: expect.stringContaining('/cards/') })
    expect((await call('GET', `/cards/${byName.json.id}`)).json.name).toBe('Ojamatch')
    const miss = await call('GET', '/cards?name=Ojamatchh')
    expect(miss).toMatchObject({ status: 404, json: { suggestions: expect.arrayContaining(['Ojamatch']) } })
  })

  it('runs a session: create, apply, reject, undo, fork, export', async () => {
    const { call, written } = setup()
    const created = await call('POST', '/sessions', { scenario: 'free-table' })
    expect(created.status).toBe(201)
    const id = created.json.id
    const applied = await call('POST', `/sessions/${id}/steps`, { label: 'Draw', actions: [{ type: 'draw', player: 'p1' }] })
    expect(applied).toMatchObject({ status: 200, json: { position: 2, issues: [] } })

    const rejected = await call('POST', `/sessions/${id}/steps`, { actions: [{ type: 'move', card: 'p1-nope-1', to: { player: 'p1', zone: 'gy' } }] })
    expect(rejected).toMatchObject({ status: 422, json: { issues: [{ severity: 'error' }] } })
    const invalid = await call('POST', `/sessions/${id}/steps`, { actions: [{ type: 'teleport' }] })
    expect(invalid).toMatchObject({ status: 400, json: { error: 'invalid request' } })

    expect((await call('POST', `/sessions/${id}/fork`, { atStep: 1 })).json.steps).toBe(1)
    expect((await call('GET', '/sessions')).json).toHaveLength(2)
    const exported = await call('POST', `/sessions/${id}/export`, { id: 'my-line', title: 'My line', write: true })
    expect(exported.json).toMatchObject({ path: 'scenarios/my-line.json', file: { id: 'my-line', steps: [{ label: 'Draw' }] } })
    expect(written).toHaveLength(1)

    expect((await call('POST', `/sessions/${id}/undo`)).json.steps).toBe(1)
    expect((await call('POST', `/sessions/${id}/undo`)).status).toBe(409)
    expect((await call('GET', '/sessions/s-missing')).status).toBe(404)
  })

  it('serves an OpenAPI spec', async () => {
    const { call } = setup()
    const spec = await call('GET', '/openapi.json')
    expect(spec.json.openapi).toBe('3.1.0')
    expect(Object.keys(spec.json.paths)).toEqual(expect.arrayContaining(['/api/sessions/{id}/steps', '/api/cards']))
  })

  describe('decks', () => {
    // A fake YGOPRODeck that "fetches" one extra card into an in-memory DB.
    const withFetch = () => {
      const newCard = { id: 1, name: 'Brand New Card', type: 'Spell Card', frameType: 'spell', desc: 'Does a thing.', race: 'Normal' }
      let fetched = false
      const withNew = () => {
        const base = ctx()
        if (!fetched) return base
        return { ...base, db: createCardDb({ dbVersion: '', cards: [...base.db.all(), newCard] }) }
      }
      const addCards = vi.fn(async (names: string[]) => {
        fetched = true
        return {
          added: names.includes('Brand New Card') ? [newCard] : [],
          unknown: names.filter((n) => n !== 'Brand New Card').map((name) => ({ name, suggestions: ['Brand New Card'] })),
        }
      })
      const written: unknown[] = []
      const app = createApp({ sessions: new SessionService(withNew), ctx: withNew, addCards, writeFile: (dir, file) => (written.push(file), `${dir}/${file.id}.json`) })
      const call = async (method: string, path: string, body?: unknown) => {
        const res = await app.request(`/api${path}`, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
        return { status: res.status, json: (await res.json()) as any }
      }
      return { call, addCards, written }
    }

    it('lists decks and shows one with card text', async () => {
      const { call } = setup()
      expect((await call('GET', '/decks')).json).toContainEqual({
        id: 'chazz-armed-ojama',
        name: expect.any(String),
        size: { main: 40, extra: expect.any(Number) },
        usedBy: expect.arrayContaining(['free-table']),
      })
      const deck = await call('GET', '/decks/chazz-armed-ojama')
      expect(deck.json.main).toContainEqual(expect.objectContaining({ name: 'Ojamatch', count: 3, desc: expect.any(String) }))
      expect(deck.json.usedBy).toContain('free-table')
      expect((await call('GET', '/decks/nope')).status).toBe(404)
    })

    it('deletes a deck, unless a scenario uses it', async () => {
      const removed: string[] = []
      const withSpare = () => ({ ...ctx(), decks: { ...ctx().decks, spare: { id: 'spare', name: 'Spare', main: [], extra: [] } } })
      const app = createApp({ sessions: new SessionService(withSpare), ctx: withSpare, removeFile: (dir, id) => (removed.push(id), `${dir}/${id}.json`) })
      const del = async (id: string) => {
        const res = await app.request(`/api/decks/${id}`, { method: 'DELETE' })
        return { status: res.status, json: (await res.json()) as any }
      }
      expect(await del('chazz-armed-ojama')).toMatchObject({ status: 409, json: { details: expect.arrayContaining(['free-table']) } })
      expect((await del('nope')).status).toBe(404)
      expect(await del('spare')).toEqual({ status: 200, json: { path: 'decks/spare.json' } })
      expect(removed).toEqual(['spare'])
    })

    it('creates a deck from a pasted list, fetching unknown cards', async () => {
      const { call, addCards, written } = withFetch()
      const r = await call('POST', '/decks', { id: 'new-deck', name: 'New', list: '3 Ojamatch\n1 Brand New Card\nXYZ-Dragon Cannon' })
      expect(r.status).toBe(201)
      expect(addCards).toHaveBeenCalledWith(['Brand New Card'])
      expect(r.json).toMatchObject({ path: 'decks/new-deck.json', fetched: ['Brand New Card'], size: { main: 4, extra: 1 } })
      expect(written).toEqual([
        {
          id: 'new-deck',
          name: 'New',
          main: [
            { name: 'Ojamatch', count: 3 },
            { name: 'Brand New Card', count: 1 },
          ],
          extra: [{ name: 'XYZ-Dragon Cannon', count: 1 }],
        },
      ])
    })

    it('rejects unknown names with suggestions, and existing ids', async () => {
      const { call, written } = withFetch()
      const r = await call('POST', '/decks', { id: 'typo', name: 'Typo', cards: [{ name: 'Brand Neu Card', count: 1 }] })
      expect(r).toMatchObject({ status: 422, json: { unknown: [{ name: 'Brand Neu Card', suggestions: ['Brand New Card'] }] } })
      expect((await call('POST', '/decks', { id: 'chazz-armed-ojama', name: 'X', list: 'Ojamatch' })).status).toBe(409)
      expect((await call('POST', '/decks', { id: 'both', name: 'X', list: 'Ojamatch', cards: [] })).status).toBe(400)
      expect(written).toEqual([])
    })
  })

  it('runs a lesson: queued steps, Next, a prompt and wait', async () => {
    const { call } = setup()
    const { json: session } = await call('POST', '/sessions', { scenario: 'free-table' })
    const at = `/sessions/${session.id}`
    const draw = { label: 'Draw', actions: [{ type: 'draw', player: 'p1' }] }
    expect((await call('POST', `${at}/steps`, { ...draw, reveal: 'onNext' })).json).toMatchObject({ position: 2, revealed: 1 })
    expect((await call('POST', `${at}/steps`, { ...draw, reveal: 'later' })).status).toBe(400)
    const { json: start } = await call('GET', `${at}/wait?timeout=0`)
    const waiting = call('GET', `${at}/wait?since=${start.cursor}&timeout=30`)
    expect((await call('POST', `${at}/next`)).json.lesson).toMatchObject({ revealed: 2, queued: 0 })
    const { json: woke } = await waiting
    expect(woke.events).toEqual([expect.objectContaining({ type: 'revealed', via: 'next' })])
    expect((await call('POST', `${at}/next`)).status).toBe(409)

    expect((await call('POST', `${at}/cursor`, { position: 1 })).json.lesson.cursor).toMatchObject({ position: 1 })
    const { json: prompt } = await call('POST', `${at}/prompt`, { type: 'text', message: 'Why chain Ash here?' })
    expect(prompt).toMatchObject({ id: expect.any(String), type: 'text', openedAt: 2 })
    expect((await call('POST', `${at}/prompt`, { type: 'ack', message: 'x' })).status).toBe(409)
    expect((await call('POST', `${at}/prompt/answer`, { id: prompt.id, text: 'To stop the search' })).status).toBe(200)
    const { json: answered } = await call('GET', `${at}/wait?since=${woke.cursor}&timeout=0`)
    expect(answered.events).toEqual([expect.objectContaining({ type: 'answer', text: 'To stop the search' })])

    expect((await call('POST', `${at}/steps`, { ...draw, author: 'user' })).status).toBe(200)
    expect((await call('POST', `${at}/undo`, { author: 'user' })).status).toBe(200)
    expect((await call('POST', `${at}/undo`)).status).toBe(200)
    const { json: after } = await call('GET', `${at}/wait?since=${answered.cursor}&timeout=0`)
    expect(after.events.map((e: { type: string }) => e.type)).toEqual(['step', 'revealed', 'undo'])
    expect((await call('GET', `${at}/wait?timeout=9999`)).status).toBe(400)
  })

  it('keeps ideas jotted down from the header, and deletes one', async () => {
    const { call } = setup()
    expect((await call('GET', '/ideas')).json).toEqual([])
    await call('POST', '/ideas', { text: 'Bigger card text', where: 'Home' })
    const { json: two } = await call('POST', '/ideas', { text: 'A hint button' })
    expect(two).toMatchObject([{ text: 'Bigger card text', where: 'Home' }, { text: 'A hint button' }])
    expect((await call('POST', '/ideas', { text: '' })).status).toBe(400)
    expect((await call('DELETE', `/ideas/${two[0].id}`)).json).toMatchObject([{ text: 'A hint button' }])
  })
})
