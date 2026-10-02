// How tables and scenarios are named wherever they're listed.
import type { SessionSummary } from '../../api/client'
import type { ResolveResult } from '../../scenarios/resolve'

export const scenarioKey = (r: ResolveResult) => (r.ok ? r.scenario.id : r.id)
export const scenarioTitle = (r: ResolveResult) => (r.ok ? r.scenario.title : `⚠ ${r.id} (invalid)`)

const seat = (p: SessionSummary['players']['p1']) => (p.deckName ? `${p.name} (${p.deckName})` : p.name)
export const matchup = (t: SessionSummary) => `${seat(t.players.p1)} vs ${seat(t.players.p2)}`
// Titles the server made up; a renamed table shows its own.
export const autoTitle = (t: SessionSummary) => t.kind === 'game' && /^(Game|Lesson): /.test(t.title)
export const tableName = (t: SessionSummary) => (autoTitle(t) ? matchup(t) : t.title)

// The day as ago() gives it, with the time of day: "today 08:44", "30 Sep 16:26".
export const when = (iso: string, now = new Date()) => `${ago(iso, now)} ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`

// "today", "yesterday", "3 days ago", then the date.
export function ago(iso: string, now = new Date()) {
  const then = new Date(iso)
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
