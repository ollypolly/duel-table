// Typed fetch client for the local API, plus the SSE subscription live mode
// uses. Everything is optional: playback works without the server.
import type { Issue, Step } from '../engine'
import type { ScenarioFile } from '../scenarios/schema'

export type SessionSummary = { id: string; title: string; steps: number; basedOn?: string }
export type SessionUpdate = SessionSummary & { file: ScenarioFile }

class ApiError extends Error {
  readonly status: number
  readonly body: { error?: string; details?: string[]; issues?: Issue[] }
  constructor(status: number, body: ApiError['body']) {
    super([body.error ?? `HTTP ${status}`, ...(body.details ?? []), ...(body.issues ?? []).map((i) => i.message)].join(': '))
    this.status = status
    this.body = body
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json)
  return json as T
}

export const api = {
  // undefined when the server isn't running.
  listSessions: () => call<SessionSummary[]>('GET', '/sessions').catch(() => undefined),
  createSession: (opts: { scenario: string; atStep: number }) => call<SessionSummary>('POST', '/sessions', opts),
  applyStep: (id: string, step: Step) => call<{ position: number }>('POST', `/sessions/${id}/steps`, step),
  undo: (id: string) => call<SessionSummary>('POST', `/sessions/${id}/undo`),
  fork: (id: string, atStep: number) => call<SessionSummary>('POST', `/sessions/${id}/fork`, { atStep }),
}

// Calls onUpdate with the whole session now and after every change.
export function subscribeSession(id: string, onUpdate: (s: SessionUpdate) => void, onError: (message: string) => void): () => void {
  const source = new EventSource(`/api/sessions/${id}/events`)
  source.addEventListener('session', (e) => onUpdate(JSON.parse((e as MessageEvent<string>).data)))
  source.onerror = () => {
    // EventSource retries by itself; a closed source means it gave up (e.g. 404).
    if (source.readyState === EventSource.CLOSED) onError(`Can't follow session ${id}. Is the API running, and does the session exist?`)
    else onError('Lost the connection to the API; retrying…')
  }
  source.onopen = () => onError('')
  return () => source.close()
}
