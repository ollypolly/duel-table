// Free-play tools. Drag a card onto a zone to move it. Clicking a card opens
// it with its actions (including "Move…", then click a zone); the table
// actions (draw, shuffle, LP…) are a menu in the header.
import { useState } from 'react'
import { isMaterial } from '../../branches/branches'
import { cardDb } from '../../data/cards'
import { getCard, locate, PLAYERS, type Iid, type Player, type SummonMethod } from '../../engine'
import type { FreePlay } from '../../hooks/useFreePlay'
import { useUiStore } from '../../store/uiStore'
import { cardFace } from '../../view/boardView'
import { Menu, MenuItem, MenuLabel } from '../Menu/Menu'

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
            {fp.attaching ? 'Attaching' : 'Moving'} <b className="text-ink">{cardFace(state, selected, cardDb).name}</b>: {fp.attaching ? 'click the Xyz monster' : 'click a zone'}
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
  const { openHands, setOpenHands, freeSide: side, setFreeSide: setSide } = useUiStore()
  const fresh = PLAYERS.every((p) => state.players[p].zones.hand.length === 0) && state.turn <= 1
  const q = query.trim().toLowerCase()
  const found = q.length < 2 ? [] : cardDb.all().filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8)
  const add = (cardId: number) => {
    let n = Object.keys(state.cards).length
    while (state.cards[`${side}-added-${n}`]) n++
    const ok = act({ type: 'create', card: `${side}-added-${n}`, cardId, owner: side, to: { player: side, zone: 'hand' } })
    if (ok) {
      setQuery('')
      setAdding(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs" data-testid="free-bar">
      <span className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Act for">
        {PLAYERS.map((p) => (
          <button key={p} type="button" aria-pressed={side === p} className={`px-2 py-1 ${side === p ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`} onClick={() => setSide(p)}>
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
            {found.map((c) => (
              <button key={c.id} type="button" className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-raised" onClick={() => add(c.id)}>
                {c.name}
              </button>
            ))}
            <p className="px-1 text-muted">{q.length < 2 ? `Goes to ${state.players[side].name}'s hand.` : found.length ? '' : 'No card by that name.'}</p>
          </div>
        )}
      </span>
      <label className="flex items-center gap-1.5 px-1 text-muted" title="Show both hands face-up, to play both sides or show someone">
        <input type="checkbox" className="accent-gold" checked={openHands} onChange={(e) => setOpenHands(e.target.checked)} />
        Both hands
      </label>
      {onRulesOn && (
        <button type="button" className="btn text-xs" onClick={onRulesOn} title="Start a game with these decks on the rules engine, against the simple bot">
          Restart with rules
        </button>
      )}
    </div>
  )
}

export function FreePlayMenu({ fp, onUndo }: { fp: FreePlay; onUndo?: () => void }) {
  const { state, act } = fp
  const [lpAmount, setLpAmount] = useState(1000)
  const who = (p: Player) => state.players[p].name

  return (
    <Menu label={<span className="font-display font-semibold text-gold">Free play</span>} title="Drag a card onto a zone to move it, or click it for more">
      <div data-testid="free-play" className="flex flex-col">
        {PLAYERS.map((p) => (
          <MenuItem key={p} onClick={() => act({ type: 'draw', player: p })}>
            {who(p)} draw{p === 'p1' ? '' : 's'}
          </MenuItem>
        ))}
        {PLAYERS.map((p) => (
          <MenuItem key={p} onClick={() => act({ type: 'shuffle', player: p, zone: 'deck' })}>
            Shuffle {who(p)}'s Deck
          </MenuItem>
        ))}
        <MenuItem onClick={() => act({ type: 'nextTurn' })}>Next turn</MenuItem>
        <MenuItem onClick={onUndo} disabled={!onUndo}>
          Undo
        </MenuItem>
        <MenuLabel>Life points</MenuLabel>
        <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted">
          Amount
          <input
            aria-label="LP amount"
            type="number"
            min={0}
            step={100}
            className="w-24 px-1 py-1"
            value={lpAmount}
            onChange={(e) => setLpAmount(Math.max(0, Number(e.target.value)))}
          />
        </label>
        {PLAYERS.map((p) => (
          <div key={p} className="flex items-center gap-1 px-1">
            <span className="flex-1 px-1.5 text-sm">{who(p)}</span>
            <MenuItem onClick={() => act({ type: 'lp', player: p, delta: -lpAmount })}>− LP</MenuItem>
            <MenuItem onClick={() => act({ type: 'lp', player: p, delta: lpAmount })}>+ LP</MenuItem>
          </div>
        ))}
      </div>
    </Menu>
  )
}
