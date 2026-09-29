// Start a game on the rules engine: your deck against the bot's.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { rawDecks } from '../../scenarios/load'

const decks = Object.entries(rawDecks).map(([id, raw]) => ({ id, name: (raw as { name?: string }).name ?? id }))

export function NewGameDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [deck, setDeck] = useState(decks[0]?.id ?? '')
  const [opponentDeck, setOpponentDeck] = useState(decks[1]?.id ?? decks[0]?.id ?? '')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    if (open) ref.current?.showModal()
  }, [open])

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const s = await api.createGame({ deck, opponentDeck })
      ref.current?.close()
      onStarted(s.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const pick = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <select aria-label={label} className="px-2 py-1" value={value} onChange={(e) => set(e.target.value)}>
        {decks.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="panel m-auto w-[min(26rem,94vw)] p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      {open && (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <h2 className="font-display text-lg font-semibold">New game</h2>
          <p className="text-xs text-muted">Played on the YGOPro rules engine against a bot that makes random legal moves.</p>
          {pick('Your deck', deck, setDeck)}
          {pick("Bot's deck", opponentDeck, setOpponentDeck)}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={starting || !deck}>
              {starting ? 'Starting…' : 'Start'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
