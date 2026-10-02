// What's open and the playback position, and preferences. Only the
// preferences are saved: what's open lives in the URL (urlSync), so a reload
// lands where you were and a fresh start opens the home page. `position` is 0 for
// the setup and n for "after step n".
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SPEEDS = [0.5, 1, 2, 4] as const
export const BASE_STEP_MS = 2500

type PlayerState = {
  scenarioId?: string
  sessionId?: string // live mode
  chatId?: string // a chat with Claude, open on its own page
  position: number
  speed: number
  playing: boolean
  muted: boolean
  followFocus: boolean // the camera follows each step's action, or is yours to pan and zoom; back on at each load and each scenario or game opened
  open: (scenarioId: string, position?: number) => void
  openSession: (sessionId: string | undefined, position?: number) => void
  openChat: (chatId: string) => void // a chat with Claude from the home page, on its own page
  goHome: () => void // nothing open
  goTo: (position: number) => void
  setSpeed: (speed: number) => void
  setPlaying: (playing: boolean) => void
  progress: Record<string, { step: number; at: number }> // how far you got in each lesson, and when you were last on it
  pinHand: boolean // your hand stays at the bottom of the screen as a fan
  setFollowFocus: (followFocus: boolean) => void
  setPinHand: (pinHand: boolean) => void
  setMuted: (muted: boolean) => void
}

type Persisted = Pick<PlayerState, 'speed' | 'muted' | 'pinHand' | 'progress'>

// The furthest step reached in the lesson that's open, if one is.
const reached = (s: PlayerState, scenarioId: string | undefined, position: number) =>
  scenarioId && Number.isFinite(position) ? { progress: { ...s.progress, [scenarioId]: { step: Math.max(position, s.progress[scenarioId]?.step ?? 0), at: Date.now() } } } : {}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      position: 0,
      speed: 1,
      playing: false,
      muted: false,
      followFocus: true,
      pinHand: true,
      progress: {},
      open: (scenarioId, position = 0) => set((s) => ({ scenarioId, sessionId: undefined, chatId: undefined, position, playing: false, followFocus: true, ...reached(s, scenarioId, position) })),
      openSession: (sessionId, position = 0) => set({ sessionId, chatId: undefined, position, playing: false, followFocus: true }),
      openChat: (chatId) => set({ chatId, scenarioId: undefined, sessionId: undefined, position: 0, playing: false }),
      goHome: () => set({ scenarioId: undefined, sessionId: undefined, chatId: undefined, position: 0, playing: false }),
      goTo: (position) => set((s) => ({ position, ...reached(s, s.sessionId ? undefined : s.scenarioId, position) })),
      setSpeed: (speed) => set({ speed }),
      setPlaying: (playing) => set({ playing }),
      setFollowFocus: (followFocus) => set({ followFocus }),
      setPinHand: (pinHand) => set({ pinHand }),
      setMuted: (muted) => set({ muted }),
    }),
    {
      name: 'duel-table/player',
      version: 4,
      partialize: ({ speed, muted, pinHand, progress }): Persisted => ({ speed, muted, pinHand, progress }),
      // Only called when the stored version differs. Earlier versions also
      // saved what was open; the preferences carry over.
      migrate: (old): Persisted => {
        const { speed = 1, muted = false, pinHand = true, progress = {} } = (old ?? {}) as Partial<Persisted>
        return { speed, muted, pinHand, progress }
      },
    },
  ),
)
