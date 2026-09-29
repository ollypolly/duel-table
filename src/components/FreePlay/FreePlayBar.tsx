// Free-play controls under the board. Card moves are click-to-select then
// click-to-place (on the board); everything else is a button here.
import { useState, type ReactNode } from 'react'
import { isMaterial } from '../../branches/branches'
import { cardDb } from '../../data/cards'
import { getCard, locate, PLAYERS, type Player, type SummonMethod } from '../../engine'
import type { FreePlay } from '../../hooks/useFreePlay'
import { cardFace } from '../../view/boardView'

const SUMMONS: SummonMethod[] = ['normal', 'tribute', 'flip', 'special', 'fusion', 'synchro', 'xyz', 'link', 'ritual']
const btn = 'rounded-md bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-40'

export function FreePlayBar({ fp, onUndo, children }: { fp: FreePlay; onUndo?: () => void; children?: ReactNode }) {
  const { state, selected, act } = fp
  const [lpPlayer, setLpPlayer] = useState<Player>('p2')
  const [lpAmount, setLpAmount] = useState(1000)
  const who = (p: Player) => state.players[p].name
  const card = selected && state.cards[selected] ? getCard(state, selected) : undefined
  const loc = selected ? locate(state, selected) : undefined
  const zone = loc && 'zone' in loc ? loc.zone.zone : undefined
  const onMonsterZone = zone === 'monster' || zone === 'extraMonster'

  return (
    <div className="space-y-2 rounded-xl bg-slate-900 p-3 text-sm" data-testid="free-play">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-emerald-300">Free play</span>
        {children}
        <button type="button" className={`${btn} ml-auto`} onClick={onUndo} disabled={!onUndo}>
          Undo last step
        </button>
      </div>

      {card && selected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-950/60 px-2 py-1.5">
          <span className="text-sky-200">
            <b>{cardFace(state, selected, cardDb).name}</b> selected: click a zone to move it, or
          </span>
          <button type="button" className={btn} onClick={() => act({ type: 'move', card: selected, to: { player: card.owner, zone: 'hand' } })}>
            To hand
          </button>
          {zone && zone !== 'hand' && (
            <button type="button" className={btn} onClick={() => act({ type: 'flip', card: selected })}>
              Flip {card.faceUp ? 'face-down' : 'face-up'}
            </button>
          )}
          {onMonsterZone && (
            <button
              type="button"
              className={btn}
              onClick={() => act({ type: 'position', card: selected, position: card.position === 'atk' ? 'def' : 'atk' })}
            >
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
          <span className="ml-auto flex items-center gap-2 text-xs text-slate-300">
            Next move:
            <select
              aria-label="Summon method"
              className="rounded bg-slate-800 px-1 py-0.5"
              value={fp.summon}
              onChange={(e) => fp.setSummon(e.target.value as SummonMethod | '')}
            >
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
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Click a card (or pick one from a pile) to select it, then click a zone to move it there.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
        <span className="ml-auto flex items-center gap-1 text-xs">
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
      </div>

      {fp.error && (
        <p role="alert" className="text-xs text-rose-300">
          Can't do that: {fp.error}
        </p>
      )}
      {!fp.error && fp.warnings.length > 0 && <p className="text-xs text-amber-300">⚠ {fp.warnings.join(' · ')}</p>}
    </div>
  )
}
