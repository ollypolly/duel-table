// Shipped scenarios plus your branches, resolved together so a branch can
// extend any scenario.
import { useMemo } from 'react'
import { cardDb } from '../data/cards'
import { useBranchStore } from '../store/branchStore'
import { rawDecks, rawScenarios, scenarioResults } from './load'
import { resolveScenario, type ResolveResult } from './resolve'

export const resultId = (r: ResolveResult) => (r.ok ? r.scenario.id : r.id)

export function useScenarios() {
  const branches = useBranchStore((s) => s.branches)
  const branchResults = useMemo(() => {
    const ctx = { db: cardDb, decks: rawDecks, scenarios: { ...rawScenarios, ...Object.fromEntries(branches.map((b) => [b.id, b])) } }
    return branches.map((b) => resolveScenario(b, ctx))
  }, [branches])
  return { scenarios: scenarioResults, branches: branchResults, branchIds: new Set(branches.map((b) => b.id)) }
}
