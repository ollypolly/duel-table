// A game on the rules engine, in the scene panel: what it's asking you, as
// buttons, with the cards involved lit up on the board. Clicking a lit card
// narrows the options to it (or picks it, when picking cards is the question).
import { Lightbulb, MoreHorizontal, Search, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { PICK_KINDS, type GamePrompt, type GameView } from '../../api/game'
import { cardDb } from '../../data/cards'
import type { BoardState, Iid } from '../../engine'
import { cardFace, VIEWER } from '../../view/boardView'
import { Menu, MenuItem } from '../Menu/Menu'

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
  onHint?: () => void // ask Claude, showing it your cards
  onUndo?: () => void // take back your last move
  onForfeit?: () => void // give the game up
  busy: boolean
}

export function GamePanel({ game, state, choice, onChoice, onAnswer, onRematch, onReview, onHint, onUndo, onForfeit, busy }: Props) {
  const [forfeiting, setForfeiting] = useState(false)
  const name = (iid: Iid) => {
    // Your own cards are named even in your decks: an Extra Deck summon, or a search.
    const f = cardFace(state, iid, cardDb)
    return f.visible || f.owner === VIEWER ? f.name : 'Face-down card'
  }
  const { prompt, winner, waitingFor } = game
  const undo = onUndo && !!game.undos && (
    <button type="button" className="btn flex items-center gap-1.5 text-xs" disabled={busy} onClick={onUndo} title="Go back to before your last move">
      <Undo2 size={14} aria-hidden />
      Take back ({game.undos} left)
    </button>
  )

  if (winner) {
    const who = winner.player === 'p1' ? 'You win!' : `${state.players[winner.player].name} wins`
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
    (onForfeit || (onUndo && !!game.undos)) && (
      <Menu label={<MoreHorizontal size={14} />} title="More" side="top" className="btn text-xs">
        {onUndo && !!game.undos && (
          <MenuItem disabled={busy} onClick={onUndo} title="Go back to before your last move">
            Take back ({game.undos} left)
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
  if (!prompt) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{waitingFor ? `${state.players[waitingFor].name} is thinking…` : 'Waiting for the rules engine…'}</p>
        {more}
      </div>
    )
  }

  const multi = prompt.max > 1
  const indexed = prompt.options.map((o, i) => ({ ...o, i }))
  const withCard = indexed.filter((o) => o.card && state.cards[o.card])
  const general = indexed.filter((o) => !o.card || !state.cards[o.card])

  return (
    <div className="space-y-2.5" role="region" aria-label="Your move" data-testid="game-prompt">
      <p className="text-sm font-semibold text-ink">{prompt.message}</p>
      {multi ? (
        <MultiPick prompt={prompt} picked={choice.picked} onChange={(picked) => onChoice({ ...choice, picked })} onConfirm={() => onAnswer(choice.picked)} busy={busy} />
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
        <SingleChoice prompt={prompt} withCard={withCard} general={general} name={name} onFocus={(focused) => onChoice({ ...choice, focused })} onAnswer={onAnswer} busy={busy} />
      )}
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

type Indexed = GamePrompt['options'][number] & { i: number }

function SingleChoice({ prompt, withCard, general, name, onFocus, onAnswer, busy }: {
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
            <button key={o.i} type="button" className={`btn ${o.group === 'Pass' || o.group === 'Phase' ? '' : 'btn-primary'}`} disabled={busy} onClick={() => onAnswer([o.i])}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MultiPick({ prompt, picked, onChange, onConfirm, busy }: {
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
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-raised">
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
