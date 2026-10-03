// The fun on the table in a game against a friend: sounds either of you plays,
// emoji stuck on cards (tap one after picking an emoji), and a call-out when
// someone takes a big hit.
import { useEffect, useRef, useState } from 'react'
import type { TableFun as Fun, TableView } from '../../api/table'
import type { BoardState, Iid, Player } from '../../engine'
import { usePlayerStore } from '../../store/playerStore'
import { playFun } from '../../view/funSounds'

type Slot = NonNullable<Fun['card']>
const STUCK_FOR = 3 * 60_000 // an emoji stays on its card this long
const BIG_HIT = 1500

const slotOf = (state: BoardState, iid: Iid): Slot | undefined => {
  const i = state.extraMonster.indexOf(iid)
  if (i >= 0) return { player: state.cards[iid].owner, zone: 'extraMonster', index: i }
  for (const player of ['p1', 'p2'] as Player[])
    for (const [zone, iids] of Object.entries(state.players[player].zones)) {
      const index = (iids as (Iid | null)[]).indexOf(iid)
      if (index >= 0) return { player, zone, index }
    }
}
const cardAt = (state: BoardState, s: Slot): Iid | undefined =>
  (s.zone === 'extraMonster' ? state.extraMonster[s.index] : (state.players[s.player].zones as Record<string, (Iid | null)[]>)[s.zone]?.[s.index]) ?? undefined

export function TableFun({ table, state, sticking, onStick, onCancel }: { table: TableView; state: BoardState; sticking?: string; onStick: (card: Slot) => void; onCancel: () => void }) {
  const muted = usePlayerStore((s) => s.muted)
  // Sounds play once, as they arrive (not the ones there when the table opened).
  const heard = useRef(table.fun.at(-1)?.id ?? 0)
  useEffect(() => {
    for (const f of table.fun.filter((f) => f.id > heard.current)) if (f.sound && !muted) playFun(f.sound)
    heard.current = Math.max(heard.current, table.fun.at(-1)?.id ?? 0)
  }, [table.fun, muted])

  // Picking a card for an emoji: the next tap on one, before the table sees it.
  useEffect(() => {
    if (!sticking) return
    const tap = (e: MouseEvent) => {
      const el = (e.target as Element).closest<HTMLElement>('[data-iid]')
      const slot = el && slotOf(state, el.dataset.iid!)
      if (!slot) return
      e.preventDefault()
      e.stopPropagation()
      onStick(slot)
    }
    document.addEventListener('click', tap, true)
    return () => document.removeEventListener('click', tap, true)
  }, [sticking, state, onStick])

  // A call-out on a big hit to either side.
  const [callout, setCallout] = useState<string>()
  const lp = useRef({ p1: state.players.p1.lp, p2: state.players.p2.lp })
  useEffect(() => {
    const before = lp.current
    lp.current = { p1: state.players.p1.lp, p2: state.players.p2.lp }
    const hit = (['p1', 'p2'] as const).find((p) => before[p] - state.players[p].lp >= BIG_HIT && state.players[p].lp > 0)
    if (!hit) return
    setCallout(`${hit === 'p1' ? 'Ouch!' : 'Big hit!'} −${before[hit] - state.players[hit].lp} to ${state.players[hit].name}`)
    const t = setTimeout(() => setCallout(undefined), 2500)
    return () => clearTimeout(t)
  }, [state])

  // Where each stuck emoji is now: the latest on each card, measured from the page.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const stuck = new Map<Iid, Fun>()
  for (const f of table.fun) {
    if (!f.emoji || !f.card || now - Date.parse(f.at) > STUCK_FOR) continue
    const iid = cardAt(state, f.card)
    if (iid) stuck.set(iid, f)
  }

  return (
    <>
      {[...stuck].map(([iid, f]) => {
        const box = document.querySelector(`[data-iid="${CSS.escape(iid)}"]`)?.getBoundingClientRect()
        return (
          box && (
            <span
              key={f.id}
              className="pointer-events-none fixed z-40 animate-[pop_0.4s_ease-out] text-2xl drop-shadow"
              style={{ left: box.right - 18, top: box.top - 10 }}
              title={`${f.name}`}
              data-testid="sticker"
            >
              {f.emoji}
            </span>
          )
        )
      })}
      {sticking && (
        <div className="fixed inset-x-0 top-16 z-50 mx-auto flex w-fit items-center gap-3 rounded-full border border-gold/50 bg-surface px-4 py-2 text-sm shadow-lg">
          Tap a card to stick {sticking} on it
          <button type="button" className="btn text-xs" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {callout && (
        <p
          className="pointer-events-none fixed inset-x-0 top-1/3 z-40 animate-[pop_0.4s_ease-out] text-center font-display text-4xl font-bold text-gold drop-shadow-[0_2px_8px_rgb(0_0_0/0.8)]"
          role="status"
        >
          {callout}
        </p>
      )}
    </>
  )
}
