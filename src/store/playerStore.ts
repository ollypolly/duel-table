// What's open and the playback position, and preferences. Only the
// preferences are saved: what's open lives in the URL (urlSync), so a reload
// lands where you were and a fresh start opens the picker. `position` is 0 for
// the setup and n for "after step n".
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SPEEDS = [0.5, 1, 2, 4] as const
export const BASE_STEP_MS = 2500

type PlayerState = {
  scenarioId?: string
  sessionId?: string // live mode
  position: number
  speed: number
  playing: boolean
  muted: boolean
  followFocus: boolean // the camera follows each step's action, or is yours to pan and zoom; back on at each load and each scenario or game opened
  open: (scenarioId: string, position?: number) => void
  openSession: (sessionId: string | undefined, position?: number) => void
  goTo: (position: number) => void
  setSpeed: (speed: number) => void
  setPlaying: (playing: boolean) => void
  pinHand: boolean // your hand stays at the bottom of the screen as a fan
  setFollowFocus: (followFocus: boolean) => void
  setPinHand: (pinHand: boolean) => void
  setMuted: (muted: boolean) => void
}

type Persisted = Pick<PlayerState, 'speed' | 'muted' | 'pinHand'>

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      position: 0,
      speed: 1,
      playing: false,
      muted: false,
      followFocus: true,
      pinHand: true,
      open: (scenarioId, position = 0) => set({ scenarioId, sessionId: undefined, position, playing: false, followFocus: true }),
      openSession: (sessionId, position = 0) => set({ sessionId, position, playing: false, followFocus: true }),
      goTo: (position) => set({ position }),
      setSpeed: (speed) => set({ speed }),
      setPlaying: (playing) => set({ playing }),
      setFollowFocus: (followFocus) => set({ followFocus }),
      setPinHand: (pinHand) => set({ pinHand }),
      setMuted: (muted) => set({ muted }),
    }),
    {
      name: 'duel-table/player',
      version: 3,
      partialize: ({ speed, muted, pinHand }): Persisted => ({ speed, muted, pinHand }),
      // Only called when the stored version differs. Earlier versions also
      // saved what was open; the preferences carry over.
      migrate: (old): Persisted => {
        const { speed = 1, muted = false, pinHand = true } = (old ?? {}) as Partial<Persisted>
        return { speed, muted, pinHand }
      },
    },
  ),
)
