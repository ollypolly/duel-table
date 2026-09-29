// Free-play: turn clicks into engine actions, validate them with tableRules
// and hand valid ones on as steps. Where steps go (a branch, or a live
// session) is up to the caller.
import { useState } from 'react'
import { tryAction } from '../branches/branches'
import { cardDb } from '../data/cards'
import type { Action, BoardState, Iid, Step, SummonMethod, ZoneRef } from '../engine'
import { useUiStore } from '../store/uiStore'

export type FreePlay = ReturnType<typeof useFreePlay>

export function useFreePlay(state: BoardState, onStep: (step: Step) => void) {
  const [error, setError] = useState<string>()
  const [warnings, setWarnings] = useState<string[]>([])
  const [summon, setSummon] = useState<SummonMethod | ''>('')
  const [faceDown, setFaceDown] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const { selected, select } = useUiStore()

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
    setAttaching(false)
    select(undefined)
  }

  return { state, selected, select, act, place, attachTo, cancel, error, warnings, summon, setSummon, faceDown, setFaceDown, attaching, setAttaching }
}
