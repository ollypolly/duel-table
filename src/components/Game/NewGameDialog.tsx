// Start a game on the rules engine: your deck against the bot's, or
// against Claude's when the server has a Claude login. Claude plays as the
// anime character its deck belongs to, picked at random by default. Or a
// lesson, where Claude runs the duel to teach you what you ask. Any of them
// can start from a scenario's setup instead of opening hands.
import { useEffect, useRef, useState } from 'react'
import { api, type ClaudeStatus } from '../../api/client'
import type { ModelChoice } from '../../api/game'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import type { DeckFile, ScenarioFile } from '../../scenarios/schema'

const decks = Object.entries(rawDecks).map(([id, raw]) => ({ id, name: (raw as { name?: string }).name ?? id, character: (raw as DeckFile).character?.name }))
const characterDecks = decks.filter((d) => d.character)
const RANDOM = 'random-character'
const positions = Object.values(rawScenarios as Record<string, ScenarioFile>).filter((s) => s.setup)
const OPENING = 'opening-hands'

export function NewGameDialog({ open, deck: initialDeck, onClose, onStarted }: { open: boolean; deck?: string; onClose: () => void; onStarted: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [deck, setDeck] = useState(initialDeck ?? decks[0]?.id ?? '')
  const [opponentDeck, setOpponentDeck] = useState(characterDecks.length ? RANDOM : (decks[1]?.id ?? decks[0]?.id ?? ''))
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState<ClaudeStatus>()
  const [mode, setMode] = useState<'bot' | 'claude' | 'lesson'>('bot')
  const [topic, setTopic] = useState('')
  const [model, setModel] = useState<ModelChoice>('opus')
  const [coach, setCoach] = useState(true)
  const [from, setFrom] = useState(OPENING)
  useEffect(() => {
    if (!open) return
    ref.current?.showModal()
    let live = true
    void api.claude().then((s) => {
      if (!live) return
      setStatus(s)
      if (!s.available) setMode('bot')
    })
    return () => {
      live = false
    }
  }, [open])
  const claude = mode !== 'bot' && status?.available
  const lesson = claude && mode === 'lesson'

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const theirs = opponentDeck === RANDOM ? characterDecks[Math.floor(Math.random() * characterDecks.length)].id : opponentDeck
      const opts = from === OPENING ? { deck, opponentDeck: theirs } : { scenario: from }
      const s = await api.createGame({ ...opts, ...(lesson ? { lesson: true, topic, model } : claude && { claude: 'p2' as const, model, coach }) })
      ref.current?.close()
      onStarted(s.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const pick = (label: string, value: string, set: (v: string) => void, random = false) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <select aria-label={label} className="px-2 py-1" value={value} onChange={(e) => set(e.target.value)}>
        {random && characterDecks.length > 0 && <option value={RANDOM}>Random character</option>}
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
      className="panel m-auto max-h-[calc(var(--safe-h)-2rem)] w-[min(26rem,94vw)] p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md"
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
              <input type="radio" name="opponent" checked={!claude} onChange={() => setMode('bot')} className="mt-1" />
              <span>
                Bot <span className="block text-xs text-muted">Makes random legal moves. Free and instant.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${status?.available ? '' : 'opacity-60'}`}>
              <input type="radio" name="opponent" checked={!!claude && !lesson} disabled={!status?.available} onChange={() => setMode('claude')} className="mt-1" />
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
            <label className={`flex items-start gap-2 text-sm ${status?.available ? '' : 'opacity-60'}`}>
              <input type="radio" name="opponent" checked={!!lesson} disabled={!status?.available} onChange={() => setMode('lesson')} className="mt-1" />
              <span>
                Lesson with Claude
                <span className="block text-xs text-muted">Claude plays both sides to show you combos and lines, then hands you a side to try them.</span>
              </span>
            </label>
          </fieldset>
          {lesson && (
            <label className="block space-y-1 text-sm">
              <span>What do you want to learn?</span>
              <textarea
                aria-label="What do you want to learn?"
                className="w-full px-2 py-1"
                rows={3}
                placeholder="Teach me this deck's main combo"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
          )}
          {positions.length > 0 && (
            <label className="flex items-center justify-between gap-3 text-sm">
              Start from
              <select aria-label="Start from" className="min-w-0 px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value={OPENING}>Opening hands</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {from === OPENING && (
            <>
              {pick(lesson ? 'Deck to learn' : 'Your deck', deck, setDeck)}
              {pick(lesson ? "Opponent's deck" : claude ? "Claude's deck" : "Bot's deck", opponentDeck, setOpponentDeck, true)}
            </>
          )}
          {claude && (
            <>
              <label className="flex items-center justify-between gap-3 text-sm">
                Model
                <select aria-label="Model" className="px-2 py-1" value={model} onChange={(e) => setModel(e.target.value as ModelChoice)}>
                  <option value="opus">Opus (strongest)</option>
                  <option value="sonnet">Sonnet (faster, lighter on usage)</option>
                </select>
              </label>
              {!lesson && (
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Coach me <span className="block text-xs text-muted">Claude points out misplays and explains its own.</span>
                  </span>
                  <input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} />
                </label>
              )}
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
            <button type="submit" className="btn btn-primary" disabled={starting || (from === OPENING && !deck)}>
              {starting ? 'Starting…' : 'Start'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
