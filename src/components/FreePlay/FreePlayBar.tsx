// Free-play tools along the bottom. Card moves are click-to-select then
// click-to-place on the board; while a card is selected its own actions get a
// row here, and the table actions (draw, shuffle, LP…) sit below.
import { useState } from 'react'
import { isMaterial } from '../../branches/branches'
import { cardDb } from '../../data/cards'
import { getCard, locate, PLAYERS, type Player, type SummonMethod } from '../../engine'
import type { FreePlay } from '../../hooks/useFreePlay'
import { cardFace } from '../../view/boardView'
import { Menu, MenuItem } from '../Menu/Menu'

const SUMMONS: SummonMethod[] = ['normal', 'tribute', 'flip', 'special', 'fusion', 'synchro', 'xyz', 'link', 'ritual']

function SelectedCard({ fp, onInspect }: { fp: FreePlay; onInspect: () => void }) {
  const { state, selected, act } = fp
  if (!selected || !state.cards[selected]) return null
  const card = getCard(state, selected)
  const loc = locate(state, selected)
  const zone = loc && 'zone' in loc ? loc.zone.zone : undefined
  const onMonsterZone = zone === 'monster' || zone === 'extraMonster'
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="card-actions">
      <span className="text-accent">
        Moving <b className="text-ink">{cardFace(state, selected, cardDb).name}</b>: click a zone, or
      </span>
      <button type="button" className="btn" onClick={() => act({ type: 'move', card: selected, to: { player: card.owner, zone: 'hand' } })}>
        To hand
      </button>
      {zone && zone !== 'hand' && (
        <button type="button" className="btn" onClick={() => act({ type: 'flip', card: selected })}>
          Flip {card.faceUp ? 'face-down' : 'face-up'}
        </button>
      )}
      {onMonsterZone && (
        <button type="button" className="btn" onClick={() => act({ type: 'position', card: selected, position: card.position === 'atk' ? 'def' : 'atk' })}>
          To {card.position === 'atk' ? 'Defense' : 'Attack'}
        </button>
      )}
      <button type="button" className={`btn ${fp.attaching ? 'ring-1 ring-warn' : ''}`} onClick={() => fp.setAttaching(!fp.attaching)}>
        {fp.attaching ? 'Now click the Xyz monster…' : 'Attach as material'}
      </button>
      {isMaterial(state, selected) && (
        <button type="button" className="btn" onClick={() => act({ type: 'detach', card: selected })}>
          Detach
        </button>
      )}
      <span className="flex items-center gap-2 text-muted">
        Next move
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
      <button type="button" className="btn" onClick={onInspect}>
        Read card
      </button>
      <button type="button" className="btn" onClick={fp.cancel} title="Esc">
        Cancel
      </button>
    </div>
  )
}

export function FreePlayBar({ fp, onUndo, onInspect }: { fp: FreePlay; onUndo?: () => void; onInspect: () => void }) {
  const { state, act } = fp
  const [lpAmount, setLpAmount] = useState(1000)
  const who = (p: Player) => state.players[p].name

  return (
    <div className="space-y-1.5">
      <SelectedCard fp={fp} onInspect={onInspect} />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="free-play">
        <span className="font-display text-xs font-bold uppercase tracking-widest text-gold" title="Click a card, then a zone to move it">
          Free play
        </span>
        <Menu label="Draw" side="top">
          {PLAYERS.map((p) => (
            <MenuItem key={p} onClick={() => act({ type: 'draw', player: p })}>
              {who(p)} draw{p === 'p1' ? '' : 's'}
            </MenuItem>
          ))}
        </Menu>
        <Menu label="Shuffle" side="top">
          {PLAYERS.map((p) => (
            <MenuItem key={p} onClick={() => act({ type: 'shuffle', player: p, zone: 'deck' })}>
              Shuffle {who(p)}'s Deck
            </MenuItem>
          ))}
        </Menu>
        <Menu label="LP" side="top">
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
        </Menu>
        <button type="button" className="btn" onClick={() => act({ type: 'nextTurn' })}>
          Next turn
        </button>
        <button type="button" className="btn" onClick={onUndo} disabled={!onUndo}>
          Undo
        </button>
        {fp.error && (
          <span role="alert" className="text-xs text-danger">
            Can't do that: {fp.error}
          </span>
        )}
        {!fp.error && fp.warnings.length > 0 && <span className="text-xs text-warn">⚠ {fp.warnings.join(' · ')}</span>}
      </div>
    </div>
  )
}
