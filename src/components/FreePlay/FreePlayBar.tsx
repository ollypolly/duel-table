// Free-play controls. Card moves are click-to-select then click-to-place (on
// the board); the selected card's own actions sit in its popover
// (CardActions), everything global is one row above the step controls.
import { useState, type ReactNode } from 'react'
import { isMaterial } from '../../branches/branches'
import { getCard, locate, PLAYERS, type Player, type SummonMethod } from '../../engine'
import type { FreePlay } from '../../hooks/useFreePlay'

const SUMMONS: SummonMethod[] = ['normal', 'tribute', 'flip', 'special', 'fusion', 'synchro', 'xyz', 'link', 'ritual']
const btn = 'rounded-md bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-40'

export function CardActions({ fp }: { fp: FreePlay }) {
  const { state, selected, act } = fp
  if (!selected || !state.cards[selected]) return null
  const card = getCard(state, selected)
  const loc = locate(state, selected)
  const zone = loc && 'zone' in loc ? loc.zone.zone : undefined
  const onMonsterZone = zone === 'monster' || zone === 'extraMonster'
  return (
    <div className="space-y-2 border-b border-slate-700 bg-sky-950/40 p-3 pr-10 text-xs" data-testid="card-actions">
      <p className="text-sky-200">Click a zone to move it there, or:</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={() => act({ type: 'move', card: selected, to: { player: card.owner, zone: 'hand' } })}>
          To hand
        </button>
        {zone && zone !== 'hand' && (
          <button type="button" className={btn} onClick={() => act({ type: 'flip', card: selected })}>
            Flip {card.faceUp ? 'face-down' : 'face-up'}
          </button>
        )}
        {onMonsterZone && (
          <button type="button" className={btn} onClick={() => act({ type: 'position', card: selected, position: card.position === 'atk' ? 'def' : 'atk' })}>
            To {card.position === 'atk' ? 'Defense' : 'Attack'}
          </button>
        )}
        <button type="button" className={`${btn} ${fp.attaching ? 'ring-1 ring-amber-300' : ''}`} onClick={() => fp.setAttaching(!fp.attaching)}>
          {fp.attaching ? 'Now click the Xyz monster…' : 'Attach as material'}
        </button>
        {isMaterial(state, selected) && (
          <button type="button" className={btn} onClick={() => act({ type: 'detach', card: selected })}>
            Detach
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-slate-300">
        Next move:
        <select aria-label="Summon method" className="rounded bg-slate-800 px-1 py-0.5" value={fp.summon} onChange={(e) => fp.setSummon(e.target.value as SummonMethod | '')}>
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
      </div>
    </div>
  )
}

export function FreePlayBar({ fp, onUndo, children }: { fp: FreePlay; onUndo?: () => void; children?: ReactNode }) {
  const { state, act } = fp
  const [lpPlayer, setLpPlayer] = useState<Player>('p2')
  const [lpAmount, setLpAmount] = useState(1000)
  const who = (p: Player) => state.players[p].name

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="free-play">
      <span className="text-xs font-semibold text-emerald-300" title="Click a card, then a zone to move it">
        Free play
      </span>
      {PLAYERS.map((p) => (
        <button key={p} type="button" className={btn} onClick={() => act({ type: 'draw', player: p })}>
          {who(p)} draw{p === 'p1' ? '' : 's'}
        </button>
      ))}
      {PLAYERS.map((p) => (
        <button key={p} type="button" className={btn} onClick={() => act({ type: 'shuffle', player: p, zone: 'deck' })}>
          Shuffle {who(p)}
        </button>
      ))}
      <button type="button" className={btn} onClick={() => act({ type: 'nextTurn' })}>
        Next turn
      </button>
      <span className="flex items-center gap-1 text-xs">
        <select aria-label="LP player" className="rounded bg-slate-800 px-1 py-1" value={lpPlayer} onChange={(e) => setLpPlayer(e.target.value as Player)}>
          {PLAYERS.map((p) => (
            <option key={p} value={p}>
              {who(p)}
            </option>
          ))}
        </select>
        <input
          aria-label="LP amount"
          type="number"
          min={0}
          step={100}
          className="w-20 rounded bg-slate-800 px-1 py-1"
          value={lpAmount}
          onChange={(e) => setLpAmount(Math.max(0, Number(e.target.value)))}
        />
        <button type="button" className={btn} onClick={() => act({ type: 'lp', player: lpPlayer, delta: -lpAmount })}>
          − LP
        </button>
        <button type="button" className={btn} onClick={() => act({ type: 'lp', player: lpPlayer, delta: lpAmount })}>
          + LP
        </button>
      </span>
      <button type="button" className={btn} onClick={onUndo} disabled={!onUndo}>
        Undo
      </button>
      {fp.error && (
        <span role="alert" className="text-xs text-rose-300">
          Can't do that: {fp.error}
        </span>
      )}
      {!fp.error && fp.warnings.length > 0 && <span className="text-xs text-amber-300">⚠ {fp.warnings.join(' · ')}</span>}
      <span className="ml-auto flex items-center gap-2">{children}</span>
    </div>
  )
}
