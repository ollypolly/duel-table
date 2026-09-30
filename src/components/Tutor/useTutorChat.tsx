// Claude as a tutor on a lesson, as a chat under the narration. Loaded when
// the lesson opens, and polled while Claude is answering so the reply shows
// as it's written. Each question carries the step you're on. Undefined when
// there's no tutor (no API, no Claude login, or not a lesson in the repo).
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { TutorView } from '../../api/tutor'
import { usePlayerStore } from '../../store/playerStore'
import { ClaudeChat, ClaudeInput } from '../Game/ClaudePanel'

const POLL_MS = 1000

export function useTutorChat(id: string | undefined) {
  // Kept with its lesson's id, so another lesson's chat never shows.
  const [loaded, setLoaded] = useState<{ id: string; view: TutorView }>()
  const view = loaded && loaded.id === id ? loaded.view : undefined
  const setView = (v: TutorView) => id && setLoaded({ id, view: v })

  useEffect(() => {
    if (!id) return
    api.tutor(id).then(
      (v) => setLoaded({ id, view: v }),
      () => {},
    )
  }, [id])

  const thinking = view?.status === 'thinking'
  useEffect(() => {
    if (!id || !thinking) return
    const timer = setInterval(
      () =>
        void api.tutor(id).then(
          (v) => setLoaded({ id, view: v }),
          () => {},
        ),
      POLL_MS,
    )
    return () => clearInterval(timer)
  }, [id, thinking])

  if (!id || !view) return undefined
  const update = (p: Promise<TutorView>) => void p.then(setView, (e: Error) => setView({ ...view, chat: [...view.chat, { from: 'note', text: e.message }] }))
  return {
    withNarration: true,
    log: <ClaudeChat claude={view} empty="Ask Claude about this step, or any step before it." />,
    input: (
      <ClaudeInput
        claude={view}
        placeholder="Ask about this step…"
        onChat={(text) => update(api.askTutor(id, text, usePlayerStore.getState().position))}
        onStop={() => update(api.stopTutor(id))}
        onSettings={(s) => update(api.tutorSettings(id, { model: s.model }))}
        onClear={() => update(api.clearTutor(id))}
      />
    ),
  }
}
