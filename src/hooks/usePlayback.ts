import { useEffect } from 'react'
import { BASE_STEP_MS, usePlayerStore } from '../store/playerStore'

// Advances one step per tick while playing; stops at the end.
export function usePlayback(last: number) {
  const { playing, speed, position, goTo, setPlaying } = usePlayerStore()
  useEffect(() => {
    if (!playing) return
    if (position >= last) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => goTo(position + 1), BASE_STEP_MS / speed)
    return () => clearTimeout(t)
  }, [playing, speed, position, last, goTo, setPlaying])
}

// ←/→ step, space play/pause, Home/End. Ignored while typing in a field.
export function usePlaybackKeys(last: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, select, textarea, [contenteditable], dialog') || e.metaKey || e.ctrlKey || e.altKey) return
      const { position, playing, goTo, setPlaying } = usePlayerStore.getState()
      const actions: Record<string, () => void> = {
        ArrowRight: () => goTo(Math.min(last, position + 1)),
        ArrowLeft: () => goTo(Math.max(0, position - 1)),
        Home: () => goTo(0),
        End: () => goTo(last),
        ' ': () => setPlaying(!playing),
      }
      const action = actions[e.key]
      if (!action) return
      e.preventDefault()
      if (e.key !== ' ') setPlaying(false)
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, enabled])
}
