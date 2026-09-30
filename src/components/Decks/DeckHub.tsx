// The deck hub: every deck in decks/, with its cards as a grid you can edit
// and its sleeves, deck box and playmat, new decks from a pasted decklist,
// and a way into a game with one. Decks are
// files on the local API, so this needs the server.
//
// Saving writes decks/<id>.json, which Vite hot-reloads as a full page load,
// so the open deck lives in the URL (?decks=<id>) and the hub comes back to it.
import * as Tooltip from '@radix-ui/react-tooltip'
import { Minus, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type Deck, type DeckEntry, type DeckSummary } from '../../api/client'
import { imagePath, isExtraDeckCard, type CardData } from '../../data/cardDb'
import { cardDb } from '../../data/cards'
import { catalogFace } from '../../view/boardView'
import { CardInspector } from '../CardInspector/CardInspector'
import { DeckCosmetics } from '../Cosmetics/Cosmetics'

const NEW = '+new'
const MAX_COPIES = 3

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const setUrl = (id?: string) => {
  const url = new URL(window.location.href)
  if (id === undefined) url.searchParams.delete('decks')
  else url.searchParams.set('decks', id)
  window.history.replaceState(null, '', url)
}

type Props = { open: boolean; initial?: string; onClose: () => void; onPlay: (deckId: string) => void }

export function DeckHub({ open, initial, onClose, onPlay }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [decks, setDecks] = useState<DeckSummary[]>()
  const [selected, setSelected] = useState(initial ?? '')
  const [error, setError] = useState('')
  const [inspecting, setInspecting] = useState<CardData>()

  const refresh = () =>
    api
      .decks()
      .then((d) => {
        setDecks(d)
        setSelected((s) => s || d[0]?.id || NEW)
      })
      .catch(() => setError("The local API isn't running, so decks can't be listed."))

  useEffect(() => {
    if (!open) return
    ref.current?.showModal()
    void refresh()
  }, [open])
  useEffect(() => {
    if (open && selected) setUrl(selected)
  }, [open, selected])

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setUrl(undefined)
        onClose()
      }}
      // Esc closes the open card first, then the hub.
      onCancel={(e) => {
        if (!inspecting) return
        e.preventDefault()
        setInspecting(undefined)
      }}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="panel m-auto h-[min(52rem,calc(var(--safe-h)-1rem))] w-[min(72rem,96vw)] p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-display text-lg font-semibold">Decks</h2>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
          {error && <p className="p-4 text-sm text-danger">{error}</p>}
          {decks && (
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <nav aria-label="Decks" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 md:w-56 md:flex-col md:border-b-0 md:border-r">
                {decks.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-current={d.id === selected}
                    className={`shrink-0 rounded px-2.5 py-1.5 text-left text-sm hover:bg-raised ${d.id === selected ? 'bg-raised text-gold' : ''}`}
                    onClick={() => setSelected(d.id)}
                  >
                    <span className="block font-semibold">{d.name ?? d.id}</span>
                    <span className="text-xs text-muted">{d.size ? `${d.size.main} + ${d.size.extra}` : 'Has errors'}</span>
                  </button>
                ))}
                <button type="button" className={`btn shrink-0 md:mt-2 ${selected === NEW ? 'btn-primary' : ''}`} onClick={() => setSelected(NEW)}>
                  <Plus size={14} className="mr-1 inline" aria-hidden />
                  New deck
                </button>
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {selected === NEW ? (
                  <NewDeck taken={decks.map((d) => d.id)} onCreated={(id) => void refresh().then(() => setSelected(id))} />
                ) : (
                  selected && (
                    <DeckEditor
                      key={selected}
                      id={selected}
                      taken={decks.map((d) => d.id)}
                      onSaved={(id) => void refresh().then(() => setSelected(id))}
                      onDeleted={() => void refresh().then(() => setSelected(''))}
                      onInspect={setInspecting}
                      onPlay={() => {
                        ref.current?.close()
                        onPlay(selected)
                      }}
                    />
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <CardInspector card={inspecting && catalogFace(inspecting)} materialsOf={() => []} onClose={() => setInspecting(undefined)} />
    </dialog>
  )
}

// A 422's unknown names, each with its suggestions as buttons that swap it in.
function Unknown({ unknown, onReplace }: { unknown: NonNullable<ApiError['body']['unknown']>; onReplace?: (from: string, to: string) => void }) {
  return (
    <ul className="space-y-1 text-sm text-danger">
      {unknown.map((u) => (
        <li key={u.name}>
          No card called “{u.name}”.
          {u.suggestions.length > 0 && ' Did you mean '}
          {u.suggestions.map((s, i) => (
            <span key={s}>
              {i > 0 && ', '}
              {onReplace ? (
                <button type="button" className="underline hover:text-ink" onClick={() => onReplace(u.name, s)}>
                  {s}
                </button>
              ) : (
                s
              )}
            </span>
          ))}
          {u.suggestions.length > 0 && '?'}
        </li>
      ))}
    </ul>
  )
}

function DeckEditor({
  id,
  taken,
  onSaved,
  onDeleted,
  onPlay,
  onInspect,
}: {
  id: string
  taken: string[]
  onSaved: (id: string) => void
  onDeleted: () => void
  onPlay: () => void
  onInspect: (card: CardData) => void
}) {
  const [deck, setDeck] = useState<Deck>()
  const [name, setName] = useState('')
  const [cards, setCards] = useState<DeckEntry[]>([])
  const [adding, setAdding] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; unknown?: ApiError['body']['unknown'] }>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copyName, setCopyName] = useState<string>()

  const load = (d: Deck) => {
    setDeck(d)
    setName(d.name)
    setCards([...d.main, ...d.extra].map(({ name, count }) => ({ name, count })))
  }
  useEffect(() => {
    api.deck(id).then(load, (e: Error) => setError({ message: e.message }))
  }, [id])

  const dirty = !!deck && (name !== deck.name || JSON.stringify(cards) !== JSON.stringify([...deck.main, ...deck.extra].map(({ name, count }) => ({ name, count }))))
  const withData = cards.map((c) => ({ ...c, data: cardDb.byName(c.name) }))
  const main = withData.filter((c) => !c.data || !isExtraDeckCard(c.data))
  const extra = withData.filter((c) => c.data && isExtraDeckCard(c.data))
  const count = (list: typeof withData) => list.reduce((n, c) => n + c.count, 0)

  const setCount = (cardName: string, n: number) =>
    setCards((cs) => (n <= 0 ? cs.filter((c) => c.name !== cardName) : cs.map((c) => (c.name === cardName ? { ...c, count: Math.min(n, MAX_COPIES) } : c))))
  const add = (raw: string) => {
    const cardName = cardDb.byName(raw)?.name ?? raw.trim()
    if (!cardName) return
    setCards((cs) =>
      cs.some((c) => c.name === cardName)
        ? cs.map((c) => (c.name === cardName ? { ...c, count: Math.min(c.count + 1, MAX_COPIES) } : c))
        : [...cs, { name: cardName, count: 1 }],
    )
    setAdding('')
  }

  const save = async (asNew?: string) => {
    setSaving(true)
    setError(undefined)
    try {
      const target = asNew ? slug(asNew) : id
      if (asNew && taken.includes(target)) throw new Error(`There's already a deck called "${target}"`)
      await api.saveDeck({ id: target, name: asNew ?? name, cards, overwrite: !asNew })
      setCopyName(undefined)
      onSaved(target)
      if (!asNew) load(await api.deck(id))
    } catch (e) {
      setError({ message: (e as Error).message, unknown: e instanceof ApiError ? e.body.unknown : undefined })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.deleteDeck(id)
      onDeleted()
    } catch (e) {
      setError({ message: (e as Error).message })
    }
  }

  if (!deck) return error ? <p className="text-sm text-danger">{error.message}</p> : <p className="text-sm text-muted">Loading…</p>
  const inUse = deck.usedBy.length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Deck name" className="min-w-0 flex-1 px-2 py-1.5 font-display text-lg font-semibold" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn" disabled={saving} onClick={() => setCopyName(copyName === undefined ? `${name} (copy)` : undefined)}>
          Save as new…
        </button>
        <button type="button" className="btn flex items-center gap-1" onClick={onPlay} disabled={dirty} title={dirty ? 'Save first' : 'Start a game with this deck'}>
          <Play size={14} aria-hidden /> Play
        </button>
        <button
          type="button"
          className="btn px-2"
          aria-label="Delete deck"
          disabled={inUse}
          title={inUse ? `Used by ${deck.usedBy.join(', ')}` : 'Delete this deck'}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {copyName !== undefined && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save(copyName)
          }}
        >
          <input aria-label="New deck name" className="min-w-0 flex-1 px-2 py-1 text-sm" value={copyName} onChange={(e) => setCopyName(e.target.value)} autoFocus />
          <span className="text-xs text-muted">decks/{slug(copyName) || '…'}.json</span>
          <button type="submit" className="btn btn-primary" disabled={!slug(copyName) || saving}>
            Save copy
          </button>
        </form>
      )}
      {confirmDelete && (
        <p className="flex items-center gap-2 text-sm">
          Delete decks/{id}.json?
          <button type="button" className="btn btn-primary" onClick={() => void remove()}>
            Delete
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </p>
      )}
      {inUse && dirty && (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {deck.usedBy.join(', ')} {deck.usedBy.length === 1 ? 'uses' : 'use'} this deck, and changing its cards can break their steps. <strong>Save as new…</strong>{' '}
          keeps them working. Your games keep their own copy of the list either way.
        </p>
      )}
      {error &&
        (error.unknown?.length ? (
          <Unknown unknown={error.unknown} onReplace={(from, to) => setCards((cs) => cs.map((c) => (c.name === from ? { ...c, name: to } : c)))} />
        ) : (
          <p className="text-sm text-danger">{error.message}</p>
        ))}
      {deck.warnings.length > 0 && !dirty && (
        <ul className="text-xs text-warn">
          {deck.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add(adding)
        }}
      >
        <input
          aria-label="Add a card"
          list="deck-hub-cards"
          className="min-w-0 flex-1 px-2 py-1.5 text-sm"
          placeholder="Add a card by name…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!adding.trim()}>
          Add
        </button>
        <CardNames />
      </form>

      <Section title="Main Deck" total={count(main)} cards={main} onCount={setCount} onInspect={onInspect} />
      <Section title="Extra Deck" total={count(extra)} cards={extra} onCount={setCount} onInspect={onInspect} />
      <DeckCosmetics deck={id} />
    </div>
  )
}

// Every card name we have data for, for the add box's autocomplete. Names
// that aren't here are fetched from YGOPRODeck when the deck is saved.
function CardNames() {
  const names = useMemo(() => [...new Set(cardDb.all().map((c) => c.name))].sort(), [])
  return (
    <datalist id="deck-hub-cards">
      {names.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  )
}

type Row = DeckEntry & { data?: ReturnType<typeof cardDb.byName> }

function Section({
  title,
  total,
  cards,
  onCount,
  onInspect,
}: {
  title: string
  total: number
  cards: Row[]
  onCount: (name: string, n: number) => void
  onInspect: (card: CardData) => void
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-muted">
        {title} <span className="text-ink">{total}</span>
      </h3>
      {cards.length === 0 ? (
        <p className="text-sm text-faint">None</p>
      ) : (
        <Tooltip.Provider delayDuration={300}>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
            {cards.map((c) => (
              <li key={c.name} className="space-y-1">
                <div className="relative">
                  {c.data ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button type="button" className="block w-full transition hover:scale-105" onClick={() => c.data && onInspect(c.data)}>
                          <img src={imagePath(c.data.id)} alt={c.name} className="aspect-[59/86] w-full rounded object-cover" loading="lazy" />
                        </button>
                      </Tooltip.Trigger>
                      {/* Not portalled: the body sits under this modal dialog. */}
                      <Tooltip.Content side="top" sideOffset={6} className="panel z-50 pointer-coarse:hidden px-2 py-1 font-display text-xs font-semibold text-ink">
                        {c.name}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  ) : (
                    <div
                      className="grid aspect-[59/86] w-full place-items-center rounded border border-dashed border-line p-2 text-center text-xs text-muted"
                      title="Fetched from YGOPRODeck when you save"
                    >
                      {c.name}
                    </div>
                  )}
                  <span className="absolute right-1 top-1 rounded bg-bg/85 px-1.5 text-sm font-bold text-gold">×{c.count}</span>
                </div>
                <p className="truncate text-xs" title={c.name}>
                  {c.name}
                </p>
                <div className="flex items-center justify-between">
                  <button type="button" className="btn px-1.5 py-0.5" aria-label={`One fewer ${c.name}`} onClick={() => onCount(c.name, c.count - 1)}>
                    <Minus size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn px-1.5 py-0.5"
                    aria-label={`One more ${c.name}`}
                    disabled={c.count >= MAX_COPIES}
                    onClick={() => onCount(c.name, c.count + 1)}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Tooltip.Provider>
      )}
    </section>
  )
}

function NewDeck({ taken, onCreated }: { taken: string[]; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [list, setList] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; unknown?: ApiError['body']['unknown'] }>()
  const id = slug(name)

  const create = async () => {
    setSaving(true)
    setError(undefined)
    try {
      await api.saveDeck({ id, name, list })
      onCreated(id)
    } catch (e) {
      setError({ message: (e as Error).message, unknown: e instanceof ApiError ? e.body.unknown : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <h3 className="font-display text-lg font-semibold">New deck</h3>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Name</span>
        <input className="w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue-Eyes" />
        {id && <span className="text-xs text-muted">Saved as decks/{id}.json</span>}
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Decklist, one card per line (“3 Ash Blossom & Joyous Spring”). Extra Deck cards are sorted out for you.</span>
        <textarea className="h-72 w-full px-2 py-1.5 font-mono text-xs" value={list} onChange={(e) => setList(e.target.value)} />
      </label>
      {error &&
        (error.unknown?.length ? (
          <Unknown unknown={error.unknown} onReplace={(from, to) => setList((l) => l.replace(from, to))} />
        ) : (
          <p className="text-sm text-danger">{error.message}</p>
        ))}
      {taken.includes(id) && <p className="text-sm text-warn">There's already a deck called {id}.</p>}
      <button type="submit" className="btn btn-primary" disabled={!id || !list.trim() || taken.includes(id) || saving}>
        {saving ? 'Creating…' : 'Create deck'}
      </button>
    </form>
  )
}
