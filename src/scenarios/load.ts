// Browser-only: every file in scenarios/ and decks/, resolved against the card
// DB. Vite's import.meta.glob means edits to those files hot-reload in dev.
import { cardDb } from '../data/cards'
import { resolveAll, type ResolveResult } from './resolve'

const scenarioFiles = import.meta.glob('../../scenarios/*.json', { eager: true, import: 'default' })
const deckFiles = import.meta.glob('../../decks/*.json', { eager: true, import: 'default' })

const byId = (files: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, json]) => [
      (json as { id?: string }).id ?? path.split('/').pop()!.replace(/\.json$/, ''),
      json,
    ]),
  )

export const rawScenarios = byId(scenarioFiles)
export const rawDecks = byId(deckFiles)

export const scenarioResults: ResolveResult[] = resolveAll({ db: cardDb, decks: rawDecks, scenarios: rawScenarios }).sort(
  (a, b) => (a.ok ? a.scenario.title : a.id).localeCompare(b.ok ? b.scenario.title : b.id),
)
