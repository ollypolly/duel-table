// The home page: what you can open, and where you go to switch. The top
// offers the next thing to do: your unfinished game to carry on with, or your
// last one to play again or go over. Under it, everything by kind: games (won
// in green, lost in red, with what Claude's review found), lessons, free play tables.
// Shown when nothing is open; the header's title comes back here.
import { Loader2, MessageSquareText, MoreHorizontal, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, type SessionSummary } from '../../api/client'
import { MOMENT_KINDS, reviewable, type Moment } from '../../api/review'
import type { ResolveResult } from '../../scenarios/resolve'
import { rawDecks } from '../../scenarios/load'
import { usePlayerStore } from '../../store/playerStore'
import { MOMENT } from '../Live/moment'
import { Logo } from '../Logo/Logo'
import { Menu, MenuItem } from '../Menu/Menu'
import { ago, autoTitle, scenarioKey, scenarioTitle, tableName } from './names'

type Props = {
  tables?: SessionSummary[] // undefined: the API isn't running
  scenarios: ResolveResult[]
  branches: ResolveResult[]
  claudeOn: boolean
  onOpenTable: (id: string) => void
  onOpenScenario: (id: string, position?: number) => void
  onNewGame: () => void
  onNewLesson: () => void
  onReview: (id: string) => Promise<unknown> // starts one, or opens the one it has
  onRematch: (t: SessionSummary) => Promise<unknown>
  onChanged: () => void // a table was renamed or deleted
}

const TABS = ['Games', 'Lessons', 'Free play'] as const
const DECKS = Object.entries(rawDecks).map(([id, raw]) => ({ id, name: (raw as { name?: string }).name ?? id }))
const FILTERS = ['All', 'Won', 'Lost', 'In progress'] as const

const result = (t: SessionSummary) => (!t.winner ? 'In progress' : t.winner === 'p1' ? 'Won' : 'Lost')
// A lesson is done once its plan is, or its duel is over; until then, the point it's on.
const lessonDone = (t: SessionSummary) => (t.lessonPlan ? t.lessonPlan.now >= t.lessonPlan.of : !!t.winner)
const lessonStatus = (t: SessionSummary) => (lessonDone(t) ? 'Done' : t.lessonPlan ? `${t.lessonPlan.now + 1} of ${t.lessonPlan.of}` : 'In progress')
const RESULT = {
  Won: { edge: 'border-l-ok', text: 'text-ok' },
  Lost: { edge: 'border-l-danger', text: 'text-danger' },
  'In progress': { edge: 'border-l-gold', text: 'text-gold' },
}
const canRematch = (t: SessionSummary) => !!t.winner && !t.claudeLesson && !!t.players.p1.deck && !!t.players.p2.deck
const yourDeck = (t: SessionSummary) => t.players.p1.deckName ?? t.players.p1.name
const against = (t: SessionSummary) => ['vs ' + t.players.p2.name, t.players.p2.deckName].filter(Boolean).join(' · ')
const GRID = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'

export function Home({ tables, scenarios, branches, claudeOn, onOpenTable, onOpenScenario, onNewGame, onNewLesson, onReview, onRematch, onChanged }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Games')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const newest = [...(tables ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const games = newest.filter((t) => t.kind === 'game' && !t.claudeLesson)
  const claudeLessons = newest.filter((t) => t.claudeLesson)
  const boards = newest.filter((t) => t.kind === 'board')
  const finished = games.filter((t) => t.winner)
  const won = finished.filter((t) => t.winner === 'p1').length
  const shown = games.filter((t) => filter === 'All' || result(t) === filter)
  const card = (t: SessionSummary) => (
    <TableCard key={t.id} table={t} claudeOn={claudeOn} onOpen={() => onOpenTable(t.id)} onReview={() => onReview(t.id)} onRematch={() => onRematch(t)} onChanged={onChanged} />
  )
  const lessons = (list: ResolveResult[]) => <ScenarioCards list={list} onOpen={onOpenScenario} />

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 pb-[max(2rem,var(--safe-bottom))] pt-6 sm:px-8 sm:pt-10">
        <h1 className="flex items-center justify-center gap-3 font-display text-4xl font-bold tracking-tight sm:gap-4 sm:text-5xl">
          <Logo className="size-10 sm:size-12" />
          Duel Table
        </h1>
        <section className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {!tables ? (
              "The local API isn't running, so games are off. The lessons below still work."
            ) : finished.length ? (
              <>
                {finished.length} played · <span className="text-ok">{won} won</span> · <span className="text-danger">{finished.length - won} lost</span>
              </>
            ) : (
              'No games played yet.'
            )}
          </p>
          {tables && (
            <button type="button" className="btn btn-primary flex items-center gap-1.5" onClick={onNewGame}>
              <Plus size={14} aria-hidden />
              New game
            </button>
          )}
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 max-sm:w-full" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`flex-1 rounded-md px-4 py-1.5 font-display text-sm font-semibold sm:flex-none ${tab === t ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === 'Games' && games.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} className={`btn text-xs ${filter === f ? 'border-gold text-gold' : ''}`} onClick={() => setFilter(f)}>
                    {f}
                  </button>
                ))}
              </div>
            )}
            {tab === 'Lessons' && tables && claudeOn && (
              <button type="button" className="btn flex items-center gap-1.5 sm:ml-auto" onClick={onNewLesson}>
                <Plus size={14} aria-hidden />
                New lesson with Claude
              </button>
            )}
          </div>

          {tab === 'Games' &&
            (games.length === 0 ? (
              <Empty action={tables && { label: 'New game', run: onNewGame }}>{tables ? 'No games yet. Your games against the bot and Claude show up here.' : 'Games need the local API running.'}</Empty>
            ) : shown.length ? (
              // Games still to finish first, apart from the ones that are over.
              <div className="space-y-6">
                {[
                  ['In progress', shown.filter((t) => !t.winner)] as const,
                  ['Finished', shown.filter((t) => t.winner)] as const,
                ].map(
                  ([title, list]) =>
                    list.length > 0 && (
                      <div key={title}>
                        <Heading>{title}</Heading>
                        <div className={GRID}>{list.map(card)}</div>
                      </div>
                    ),
                )}
              </div>
            ) : (
              <Empty>No games here.</Empty>
            ))}

          {tab === 'Lessons' && (
            <div className="space-y-6">
              {tables && (
                <div>
                  <Heading>With Claude</Heading>
                  {claudeLessons.length ? (
                    <div className={GRID}>{claudeLessons.map(card)}</div>
                  ) : (
                    <Empty>{claudeOn ? 'Ask Claude to teach you a deck, a combo or a matchup. It plays both sides to show you, then hands you a side to try.' : 'Log in to Claude Code on this machine (run `claude`) for lessons Claude runs.'}</Empty>
                  )}
                </div>
              )}
              <div>
                <Heading>Lessons and scenarios</Heading>
                {lessons(scenarios)}
              </div>
            </div>
          )}

          {tab === 'Free play' && (
            <div className="space-y-6">
              <p className="text-sm text-muted">A free table: no rules engine and no opponent. Move any card anywhere, on either side, to try things out. Playing on from a step of a lesson makes one too.</p>
              {tables && <NewTable onOpen={onOpenTable} />}
              {boards.length > 0 && <div className={GRID}>{boards.map(card)}</div>}
              {branches.length > 0 && (
                <div>
                  <Heading>Your branches</Heading>
                  {lessons(branches)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-widest text-faint">{children}</h2>
}

// Start a free table from two decks: shuffled, with opening hands, and nothing enforced.
function NewTable({ onOpen }: { onOpen: (id: string) => void }) {
  const [deck, setDeck] = useState(DECKS[0]?.id ?? '')
  const [theirs, setTheirs] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pick = (label: string, value: string, set: (v: string) => void, same?: boolean) => (
    <label className="min-w-0 flex-1 basis-40 space-y-1 text-xs text-muted">
      <span>{label}</span>
      <select className="block w-full px-2 py-1.5 text-sm" value={value} onChange={(e) => set(e.target.value)}>
        {same && <option value="">Same as yours</option>}
        {DECKS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  )
  const start = () => {
    setBusy(true)
    setError('')
    api
      .createSession({ deck, ...(theirs && { opponentDeck: theirs }), title: `Free play: ${DECKS.find((d) => d.id === deck)?.name ?? deck}` })
      .then((s) => onOpen(s.id))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  return (
    <div className="panel flex flex-wrap items-end gap-3 p-4" data-testid="new-table">
      {pick('Your deck', deck, setDeck)}
      {pick('Other side', theirs, setTheirs, true)}
      <button type="button" className="btn btn-primary flex items-center gap-1.5" disabled={busy || !deck} onClick={start}>
        <Plus size={14} aria-hidden />
        New table
      </button>
      {error && <p className="basis-full text-xs text-danger">{error}</p>}
    </div>
  )
}

function Empty({ children, action }: { children: ReactNode; action?: { label: string; run: () => void } | false }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
      <p>{children}</p>
      {action && (
        <button type="button" className="btn btn-primary mt-3" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  )
}

// Lessons, the ones you were last on first, each with how far you got.
function ScenarioCards({ list, onOpen }: { list: ResolveResult[]; onOpen: (id: string, position?: number) => void }) {
  const progress = usePlayerStore((s) => s.progress)
  const sorted = [...list].sort((a, b) => (progress[scenarioKey(b)]?.at ?? 0) - (progress[scenarioKey(a)]?.at ?? 0))
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sorted.map((r) => {
        const steps = r.ok ? r.scenario.game.steps.length : 0
        const at = Math.min(progress[scenarioKey(r)]?.step ?? 0, steps)
        const done = steps > 0 && at >= steps
        return (
          <button key={scenarioKey(r)} type="button" className="panel flex flex-col gap-1 p-4 text-left hover:border-gold" onClick={() => onOpen(scenarioKey(r), done ? 0 : at)}>
            <span className="font-display font-semibold">{scenarioTitle(r)}</span>
            {r.ok && r.scenario.description && <span className="line-clamp-2 text-sm text-muted">{r.scenario.description.replace(/\*\*|`/g, '')}</span>}
            {steps > 1 && (
              <span className="mt-auto flex items-center gap-2 pt-1 text-xs">
                <span className={done ? 'text-ok' : at ? 'text-gold' : 'text-faint'}>{done ? 'Finished' : at ? `Step ${at} of ${steps}` : `Not started · ${steps} steps`}</span>
                {at > 0 && (
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                    <span className={`block h-full ${done ? 'bg-ok' : 'bg-gold'}`} style={{ width: `${(at / steps) * 100}%` }} />
                  </span>
                )}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

type Actions = { table: SessionSummary; claudeOn: boolean; onOpen: () => void; onReview: () => Promise<unknown>; onRematch: () => Promise<unknown> }

// "View review" opens the one it has; only a new one needs a Claude login.
const canReview = (t: SessionSummary, claudeOn: boolean) => !t.claudeLesson && reviewable(t) && (!!t.reviewed || claudeOn)

function ReviewButton({ table: t, busy, onClick }: { table: SessionSummary; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn flex items-center gap-1.5 text-xs" disabled={busy} title={t.reviewed ? 'Open the review you have' : 'Go back over it with Claude'} onClick={onClick}>
      <MessageSquareText size={13} aria-hidden />
      {t.reviewed ? 'View review' : 'Review'}
    </button>
  )
}

// One of your tables; the whole card opens it (and its open menu lifts it
// over the cards after it). A game leads with the deck you
// played and how it went, and a finished one has its review.
function TableCard({ table: t, claudeOn, onOpen, onReview, onRematch, onChanged }: Actions & { onChanged: () => void }) {
  const [mode, setMode] = useState<'rename' | 'delete'>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = (p: Promise<unknown>, changed = false) => {
    setBusy(true)
    return p
      .then(
        () => {
          setMode(undefined)
          setError('')
          if (changed) onChanged()
        },
        (e: Error) => setError(e.message),
      )
      .finally(() => setBusy(false))
  }
  const game = t.kind === 'game' && !t.claudeLesson
  const how = result(t)
  const named = !autoTitle(t)
  const title = named ? t.title : t.kind === 'game' ? yourDeck(t) : tableName(t)
  const under = t.kind === 'game' && (named ? `${yourDeck(t)} ${against(t)}` : t.claudeLesson ? `Lesson · ${against(t)}` : against(t))
  const meta = [t.kind === 'game' ? `Turn ${t.turn}` : `${t.steps} steps`, ago(t.updatedAt)].join(' · ')

  if (mode === 'rename') {
    return (
      <form
        className="panel flex flex-wrap items-center gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void run(api.renameSession(t.id, name.trim()), true)
        }}
      >
        <input
          autoFocus
          aria-label="Table name"
          className="min-w-0 flex-1 basis-full rounded border border-line bg-surface px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setMode(undefined))}
        />
        <button type="submit" className="btn text-xs">
          Save
        </button>
        <button type="button" className="btn text-xs" onClick={() => setMode(undefined)}>
          Cancel
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    )
  }

  return (
    <div className={`panel relative flex flex-col gap-2 border-l-4 p-4 hover:bg-raised/40 has-[[aria-expanded=true]]:z-20 ${t.claudeLesson ? (lessonDone(t) ? 'border-l-ok' : 'border-l-gold') : game ? RESULT[how].edge : 'border-l-line'}`} data-testid="table-card">
      <button type="button" className="absolute inset-0 rounded-[inherit]" aria-label={`Open ${tableName(t)}`} onClick={onOpen} />
      <div className="pointer-events-none relative min-w-0">
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-display font-semibold">{title}</span>
          {t.claudeLesson ? (
            <span className={`shrink-0 font-display text-xs font-semibold uppercase tracking-wider ${lessonDone(t) ? 'text-ok' : 'text-gold'}`}>{lessonStatus(t)}</span>
          ) : (
            game && <span className={`shrink-0 font-display text-xs font-semibold uppercase tracking-wider ${RESULT[how].text}`}>{how}</span>
          )}
        </p>
        {under && <p className="text-sm text-muted">{under}</p>}
        <p className="text-xs text-faint">{meta}</p>
        {t.reviewed && <Reviewed reviewed={t.reviewed} />}
      </div>
      <div className="relative mt-auto flex justify-end">
        {mode === 'delete' ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs">
            <button type="button" className="btn text-danger" onClick={() => void run(api.deleteSession(t.id), true)}>
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setMode(undefined)}>
              Keep
            </button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5">
            {canReview(t, claudeOn) && <ReviewButton table={t} busy={busy} onClick={() => void run(onReview())} />}
            <Menu label={<MoreHorizontal size={14} />} title={`More for ${tableName(t)}`} align="right">
              {canRematch(t) && (
                <MenuItem disabled={busy} onClick={() => void run(onRematch())}>
                  Rematch
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  setName(tableName(t))
                  setMode('rename')
                }}
              >
                Rename
              </MenuItem>
              <MenuItem danger onClick={() => setMode('delete')}>
                Delete
              </MenuItem>
            </Menu>
          </span>
        )}
      </div>
      {error && <p className="relative text-xs text-danger">{error}</p>}
    </div>
  )
}

const FOUND: Record<Moment['kind'], (n: number) => string> = {
  blunder: (n) => `${n} blunder${n > 1 ? 's' : ''}`,
  mistake: (n) => `${n} mistake${n > 1 ? 's' : ''}`,
  missed: (n) => `${n} missed`,
  good: (n) => `${n} good`,
}

// What Claude's review found: the key moments by kind, in their colours.
function Reviewed({ reviewed }: { reviewed: NonNullable<SessionSummary['reviewed']> }) {
  if (!reviewed.scanned) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        {reviewed.busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
        {reviewed.busy ? 'Reviewing…' : 'Review started'}
      </span>
    )
  }
  const kinds = [...MOMENT_KINDS].reverse().filter((k) => reviewed.moments[k])
  if (!kinds.length) return <span className="block text-xs text-muted">Reviewed</span>
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 text-xs">
      {kinds.map((k) => (
        <span key={k} className={MOMENT[k].text.split(' ')[0]}>
          {FOUND[k](reviewed.moments[k]!)}
        </span>
      ))}
    </span>
  )
}
