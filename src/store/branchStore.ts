// Your branches, persisted in the browser. Each is a fork file, so export is
// just a download and import is a parse.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BranchFile } from '../branches/branches'
import type { Step } from '../engine'

type BranchState = {
  branches: BranchFile[]
  add: (branch: BranchFile) => void
  appendStep: (id: string, step: Step) => void
  undo: (id: string) => void
  remove: (id: string) => void
}

type Persisted = Pick<BranchState, 'branches'>

const update = (branches: BranchFile[], id: string, fn: (b: BranchFile) => BranchFile) =>
  branches.map((b) => (b.id === id ? fn(b) : b))

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      branches: [],
      add: (branch) => set((s) => ({ branches: [...s.branches, branch] })),
      appendStep: (id, step) => set((s) => ({ branches: update(s.branches, id, (b) => ({ ...b, steps: [...b.steps, step] })) })),
      undo: (id) => set((s) => ({ branches: update(s.branches, id, (b) => ({ ...b, steps: b.steps.slice(0, -1) })) })),
      remove: (id) => set((s) => ({ branches: s.branches.filter((b) => b.id !== id) })),
    }),
    {
      name: 'duel-table/branches',
      version: 1,
      partialize: ({ branches }): Persisted => ({ branches }),
      // No older versions exist yet.
      migrate: (): Persisted => ({ branches: [] }),
    },
  ),
)
