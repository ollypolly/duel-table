// Deep links: ?scenario=<id>&step=<n> opens that moment (?session=<id> for a
// live session), and the URL follows along as you step, so a link can point
// at an exact position. Opening something else, or going home, is a new entry
// in the browser's history, so Back and Forward move between them; stepping
// within one isn't. ?decks=<id> opens the deck hub on a deck, and
// ?panel=open|closed keeps the scene panel (the phone's sheet) as you left it.
import { usePlayerStore } from '../store/playerStore'

export function initUrlSync() {
  // What the URL says is open, into the store.
  const read = () => {
    const params = new URLSearchParams(window.location.search)
    const step = Math.max(0, Number(params.get('step')) || 0)
    const scenario = params.get('scenario')
    const session = params.get('session')
    const { open, openSession, goHome } = usePlayerStore.getState()
    if (session) openSession(session, params.has('step') ? step : Infinity)
    else if (scenario) open(scenario, step)
    else goHome()
  }
  const opened = () => {
    const { scenarioId, sessionId } = usePlayerStore.getState()
    return sessionId ? `session ${sessionId}` : (scenarioId ?? '')
  }

  let reading = true
  read()
  let last = opened()
  reading = false

  const write = () => {
    if (reading) return
    const { scenarioId, sessionId, position } = usePlayerStore.getState()
    const url = new URL(window.location.href)
    if (sessionId) {
      url.searchParams.set('session', sessionId)
      url.searchParams.delete('scenario')
    } else {
      url.searchParams.delete('session')
      if (scenarioId) url.searchParams.set('scenario', scenarioId)
      else url.searchParams.delete('scenario')
    }
    if (sessionId || scenarioId) url.searchParams.set('step', String(position))
    else url.searchParams.delete('step')
    if (url.href === window.location.href) return
    if (opened() === last) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    last = opened()
  }
  write()
  usePlayerStore.subscribe(write)
  window.addEventListener('popstate', () => {
    reading = true
    read()
    last = opened()
    reading = false
  })
}

export const deckFromUrl = () => new URLSearchParams(window.location.search).get('decks') ?? undefined

export const panelFromUrl = () => {
  const panel = new URLSearchParams(window.location.search).get('panel')
  return panel === 'open' ? true : panel === 'closed' ? false : undefined
}

export function writePanel(open: boolean) {
  const url = new URL(window.location.href)
  url.searchParams.set('panel', open ? 'open' : 'closed')
  if (url.href !== window.location.href) window.history.replaceState(null, '', url)
}
