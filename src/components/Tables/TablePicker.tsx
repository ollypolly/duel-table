// What's on the table: one picker for your tables (games and boards on the
// local API, which you can rename and delete) and the lessons and scenarios
// in the repo (view-only; "New table from here" plays on from one). It's a
// dialog, opened from the header, and it's also the home screen: with
// nothing open it shows on its own and can't be closed until you pick. With a
// Claude login, a finished game can be opened to review with Claude.
import { MessageSquareText, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { api, type SessionSummary } from '../../api/client'
import { reviewable } from '../../api/review'
import type { ResolveResult } from '../../scenarios/resolve'
import { MenuLabel } from '../Menu/Menu'

type Props = {
  tables?: SessionSummary[] // undefined: the API isn't running
  scenarios: ResolveResult[]
  branches: ResolveResult[]
  tableId?: string
  scenarioId?: string
}

type DialogProps = Props & {
  open: boolean
  required: boolean // the home screen: no closing it without a pick
  onClose: () => void
  onOpenTable: (id: string | undefined) => void
  onOpenScenario: (id: string) => void
  onNewGame: () => void
  onChanged: () => void // a table was renamed or deleted
  onReview?: (id: string) => Promise<unknown> // with a Claude login
}

const key = (r: ResolveResult) => (r.ok ? r.scenario.id : r.id)
const scenarioTitle = (r: ResolveResult) => (r.ok ? r.scenario.title : `⚠ ${r.id} (invalid)`)

const seat = (p: SessionSummary['players']['p1']) => (p.deckName ? `${p.name} (${p.deckName})` : p.name)
const matchup = (t: SessionSummary) => `${seat(t.players.p1)} vs ${seat(t.players.p2)}`
// Titles the server made up; a renamed table shows its own.
const autoTitle = (t: SessionSummary) => t.kind === 'game' && t.title.startsWith('Game: ')
const tableName = (t: SessionSummary) => (autoTitle(t) ? matchup(t) : t.title)

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
function details(t: SessionSummary) {
  const result = t.winner ? `${t.winner === 'p1' ? 'You' : t.players.p2.name} won, turn ${t.turn}` : t.kind === 'game' ? `Turn ${t.turn}` : `${t.steps} steps`
  return [!autoTitle(t) && t.kind === 'game' && matchup(t), result, day(t.updatedAt)].filter(Boolean).join(' · ')
}

const currentLabel = ({ tables, scenarios, branches, tableId, scenarioId }: Props) => {
  const current = tableId ? tables?.find((t) => t.id === tableId) : undefined
  const scenario = !tableId ? [...scenarios, ...branches].find((r) => key(r) === scenarioId) : undefined
  return current ? tableName(current) : scenario ? scenarioTitle(scenario) : (tableId ?? 'Tables')
}

// The header button: what's open, and a click opens the picker.
export function TablePickerButton({ onClick, ...props }: Props & { onClick: () => void }) {
  return (
    <button type="button" className="btn min-w-0" title="Tables, lessons and scenarios" onClick={onClick}>
      <span className="block max-w-[14rem] truncate sm:max-w-[22rem]">{currentLabel(props)}</span> <span className="text-[0.6rem] text-faint">▾</span>
    </button>
  )
}

export function TablePicker({
  open,
  required,
  onClose,
  tables,
  scenarios,
  branches,
  tableId,
  scenarioId,
  onOpenTable,
  onOpenScenario,
  onNewGame,
  onChanged,
  onReview,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])
  const pick = (go: () => void) => () => {
    go()
    onClose()
  }

  const newest = [...(tables ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const sections: [string, SessionSummary[]][] = [
    ['In progress', newest.filter((t) => t.kind === 'game' && !t.winner)],
    ['Past games', newest.filter((t) => t.kind === 'game' && t.winner)],
    ['Boards', newest.filter((t) => t.kind === 'board')],
  ]

  return (
    <dialog
      ref={ref}
      aria-label="Tables, lessons and scenarios"
      onClose={onClose}
      onCancel={(e) => required && e.preventDefault()}
      onClick={(e) => !required && e.target === ref.current && ref.current.close()}
      className="panel m-auto max-h-[min(44rem,calc(var(--safe-h)-2rem))] w-[min(32rem,94vw)] bg-surface p-0 text-ink backdrop:bg-bg/80 backdrop:backdrop-blur-md"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 font-display text-lg font-semibold">{required ? 'What would you like to open?' : 'Open'}</h2>
        {!required && (
          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </div>
      <div className="p-1.5">
        {tables && <Row onClick={pick(onNewGame)}>New game…</Row>}
        {sections.map(
          ([title, rows]) =>
            rows.length > 0 && (
              <section key={title}>
                <MenuLabel>{title}</MenuLabel>
                {rows.map((t) => (
                  <TableRow
                    key={t.id}
                    table={t}
                    current={t.id === tableId}
                    onOpen={pick(() => onOpenTable(t.id))}
                    onReview={onReview && reviewable(t) ? () => onReview(t.id).then(onClose) : undefined}
                    onChanged={onChanged}
                    onDeleted={() => t.id === tableId && onOpenTable(undefined)}
                  />
                ))}
              </section>
            ),
        )}
        <MenuLabel>Lessons & scenarios</MenuLabel>
        {scenarios.map((r) => (
          <ScenarioRow key={key(r)} r={r} current={!tableId && key(r) === scenarioId} onOpen={pick(() => onOpenScenario(key(r)))} />
        ))}
        {branches.length > 0 && (
          <>
            <MenuLabel>Your branches</MenuLabel>
            {branches.map((r) => (
              <ScenarioRow key={key(r)} r={r} current={!tableId && key(r) === scenarioId} onOpen={pick(() => onOpenScenario(key(r)))} />
            ))}
          </>
        )}
      </div>
    </dialog>
  )
}

function Row({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`block rounded px-2.5 py-1.5 text-left text-sm hover:bg-raised ${className}`} {...props} />
}

function ScenarioRow({ r, current, onOpen }: { r: ResolveResult; current: boolean; onOpen: () => void }) {
  return (
    <Row onClick={onOpen} aria-current={current} className={`w-full ${current ? 'text-gold' : ''}`}>
      <span className="block truncate">{scenarioTitle(r)}</span>
      {r.ok && <span className="text-xs text-muted">{r.scenario.game.steps.length} steps</span>}
    </Row>
  )
}

function TableRow({
  table,
  current,
  onOpen,
  onReview,
  onChanged,
  onDeleted,
}: {
  table: SessionSummary
  current: boolean
  onOpen: () => void
  onReview?: () => Promise<unknown>
  onChanged: () => void
  onDeleted: () => void
}) {
  const [mode, setMode] = useState<'rename' | 'delete'>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const run = (p: Promise<unknown>, after?: () => void) =>
    p.then(
      () => {
        setMode(undefined)
        setError('')
        after?.()
        onChanged()
      },
      (e: Error) => setError(e.message),
    )

  if (mode === 'rename') {
    return (
      <form
       
        className="flex items-center gap-1 px-1.5 py-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void run(api.renameSession(table.id, name.trim()))
        }}
      >
        <input
          autoFocus
          aria-label="Table name"
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setMode(undefined))}
        />
        <button type="submit" className="btn px-2 py-1 text-xs">
          Save
        </button>
        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setMode(undefined)}>
          Cancel
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    )
  }
  return (
    <div className="group flex items-start gap-1">
      <Row onClick={onOpen} aria-current={current} className={`min-w-0 flex-1 ${current ? 'text-gold' : ''}`}>
        <span className="block truncate">{tableName(table)}</span>
        <span className="block truncate text-xs text-muted">{details(table)}</span>
      </Row>
      {mode === 'delete' ? (
        <span className="flex shrink-0 items-center gap-1 self-center pr-1 text-xs">
          <button type="button" className="btn px-2 py-1 text-danger" onClick={() => void run(api.deleteSession(table.id), onDeleted)}>
            Delete
          </button>
          <button type="button" className="btn px-2 py-1" onClick={() => setMode(undefined)}>
            Keep
          </button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center self-center">
          {onReview && (
            <button type="button" className="btn mr-1" title="Go back over it with Claude" onClick={() => void run(onReview())}>
              <MessageSquareText size={13} aria-hidden />
              Review
            </button>
          )}
          <span className="flex opacity-60 group-hover:opacity-100">
          <button
            type="button"
            className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink"
            aria-label={`Rename ${tableName(table)}`}
            onClick={() => {
              setName(tableName(table))
              setMode('rename')
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-muted hover:bg-raised hover:text-danger"
            aria-label={`Delete ${tableName(table)}`}
            onClick={() => setMode('delete')}
          >
            <Trash2 size={13} />
          </button>
          </span>
        </span>
      )}
      {error && <p className="px-2.5 text-xs text-danger">{error}</p>}
    </div>
  )
}
