// Free-play tools. Drag a card onto a zone to move it. Clicking a card opens
// it with its actions (including "Move…", then click a zone); the table
// and card tools are two rows under the header.
import { useState } from 'react'
import { isMaterial } from '../../branches/branches'
import { cardDb } from '../../data/cards'
import { getCard, locate, PLAYERS, type Iid, type SummonMethod } from '../../engine'
import type { FreePlay } from '../../hooks/useFreePlay'
import { useUiStore } from '../../store/uiStore'
import { cardFace } from '../../view/boardView'

const EXTRA = new Set(['fusion', 'synchro', 'xyz', 'link', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum'])
const SUMMONS: SummonMethod[] = ['normal', 'tribute', 'flip', 'special', 'fusion', 'synchro', 'xyz', 'link', 'ritual']

// What you can do with a card, shown in the inspector. onDone closes it.
export function CardActions({ fp, iid, onDone }: { fp: FreePlay; iid: Iid; onDone: () => void }) {
  const { state, act, select } = fp
  const card = getCard(state, iid)
  const loc = locate(state, iid)
  const zone = loc && 'zone' in loc ? loc.zone.zone : undefined
  const onMonsterZone = zone === 'monster' || zone === 'extraMonster'
  const run = (ok: boolean) => ok && onDone()
  return (
    <div className="flex flex-wrap gap-2" data-testid="card-actions">
      <button
        type="button"
        className="btn btn-primary"
        title="Or drag the card onto a zone"
        onClick={() => {
          select(iid)
          onDone()
        }}
      >
        Move…
      </button>
      {zone !== 'hand' && (
        <button type="button" className="btn" onClick={() => run(act({ type: 'move', card: iid, to: { player: card.owner, zone: 'hand' } }))}>
          To hand
        </button>
      )}
      {zone !== 'deck' && zone !== 'extraDeck' && (
        <button
          type="button"
          className="btn"
          title="Put it back in its owner's Deck (or Extra Deck) and shuffle"
          onClick={() => {
            const extra = EXTRA.has(card.cardId !== undefined ? (cardDb.byId(card.cardId)?.frameType ?? '') : '')
            const ok = act({ type: 'move', card: iid, to: { player: card.owner, zone: extra ? 'extraDeck' : 'deck' } })
            if (ok && !extra) act({ type: 'shuffle', player: card.owner, zone: 'deck' })
            run(ok)
          }}
        >
          Back to Deck
        </button>
      )}
      {iid.includes('-added-') && (
        <button type="button" className="btn" title="Take this added card off the table" onClick={() => run(act({ type: 'remove', card: iid }))}>
          Remove
        </button>
      )}
      {zone && zone !== 'hand' && (
        <button type="button" className="btn" onClick={() => run(act({ type: 'flip', card: iid }))}>
          Flip {card.faceUp ? 'face-down' : 'face-up'}
        </button>
      )}
      {onMonsterZone && (
        <button type="button" className="btn" onClick={() => run(act({ type: 'position', card: iid, position: card.position === 'atk' ? 'def' : 'atk' }))}>
          To {card.position === 'atk' ? 'Defense' : 'Attack'}
        </button>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => {
          select(iid)
          fp.setAttaching(true)
          onDone()
        }}
      >
        Attach as material…
      </button>
      {isMaterial(state, iid) && (
        <button type="button" className="btn" onClick={() => run(act({ type: 'detach', card: iid }))}>
          Detach
        </button>
      )}
    </div>
  )
}

// While a card is being moved: where it's going and how, and why the last
// move failed.
export function FreePlayStatus({ fp }: { fp: FreePlay }) {
  const { state, selected } = fp
  if (!selected && !fp.error && !fp.warnings.length) return null
  return (
    <div className="panel space-y-1.5 px-3 py-2">
      {selected && state.cards[selected] && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="moving">
          <span className="text-accent">
            {fp.attaching ? 'Attaching' : 'Moving'} <b className="text-ink">{cardFace(state, selected, cardDb).name}</b>{fp.more.length > 0 && ` and ${fp.more.length} more ${fp.more.length === 1 ? 'copy' : 'copies'}`}: {fp.attaching ? 'click the Xyz monster' : 'click a zone'}
          </span>
          {!fp.attaching && (
            <span className="flex items-center gap-2 text-muted">
              <select aria-label="Summon method" className="px-1 py-0.5" value={fp.summon} onChange={(e) => fp.setSummon(e.target.value as SummonMethod | '')}>
                <option value="">not a summon</option>
                {SUMMONS.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)} Summon
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={fp.faceDown} onChange={(e) => fp.setFaceDown(e.target.checked)} /> face-down
              </label>
            </span>
          )}
          <button type="button" className="btn" onClick={fp.cancel} title="Esc">
            Cancel
          </button>
        </div>
      )}
      {fp.error && (
        <p role="alert" className="text-xs text-danger">
          Can't do that: {fp.error}
        </p>
      )}
      {!fp.error && fp.warnings.length > 0 && <p className="text-xs text-warn">⚠ {fp.warnings.join(' · ')}</p>}
    </div>
  )
}

// The everyday tools, by the board: draw, deal, add any card, see both hands.
// They act for the side picked on the left.
export function FreePlayBar({ fp, onRulesOn }: { fp: FreePlay; onRulesOn?: () => void }) {
  const { state, act } = fp
  const [count, setCount] = useState(3)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [copies, setCopies] = useState(1)
  const { openHands, setOpenHands, freeSide: side, setFreeSide: setSide, boxSelect, setBoxSelect, multi } = useUiStore()
  const fresh = PLAYERS.every((p) => state.players[p].zones.hand.length === 0) && state.turn <= 1
  const q = query.trim().toLowerCase()
  // The side's Deck first, then any other card the app knows.
  const inDeck = (cardId: number) => state.players[side].zones.deck.filter((iid) => state.cards[iid].cardId === cardId)
  const found =
    q.length < 2
      ? []
      : cardDb
          .all()
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => ({ c, have: inDeck(c.id).length }))
          .sort((a, b) => b.have - a.have)
          .slice(0, 8)
  // Take that many copies from the Deck; any it doesn't have are added new.
  const add = (cardId: number) => {
    const fromDeck = inDeck(cardId).slice(0, copies)
    let ok = fromDeck.every((iid) => act({ type: 'move', card: iid, to: { player: side, zone: 'hand' } }))
    let n = Object.keys(state.cards).length
    for (let k = fromDeck.length; ok && k < copies; k++) {
      while (state.cards[`${side}-added-${n}`]) n++
      ok = act({ type: 'create', card: `${side}-added-${n++}`, cardId, owner: side, to: { player: side, zone: 'hand' } })
    }
    if (ok) {
      setQuery('')
      setAdding(false)
    }
  }
  // Everything back where it started: materials detached, every card to its
  // owner's Deck or Extra Deck, added cards taken off, Decks shuffled, LP 8000.
  const away = Object.keys(state.cards).filter((iid) => {
    const loc = locate(state, iid)
    return !(loc && 'zone' in loc && (loc.zone.zone === 'deck' || loc.zone.zone === 'extraDeck'))
  })
  const clear = () => {
    const home = (iid: Iid) => {
      const card = state.cards[iid]
      const extra = EXTRA.has(card.cardId !== undefined ? (cardDb.byId(card.cardId)?.frameType ?? '') : '')
      return { player: card.owner, zone: extra ? ('extraDeck' as const) : ('deck' as const) }
    }
    const materials = away.filter((iid) => isMaterial(state, iid))
    const rest = away.filter((iid) => !materials.includes(iid))
    fp.actAll('Clear the board', [
      ...materials.map((iid) => ({ type: 'detach' as const, card: iid, to: home(iid) })),
      ...rest.filter((iid) => !iid.includes('-added-')).map((iid) => ({ type: 'move' as const, card: iid, to: home(iid) })),
      ...away.filter((iid) => iid.includes('-added-')).map((iid) => ({ type: 'remove' as const, card: iid })),
      ...PLAYERS.flatMap((p) => [{ type: 'shuffle' as const, player: p, zone: 'deck' as const }, { type: 'lp' as const, player: p, set: 8000 }]),
    ])
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs" data-testid="free-bar">
      <span className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Act for">
        {PLAYERS.map((p) => (
          <button key={p} type="button" aria-pressed={side === p} className={`px-2 py-1 transition-colors ${side === p ? (p === 'p1' ? 'bg-p1/25 font-semibold text-p1' : 'bg-p2/25 font-semibold text-p2') : 'text-muted hover:text-ink'}`} onClick={() => setSide(p)}>
            {state.players[p].name}
          </button>
        ))}
      </span>
      {fresh && (
        <button type="button" className="btn btn-primary text-xs" onClick={() => PLAYERS.forEach((p) => act({ type: 'draw', player: p, count: 5 }))}>
          Deal hands
        </button>
      )}
      <button type="button" className="btn text-xs" onClick={() => act({ type: 'draw', player: side })}>
        Draw
      </button>
      <button type="button" className="btn text-xs" onClick={() => act({ type: 'draw', player: side, count: 5 })}>
        Draw 5
      </button>
      <span className="flex items-center gap-1">
        <button type="button" className="btn text-xs" onClick={() => act({ type: 'draw', player: side, count })}>
          Draw
        </button>
        <input aria-label="How many to draw" type="number" min={1} max={60} className="w-12 px-1 py-1" value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
      </span>
      <span className="relative">
        <button type="button" className="btn text-xs" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          Add a card
        </button>
        {adding && (
          <div className="panel absolute left-0 top-full z-30 mt-1 w-64 space-y-1 p-2">
            <input autoFocus aria-label="Card name" placeholder="Card name…" className="block w-full px-2 py-1.5 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            <label className="flex items-center gap-2 px-1 text-muted">
              Copies
              <input aria-label="Copies to add" type="number" min={1} max={3} className="w-12 px-1 py-1" value={copies} onChange={(e) => setCopies(Math.min(3, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
            {found.map(({ c, have }) => (
              <button key={c.id} type="button" className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-raised" onClick={() => add(c.id)}>
                {c.name}
                {have > 0 && <span className="ml-1.5 text-xs text-muted">{have} in Deck</span>}
              </button>
            ))}
            <p className="px-1 text-muted">{q.length < 2 ? `Goes to ${state.players[side].name}'s hand: from the Deck if it's there, added new if not.` : found.length ? '' : 'No card by that name.'}</p>
          </div>
        )}
      </span>
      <label className="flex items-center gap-1.5 px-1 text-muted" title="Show both hands face-up, to play both sides or show someone">
        <input type="checkbox" className="accent-gold" checked={openHands} onChange={(e) => setOpenHands(e.target.checked)} />
        Both hands
      </label>
      <label className="flex items-center gap-1.5 px-1 text-muted" title="Drag on the table to box cards, then drag one of them (or click a zone) to move them all. Two fingers pan, pinch zooms">
        <input type="checkbox" className="accent-gold" checked={boxSelect} onChange={(e) => setBoxSelect(e.target.checked)} />
        Select{multi.length > 0 && ` (${multi.length})`}
      </label>
      <button type="button" className="btn text-xs" disabled={!away.length} onClick={clear} title="Every card back to its Deck, shuffled, and life points back to 8000. Undo brings it back">
        Clear the board
      </button>
      {onRulesOn && (
        <button type="button" className="btn text-xs" onClick={onRulesOn} title="Play on from this board under the rules, against the simple bot: your turn, Main Phase 1. Rules off in the game's menu brings you back to move things freely">
          Rules on
        </button>
      )}
    </div>
  )
}

// The table's own controls, as a row above the card tools: shuffle, turn,
// undo and life points, for the side picked below.
export function FreePlayTable({ fp, onUndo }: { fp: FreePlay; onUndo?: () => void }) {
  const { state, act } = fp
  const [lpAmount, setLpAmount] = useState(1000)
  const side = useUiStore((s) => s.freeSide)
  const whose = side === 'p1' ? 'your' : `${state.players[side].name}'s`
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs" data-testid="free-play">
      <span className="font-display font-semibold uppercase tracking-wider text-gold">Free play</span>
      <button type="button" className="btn text-xs" onClick={() => act({ type: 'shuffle', player: side, zone: 'deck' })}>
        Shuffle {whose} Deck
      </button>
      <button type="button" className="btn text-xs" onClick={() => act({ type: 'nextTurn' })}>
        Next turn
      </button>
      <button type="button" className="btn text-xs" onClick={onUndo} disabled={!onUndo}>
        Undo
      </button>
      <span className="flex items-center gap-1 pl-2 text-muted">
        LP
        <button type="button" className="btn text-xs" aria-label={`Take ${lpAmount} from ${whose} life points`} onClick={() => act({ type: 'lp', player: side, delta: -lpAmount })}>
          −
        </button>
        <input aria-label="LP amount" type="number" min={0} step={100} className="w-16 px-1 py-1" value={lpAmount} onChange={(e) => setLpAmount(Math.max(0, Number(e.target.value)))} />
        <button type="button" className="btn text-xs" aria-label={`Add ${lpAmount} to ${whose} life points`} onClick={() => act({ type: 'lp', player: side, delta: lpAmount })}>
          +
        </button>
      </span>
    </div>
  )
}
