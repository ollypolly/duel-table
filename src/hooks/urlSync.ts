// Deep links: ?scenario=<id>&step=<n> opens that moment, and the URL follows
// along as you step, so a link can point at an exact position.
import { usePlayerStore } from '../store/playerStore'

export function initUrlSync() {
  const params = new URLSearchParams(window.location.search)
  const scenario = params.get('scenario')
  if (scenario) usePlayerStore.getState().open(scenario, Math.max(0, Number(params.get('step')) || 0))

  const write = () => {
    const { scenarioId, position } = usePlayerStore.getState()
    const url = new URL(window.location.href)
    if (scenarioId) url.searchParams.set('scenario', scenarioId)
    url.searchParams.set('step', String(position))
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }
  write()
  usePlayerStore.subscribe(write)
}
