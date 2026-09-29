// Deep links: ?scenario=<id>&step=<n> opens that moment (?session=<id> for a
// live session), and the URL follows along as you step, so a link can point
// at an exact position.
import { usePlayerStore } from '../store/playerStore'

export function initUrlSync() {
  const params = new URLSearchParams(window.location.search)
  const step = Math.max(0, Number(params.get('step')) || 0)
  const scenario = params.get('scenario')
  const session = params.get('session')
  if (scenario) usePlayerStore.getState().open(scenario, step)
  if (session) usePlayerStore.getState().openSession(session, params.has('step') ? step : Infinity)

  const write = () => {
    const { scenarioId, sessionId, position } = usePlayerStore.getState()
    const url = new URL(window.location.href)
    if (sessionId) {
      url.searchParams.set('session', sessionId)
      url.searchParams.delete('scenario')
    } else {
      url.searchParams.delete('session')
      if (scenarioId) url.searchParams.set('scenario', scenarioId)
    }
    url.searchParams.set('step', String(position))
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }
  write()
  usePlayerStore.subscribe(write)
}
