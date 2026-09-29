// Start a game on the rules engine: your deck against the bot's, or
// against Claude's when the server has a Claude login.
import { useEffect, useRef, useState } from 'react'
import { api, type ClaudeStatus } from '../../api/client'
import type { ModelChoice } from '../../api/game'
import { rawDecks } from '../../scenarios/load'

const decks = Object.entries(rawDecks).map(([id, raw]) => ({ id, name: (raw as { name?: string }).name ?? id }))

export function NewGameDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [deck, setDeck] = useState(decks[0]?.id ?? '')
  const [opponentDeck, setOpponentDeck] = useState(decks[1]?.id ?? decks[0]?.id ?? '')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState<ClaudeStatus>()
  const [vsClaude, setVsClaude] = useState(false)
  const [model, setModel] = useState<ModelChoice>('opus')
  const [coach, setCoach] = useState(true)
  useEffect(() => {
    if (!open) return
    ref.current?.showModal()
    let live = true
    void api.claude().then((s) => {
      if (!live) return
      setStatus(s)
      setVsClaude((v) => v && s.available)
    })
    return () => {
      live = false
    }
  }, [open])
  const claude = vsClaude && status?.available

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const s = await api.createGame({ deck, opponentDeck, ...(claude && { claude: 'p2' as const, model, coach }) })
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
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm">Opponent</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="opponent" checked={!claude} onChange={() => setVsClaude(false)} className="mt-1" />
              <span>
                Bot <span className="block text-xs text-muted">Makes random legal moves. Free and instant.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${status?.available ? '' : 'opacity-60'}`}>
              <input type="radio" name="opponent" checked={!!claude} disabled={!status?.available} onChange={() => setVsClaude(true)} className="mt-1" />
              <span>
                Claude
                <span className="block text-xs text-muted">
                  {!status
                    ? 'Checking for a Claude login…'
                    : status.available
                      ? `Plays to win, chats, and can coach you. Uses your Claude plan${status.email ? ` (${status.email})` : ''}.`
                      : 'Log in to Claude Code on this machine (run `claude`) to play Claude.'}
                </span>
              </span>
            </label>
          </fieldset>
          {pick('Your deck', deck, setDeck)}
          {pick(claude ? "Claude's deck" : "Bot's deck", opponentDeck, setOpponentDeck)}
          {claude && (
            <>
              <label className="flex items-center justify-between gap-3 text-sm">
                Model
                <select aria-label="Model" className="px-2 py-1" value={model} onChange={(e) => setModel(e.target.value as ModelChoice)}>
                  <option value="opus">Opus (strongest)</option>
                  <option value="sonnet">Sonnet (faster, lighter on usage)</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Coach me <span className="block text-xs text-muted">Claude points out misplays and explains its own.</span>
                </span>
                <input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} />
              </label>
            </>
          )}
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
