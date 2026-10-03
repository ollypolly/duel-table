// A game on the rules engine, in the scene panel: what it's asking you, as
// buttons, with the cards involved lit up on the board. Clicking a lit card
// narrows the options to it (or picks it, when picking cards is the question).
import { Check, Lightbulb, MoreHorizontal, Search, Swords, TriangleAlert, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { PICK_KINDS, RESPOND_LEVELS, type GamePrompt, type GameView, type Respond } from '../../api/game'
import { cardDb } from '../../data/cards'
import type { BoardState, Iid } from '../../engine'
import { cardFace, VIEWER } from '../../view/boardView'
import { CardText } from '../CardLink/CardLink'
import { Menu, MenuItem, MenuLabel } from '../Menu/Menu'

export type GameChoice = {
  focused?: Iid // single-choice prompts: the card whose options are shown
  picked: number[] // multi-choice prompts
}

type Props = {
  game: GameView
  state: BoardState
  choice: GameChoice
  onChoice: (c: GameChoice) => void
  onAnswer: (choices: number[]) => void
  onRematch?: () => void // once it's over
  onReview?: () => void // go through the finished game with Claude
  onAttempt?: (tries: number) => void // a game you lost: Claude plays your side to see if it could be won
  onHint?: () => void // ask Claude, showing it your cards
  onUndo?: () => void // take back your last move (against a friend: ask to)
  onTakeback?: (accept: boolean) => void // against a friend: agree to their take-back, or not
  lesson?: boolean // a lesson: take-backs aren't counted, and the button sits by the question
  onForfeit?: () => void // give the game up
  onFreePlay?: () => void // rules off: this board on a free-play table
  onRespond?: (level: Respond) => void // change when you're asked to respond
  onReopen?: (at: number) => void // be asked a passed chance after all
  claudeOn?: boolean // the levels that ask Claude can be picked
  normalUsed?: boolean // this turn's Normal Summon or Set has gone
  onHover?: (option?: number) => void // the pointer is over an option that is a zone, to show which
  busy: boolean
}

export function GamePanel({ game, state, choice, onChoice, onAnswer, onRematch, onReview, onAttempt, onHint, onUndo, onTakeback, lesson, onForfeit, onFreePlay, onRespond, onReopen, claudeOn, normalUsed, onHover, busy }: Props) {
  const [forfeiting, setForfeiting] = useState(false)
  const [trying, setTrying] = useState(false)
  const name = (iid: Iid) => {
    // Your own cards are named even in your decks: an Extra Deck summon, or a search.
    const f = cardFace(state, iid, cardDb)
    return f.visible || f.owner === VIEWER ? f.name : 'Face-down card'
  }
  const { prompt, winner, waitingFor } = game
  // Against a friend, a take-back is asked for rather than counted.
  const friend = !!game.seats
  const canUndo = onUndo && (friend ? !game.takeback || game.takeback.refused : !!game.undos)
  const them = state.players.p2.name
  const undo = canUndo && (
    <button type="button" className="btn flex items-center gap-1.5 text-xs" disabled={busy} onClick={onUndo} title="Go back to before your last move">
      <Undo2 size={14} aria-hidden />
      {lesson ? 'Take back' : `Take back (${game.undos} left)`}
    </button>
  )

  if (winner) {
    const tried = game.claude?.attempt
    const who = tried ? (winner.player === 'p1' ? 'Claude won it' : 'Claude lost too') : winner.player === 'p1' ? 'You win!' : `${state.players[winner.player].name} wins`
    if (trying && onAttempt)
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Claude plays your side from the same opening hand, against the same bot. How many tries?</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={() => setTrying(false)}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => onAttempt(1)}>
              One try
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onAttempt(3)}>
              Up to three
            </button>
          </div>
        </div>
      )
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-lg font-semibold text-gold">{who}</p>
        <div className="flex flex-wrap items-center gap-2">
          {undo}
          {onReview && (
            <button type="button" className="btn flex items-center gap-1.5" onClick={onReview} title="Go through this game with Claude">
              <Search size={14} className="text-gold" aria-hidden />
              Review
            </button>
          )}
          {onAttempt && !tried && (
            <button type="button" className="btn flex items-center gap-1.5" onClick={() => setTrying(true)} title="Claude plays your side from the same opening, to see if it could be won, then teaches you how">
              <Swords size={14} className="text-gold" aria-hidden />
              Can Claude win it?
            </button>
          )}
          {onAttempt && tried && (
            <button type="button" className="btn btn-primary flex items-center gap-1.5" onClick={() => onAttempt(1)} title="Claude plays it again from the same opening, with what it learned from this try">
              <Swords size={14} aria-hidden />
              Go again
            </button>
          )}
          {onRematch && (
            <button type="button" className="btn btn-primary" onClick={onRematch}>
              Rematch
            </button>
          )}
        </div>
      </div>
    )
  }
  // What you rarely need mid-game, in a menu; giving up asks first.
  const more = forfeiting ? (
    <span className="flex items-center gap-1.5 text-xs">
      Give up this game?
      <button
        type="button"
        className="btn text-xs text-danger"
        disabled={busy}
        onClick={() => {
          setForfeiting(false)
          onForfeit?.()
        }}
      >
        Forfeit
      </button>
      <button type="button" className="btn text-xs" onClick={() => setForfeiting(false)}>
        Keep playing
      </button>
    </span>
  ) : (
    lesson ? undo : (onForfeit || onFreePlay || canUndo || (onRespond && game.respond)) && (
      <Menu label={<MoreHorizontal size={14} />} title="More" side="top" className="btn text-xs">
        {onRespond && game.respond && (
          <>
            <MenuLabel>Ask me to respond</MenuLabel>
            {RESPOND_LEVELS.filter(([l]) => claudeOn || (l !== 'advise' && l !== 'claude')).map(([level, label, about]) => (
              <MenuItem key={level} role="menuitemradio" aria-checked={game.respond === level} title={about} onClick={() => onRespond(level)}>
                <span className="flex items-center gap-2">
                  <Check size={14} className={game.respond === level ? 'text-gold' : 'invisible'} aria-hidden />
                  {label}
                </span>
              </MenuItem>
            ))}
          </>
        )}
        {canUndo && (
          <MenuItem disabled={busy} onClick={onUndo} title={friend ? `Ask ${them} to let you go back to before your last move` : 'Go back to before your last move'}>
            {friend ? 'Ask to take back' : `Take back (${game.undos} left)`}
          </MenuItem>
        )}
        {onFreePlay && (
          <MenuItem disabled={busy} onClick={onFreePlay} title="This board on a free-play table, where anything can be moved. Rules on there carries it back into a game. This game stays as it is">
            Rules off (free play from here)
          </MenuItem>
        )}
        {onForfeit && (
          <MenuItem danger onClick={() => setForfeiting(true)}>
            Forfeit
          </MenuItem>
        )}
      </Menu>
    )
  )
  // The latest chance to respond that was passed for you, with a way back to it.
  // It goes once the turn has moved on.
  const last = game.skipped?.findLast((s) => s.turn === undefined || s.turn === state.turn)
  const passed = last && (
    <div className="flex items-start justify-between gap-2 rounded-md border border-line bg-raised/50 px-2 py-1.5 text-xs text-muted" data-testid="passed">
      <p className="min-w-0">
        <span className="text-ink">{last.by === 'claude' ? 'Claude passed for you' : 'Passed for you'}</span>
        {last.to ? ` on ${last.to}` : ''}: you could have used <CardText>{last.cards.join(', ')}</CardText>
        {last.why ? `. ${last.by === 'claude' ? last.why : `Skipped as ${last.why}.`}` : '.'}
      </p>
      {onReopen && (
        <button type="button" className="btn shrink-0 text-xs" disabled={busy} onClick={() => onReopen(last.at)} title="Go back to that moment and decide yourself">
          Ask me
        </button>
      )}
    </div>
  )
  // Against a friend: a take-back either of you asked for, and whether they have the game open.
  const takeback = game.takeback && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gold/40 bg-gold/10 px-2 py-1.5 text-sm" data-testid="takeback">
      {game.takeback.by === VIEWER ? (
        <p>{game.takeback.refused ? `${them} said no to the take-back.` : `Asked ${them} to let you take back your last move…`}</p>
      ) : game.takeback.refused ? (
        <p>You said no to {them}’s take-back.</p>
      ) : (
        <>
          <p>{them} asks to take back their last move.</p>
          {onTakeback && (
            <span className="flex gap-2">
              <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => onTakeback(true)}>
                Let them
              </button>
              <button type="button" className="btn text-xs" disabled={busy} onClick={() => onTakeback(false)}>
                No
              </button>
            </span>
          )}
        </>
      )}
    </div>
  )
  const away = friend && game.present && !game.present.includes('p2') && <p className="text-xs text-faint">{them} is away. They’ll see your move when they’re back.</p>
  if (!prompt) {
    return (
      <div className="space-y-2">
        {takeback}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {game.deciding ? 'Claude is weighing a response for you…' : waitingFor === VIEWER ? (lesson ? 'Claude is playing your side…' : 'Working out your side…') : waitingFor ? `${state.players[waitingFor].name} is thinking…` : 'Waiting for the rules engine…'}
          </p>
          {more}
        </div>
        {away}
      </div>
    )
  }

  const multi = prompt.max > 1
  const how = multi && PICK_KINDS.includes(prompt.kind) && (prompt.min === prompt.max ? `pick ${prompt.max}` : `pick ${prompt.min} to ${prompt.max}`)
  const indexed = prompt.options.map((o, i) => ({ ...o, i }))
  const withCard = indexed.filter((o) => o.card && state.cards[o.card])
  const general = indexed.filter((o) => !o.card || !state.cards[o.card])

  return (
    <div className="space-y-2.5" role="region" aria-label="Your move" data-testid="game-prompt">
      {takeback}
      {/* Which effect is asking, then what it's asking. A pick that costs you the cards is marked. */}
      <div>
        {prompt.source && (
          <p className="text-xs text-accent">
            {prompt.source.when === 'activating' ? 'To activate ' : 'Effect of '}
            <span className="font-semibold">{prompt.source.name}</span>
          </p>
        )}
        <p className={`flex items-start gap-1.5 text-sm font-semibold ${prompt.costly ? 'text-warn' : 'text-ink'}`}>
          {prompt.costly && <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />}
          {prompt.message}
          {how && <span className="font-normal text-muted">({how})</span>}
        </p>
        {prompt.costly && <p className="text-xs text-warn/80">You lose what you pick.</p>}
        {prompt.kind === 'idle' && normalUsed !== undefined && (
          <p className="text-xs text-muted" data-testid="normal-summon">
            Normal Summon or Set: {normalUsed ? 'used this turn' : <span className="text-ink">still to use</span>}
          </p>
        )}
        {prompt.advice && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-gold-soft" data-testid="advice">
            <Lightbulb size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <CardText>{prompt.advice}</CardText>
            </span>
          </p>
        )}
      </div>
      {multi ? (
        <MultiPick prompt={prompt} onHover={onHover} picked={choice.picked} onChange={(picked) => onChoice({ ...choice, picked })} onConfirm={() => onAnswer(choice.picked)} busy={busy} />
      ) : choice.focused && withCard.some((o) => o.card === choice.focused) ? (
        <div className="space-y-1.5">
          <p className="text-xs text-accent">{name(choice.focused)}</p>
          <div className="flex flex-wrap gap-1.5">
            {withCard
              .filter((o) => o.card === choice.focused)
              .map((o) => (
                <button key={o.i} type="button" className="btn btn-primary" disabled={busy} onClick={() => onAnswer([o.i])}>
                  {o.label}
                </button>
              ))}
            <button type="button" className="btn" onClick={() => onChoice({ ...choice, focused: undefined })}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <SingleChoice prompt={prompt} onHover={onHover} withCard={withCard} general={general} name={name} onFocus={(focused) => onChoice({ ...choice, focused })} onAnswer={onAnswer} busy={busy} />
      )}
      {passed}
      <div className="flex flex-wrap gap-1.5 empty:hidden">
        {onHint && (
          <button type="button" className="btn flex items-center gap-1.5 text-xs" onClick={onHint} title="Claude sees your hidden cards for this question only">
            <Lightbulb size={14} className="text-gold" aria-hidden />
            Ask Claude for a hint
          </button>
        )}
        {more}
      </div>
    </div>
  )
}

// An option that is a zone shows which one on the board while the pointer (or focus) is on it.
const hover = (o: GamePrompt['options'][number], i: number, onHover?: (option?: number) => void) =>
  o.zone && onHover ? { onMouseEnter: () => onHover(i), onMouseLeave: () => onHover(), onFocus: () => onHover(i), onBlur: () => onHover() } : {}

type Indexed = GamePrompt['options'][number] & { i: number }

function SingleChoice({ prompt, withCard, general, name, onFocus, onAnswer, onHover, busy }: {
  onHover?: (option?: number) => void
  prompt: GamePrompt
  withCard: Indexed[]
  general: Indexed[]
  name: (iid: Iid) => string
  onFocus: (iid: Iid) => void
  onAnswer: (choices: number[]) => void
  busy: boolean
}) {
  const [filter, setFilter] = useState('')
  const pickKind = PICK_KINDS.includes(prompt.kind)
  // Cards with several things to do get a row; picking a card is one button.
  const byCard = new Map<Iid, Indexed[]>()
  for (const o of withCard) byCard.set(o.card!, [...(byCard.get(o.card!) ?? []), o])
  const shown = general.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="space-y-2">
      {byCard.size > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {[...byCard].map(([iid, opts]) =>
            pickKind || opts.length === 1 ? (
              opts.map((o) => (
                <li key={o.i}>
                  <button type="button" className="btn w-full text-left" disabled={busy} onClick={() => onAnswer([o.i])}>
                    {pickKind ? o.label : `${name(iid)}: ${o.label}`}
                  </button>
                </li>
              ))
            ) : (
              <li key={iid}>
                <button type="button" className="btn w-full text-left" onClick={() => onFocus(iid)}>
                  {name(iid)} <span className="text-xs text-muted">· {opts.length} options</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {general.length > 10 && (
        <input aria-label="Filter options" className="w-full px-2 py-1 text-sm" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {shown.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${general.length > 10 ? 'max-h-64 overflow-y-auto' : ''}`}>
          {shown.map((o) => (
            <button key={o.i} type="button" className={`btn ${o.group === 'Pass' || o.group === 'Phase' ? '' : 'btn-primary'}`} disabled={busy} onClick={() => onAnswer([o.i])} {...hover(o, o.i, onHover)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MultiPick({ prompt, picked, onChange, onConfirm, onHover, busy }: {
  onHover?: (option?: number) => void
  prompt: GamePrompt
  picked: number[]
  onChange: (picked: number[]) => void
  onConfirm: () => void
  busy: boolean
}) {
  const { min, max } = prompt
  const ok = picked.length >= min && picked.length <= max
  return (
    <div className="space-y-2">
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {prompt.options.map((o, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-raised" {...hover(o, i, onHover)}>
              <input type="checkbox" checked={picked.includes(i)} onChange={(e) => onChange(e.target.checked ? [...picked, i] : picked.filter((p) => p !== i))} />
              {o.label}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={!ok || busy} onClick={onConfirm}>
          Confirm
        </button>
        <span className="text-xs text-muted">
          {picked.length} picked · {min === max ? min : `${min}–${max}`}
        </span>
      </div>
    </div>
  )
}
