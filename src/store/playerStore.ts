// Playback position and preferences, persisted so a reload lands where you
// were. `position` is 0 for the setup and n for "after step n".
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SPEEDS = [0.5, 1, 2, 4] as const
export const BASE_STEP_MS = 2500

type PlayerState = {
  scenarioId?: string
  sessionId?: string // live mode; comes from the URL, not persisted
  position: number
  speed: number
  playing: boolean
  followFocus: boolean // the camera follows each step's action, or is yours to pan and zoom; back on at each load and each scenario or game opened
  open: (scenarioId: string, position?: number) => void
  openSession: (sessionId: string | undefined, position?: number) => void
  goTo: (position: number) => void
  setSpeed: (speed: number) => void
  setPlaying: (playing: boolean) => void
  setFollowFocus: (followFocus: boolean) => void
}

type Persisted = Pick<PlayerState, 'position' | 'speed'> & { scenarioId: string | undefined }

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      position: 0,
      speed: 1,
      playing: false,
      followFocus: true,
      open: (scenarioId, position = 0) => set({ scenarioId, sessionId: undefined, position, playing: false, followFocus: true }),
      openSession: (sessionId, position = 0) => set({ sessionId, position, playing: false, followFocus: true }),
      goTo: (position) => set({ position }),
      setSpeed: (speed) => set({ speed }),
      setPlaying: (playing) => set({ playing }),
      setFollowFocus: (followFocus) => set({ followFocus }),
    }),
    {
      name: 'duel-table/player',
      version: 2,
      partialize: ({ scenarioId, position, speed }): Persisted => ({ scenarioId, position, speed }),
      // Only called when the stored version differs. Version 1 also saved
      // followFocus; anything else unrecognised starts fresh.
      migrate: (old, version): Persisted => {
        if (version === 1) {
          const { scenarioId, position, speed } = old as Persisted
          return { scenarioId, position, speed }
        }
        return { scenarioId: undefined, position: 0, speed: 1 }
      },
    },
  ),
)
