// Free-play: turn clicks into engine actions, validate them with tableRules
// and hand valid ones on as steps. Where steps go (a branch, or a live
// session) is up to the caller.
import { useState } from 'react'
import { tryAction } from '../branches/branches'
import { cardDb } from '../data/cards'
import { isSlotZone, zoneArray, type Action, type BoardState, type Iid, type Step, type SummonMethod, type ZoneRef } from '../engine'
import { useUiStore } from '../store/uiStore'

export type FreePlay = ReturnType<typeof useFreePlay>

export function useFreePlay(state: BoardState, onStep: (step: Step) => void) {
  const [error, setError] = useState<string>()
  const [warnings, setWarnings] = useState<string[]>([])
  const [summon, setSummon] = useState<SummonMethod | ''>('')
  const [faceDown, setFaceDown] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const { selected, select } = useUiStore()
  // Further copies picked up with the selected card: they follow it into the
  // next free slots of the zone it's placed in.
  const [picked, setPicked] = useState<{ lead?: Iid; rest: Iid[] }>({ rest: [] })
  const more = picked.lead && picked.lead === selected ? picked.rest : []
  const setMore = (rest: Iid[]) => setPicked({ rest })
  const pick = (iids: Iid[]) => {
    select(iids[0])
    setPicked({ lead: iids[0], rest: iids.slice(1) })
  }

  const act = (action: Action) => {
    const r = tryAction(state, action, cardDb)
    if (!r.ok) {
      setError(r.error)
      return false
    }
    setError(undefined)
    setWarnings(r.warnings)
    onStep(r.step)
    return true
  }

  // Several actions as one step (one Undo takes it all back). The session
  // checks them when it applies the step.
  const actAll = (label: string, actions: Action[]) => {
    if (!actions.length) return
    setError(undefined)
    setWarnings([])
    onStep({ label, actions })
  }

  // Move a card (by default the selected one) to a zone, using the "next
  // move" options.
  const place = (to: ZoneRef, card = selected) => {
    if (!card) return false
    const monsterZone = to.zone === 'monster' || to.zone === 'extraMonster'
    const ok = act({
      type: 'move',
      card,
      to,
      ...(faceDown && { faceUp: false, ...(monsterZone && { position: 'def' as const }) }),
      ...(summon && monsterZone && { summon }),
    })
    if (ok) {
      if (card === selected && more.length && isSlotZone(to.zone) && to.slot !== undefined) {
        const slots = zoneArray(state, to)
        const free = slots.map((iid, slot) => (iid === null && slot !== to.slot ? slot : -1)).filter((slot) => slot >= 0)
        // Nearest free slots first, so the copies sit together.
        free.sort((a, b) => Math.abs(a - to.slot!) - Math.abs(b - to.slot!))
        more.slice(0, free.length).every((iid, i) => act({ type: 'move', card: iid, to: { ...to, slot: free[i] } }))
      } else if (card === selected && more.length) {
        more.every((iid) => act({ type: 'move', card: iid, to }))
      }
      setMore([])
      select(undefined)
      setSummon('')
      setFaceDown(false)
    }
    return ok
  }

  // Attach the selected card to another; false when not attaching.
  const attachTo = (iid: Iid) => {
    if (!attaching || !selected || selected === iid) return false
    if (act({ type: 'attach', card: selected, to: iid })) select(undefined)
    setAttaching(false)
    return true
  }

  const cancel = () => {
    setMore([])
    setAttaching(false)
    select(undefined)
  }

  return { state, selected, select, pick, more, act, actAll, place, attachTo, cancel, error, warnings, summon, setSummon, faceDown, setFaceDown, attaching, setAttaching }
}
