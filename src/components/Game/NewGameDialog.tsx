// Start a game on the rules engine. You pick who you're up against: the simple
// bot (random legal moves, any deck), the trained bot (ygo-agent, which plays
// only the decks it was trained on) or Claude (needs a Claude login), which
// plays as the anime character its deck belongs to. Against a bot, Claude sits
// beside you to be asked, when there's a login. With lesson, it's the form for
// a lesson instead, where Claude runs the duel to teach you what you ask.
// Games against the simple bot or Claude, and lessons, can start from a
// scenario's setup instead of opening hands.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type ClaudeStatus, type Opponents } from '../../api/client'
import { MODELS, type ModelChoice } from '../../api/game'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import type { DeckFile, ScenarioFile } from '../../scenarios/schema'

const decks = Object.entries(rawDecks).map(([id, raw]) => ({ id, name: (raw as { name?: string }).name ?? id, character: (raw as DeckFile).character?.name }))
const RANDOM = 'random'
const positions = Object.values(rawScenarios as Record<string, ScenarioFile>).filter((s) => s.setup)
const OPENING = 'opening-hands'
const anyOf = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]

type Opponent = 'bot' | 'trained' | 'claude'
const OPPONENTS: Record<Opponent, { name: string; about: string }> = {
  bot: { name: 'Simple bot', about: 'Makes random legal moves with any deck. Free and instant: good for trying a combo.' },
  trained: { name: 'Trained bot', about: 'A neural network that plays its own decks well. Free and quick, but it only knows the decks it was trained on.' },
  claude: { name: 'Claude', about: 'Plays to win as the character its deck belongs to, chats, and can coach you. Uses your Claude plan.' },
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-gold">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs text-muted">
      <span>{label}</span>
      {children}
    </label>
  )
}

const SELECT = 'block w-full px-2 py-1.5 text-sm'

function Toggle({ label, about, checked, onChange }: { label: string; about: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" className="mt-1 accent-gold" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        <span className="block text-xs text-muted">{about}</span>
      </span>
    </label>
  )
}

type Props = { open: boolean; deck?: string; lesson?: boolean; onClose: () => void; onStarted: (id: string) => void }

export function NewGameDialog({ open, deck: initialDeck, lesson = false, onClose, onStarted }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [deck, setDeck] = useState(initialDeck ?? decks[0]?.id ?? '')
  const [opponentDeck, setOpponentDeck] = useState(RANDOM)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState<ClaudeStatus>()
  const [bots, setBots] = useState<Opponents>()
  const [picked, setPicked] = useState<Opponent>('bot')
  const [topic, setTopic] = useState('')
  const [model, setModel] = useState<ModelChoice>('opus')
  const [coach, setCoach] = useState(true)
  const [knowsDeck, setKnowsDeck] = useState(true)
  const [from, setFrom] = useState(OPENING)
  useEffect(() => {
    if (!open) return
    ref.current?.showModal()
    let live = true
    void api.claude().then((s) => live && setStatus(s))
    void api.opponents().then((o) => live && setBots(o))
    return () => {
      live = false
    }
  }, [open])

  // Why an opponent can't be picked, if it can't.
  const unavailable: Record<Opponent, string | undefined> = {
    bot: undefined,
    trained: !bots ? 'Checking…' : bots.agent.available ? (bots.agent.decks.length ? undefined : 'None of the decks here are ones it knows.') : bots.agent.reason,
    claude: !status ? 'Checking for a Claude login…' : status.available ? undefined : 'Log in to Claude Code on this machine (run `claude`) to play Claude.',
  }
  const opponent: Opponent = unavailable[picked] ? 'bot' : picked
  const claudeOn = !!status?.available
  const claude = lesson || opponent === 'claude'
  // The decks the opponent can play; a random pick is from the characters'
  // decks, or from all of the trained bot's.
  const theirDecks = opponent === 'trained' && !lesson ? decks.filter((d) => bots!.agent.decks.includes(d.id)) : decks
  const randomFrom = opponent === 'trained' && !lesson ? theirDecks : theirDecks.filter((d) => d.character)
  const theirs = theirDecks.some((d) => d.id === opponentDeck) ? opponentDeck : randomFrom.length ? RANDOM : (theirDecks[0]?.id ?? '')
  // The trained bot only plays a whole game, from opening hands.
  const start = opponent === 'trained' && !lesson ? OPENING : from

  const begin = async () => {
    setStarting(true)
    setError('')
    try {
      const opponentDeck = theirs === RANDOM ? anyOf(randomFrom).id : theirs
      const opts = start === OPENING ? { deck, opponentDeck } : { scenario: start }
      const who = lesson
        ? { lesson: true, topic, model }
        : opponent === 'claude'
          ? { claude: 'p2' as const, model, coach }
          : { ...(opponent === 'trained' && { bot: 'agent' as const }), ...(claudeOn && { model, knowsDeck }) }
      const s = await api.createGame({ ...opts, ...who })
      ref.current?.close()
      onStarted(s.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const deckPicker = (label: string, value: string, set: (v: string) => void, list = decks, random?: string) => (
    <Field label={label}>
      <select aria-label={label} className={SELECT} value={value} onChange={(e) => set(e.target.value)}>
        {random && <option value={RANDOM}>{random}</option>}
        {list.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </Field>
  )
  const their = lesson ? "Opponent's deck" : `${OPPONENTS[opponent].name}'s deck`
  const notes = (Object.keys(OPPONENTS) as Opponent[]).filter((o) => unavailable[o])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="panel m-auto max-h-[calc(var(--safe-h)-2rem)] w-[min(28rem,94vw)] overflow-hidden p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      {open && (
        <form
          className="flex max-h-[calc(var(--safe-h)-2rem)] flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void begin()
          }}
        >
          <h2 className="border-b border-line px-5 py-3.5 font-display text-lg font-semibold">{lesson ? 'New lesson with Claude' : 'New game'}</h2>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {lesson ? (
              <Section title="Lesson">
                <p className="text-xs text-muted">
                  {!status
                    ? 'Checking for a Claude login…'
                    : status.available
                      ? 'Claude plays both sides to show you combos and lines, then hands you a side to try them.'
                      : 'Log in to Claude Code on this machine (run `claude`) for lessons with Claude.'}
                </p>
                <Field label="What do you want to learn?">
                  <textarea
                    aria-label="What do you want to learn?"
                    className="block w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink"
                    rows={3}
                    placeholder="Teach me this deck's main combo"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </Field>
              </Section>
            ) : (
              <Section title="Opponent">
                <select aria-label="Opponent" className={SELECT} value={opponent} onChange={(e) => setPicked(e.target.value as Opponent)}>
                  {(Object.keys(OPPONENTS) as Opponent[]).map((o) => (
                    <option key={o} value={o} disabled={!!unavailable[o]}>
                      {OPPONENTS[o].name}
                      {unavailable[o] ? ' (not available)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted">
                  {OPPONENTS[opponent].about}
                  {opponent === 'claude' && status?.email ? ` (${status.email})` : ''}
                </p>
                {notes.map((o) => (
                  <p key={o} className="text-xs text-faint">
                    {OPPONENTS[o].name}: {unavailable[o]}
                  </p>
                ))}
              </Section>
            )}
            <Section title="Decks">
              {start === OPENING && (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {deckPicker(lesson ? 'Deck to learn' : 'Your deck', deck, setDeck)}
                  {deckPicker(their, theirs, setOpponentDeck, theirDecks, randomFrom.length ? (opponent === 'trained' && !lesson ? 'Random' : 'Random character') : undefined)}
                </div>
              )}
              {positions.length > 0 && (opponent !== 'trained' || lesson) && (
                <Field label="Start from">
                  <select aria-label="Start from" className={SELECT} value={from} onChange={(e) => setFrom(e.target.value)}>
                    <option value={OPENING}>Opening hands</option>
                    {positions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </Section>
            {claudeOn && (
              <Section title={claude ? 'Claude' : 'Claude, beside you'}>
                {!claude && <p className="text-xs text-muted">Ask Claude what to play or why something happened as you go. It sees your side of the table, and costs nothing until you ask.</p>}
                <Field label="Model">
                  <select aria-label="Model" className={SELECT} value={model} onChange={(e) => setModel(e.target.value as ModelChoice)}>
                    {MODELS.map(([m, label]) => (
                      <option key={m} value={m}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                {!lesson && opponent === 'claude' && <Toggle label="Coach me" about="Claude points out misplays and explains its own." checked={coach} onChange={setCoach} />}
                {!claude && (
                  <Toggle
                    label="Claude knows the bot's deck"
                    about="It can look at the bot's decklist to warn you what's coming. Never its hand or face-down cards."
                    checked={knowsDeck}
                    onChange={setKnowsDeck}
                  />
                )}
              </Section>
            )}
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={starting || (start === OPENING && (!deck || !theirs)) || (lesson && !claudeOn)}>
              {starting ? 'Starting…' : lesson ? 'Start lesson' : 'Start game'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
