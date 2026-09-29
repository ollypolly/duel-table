// @vitest-environment node
import { createApp } from './app'
import { repoContext } from './files'
import { SessionService } from './sessions'

const ctx = repoContext()
const setup = () => {
  const written: unknown[] = []
  const app = createApp({ sessions: new SessionService(ctx), ctx, writeScenario: (file) => (written.push(file), `scenarios/${file.id}.json`) })
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
    expect(miss).toMatchObject({ status: 404, json: { suggestions: ['Ojamatch'] } })
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
})
