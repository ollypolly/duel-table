// A random player for the rules core: picks among the legal options it's
// offered, leaning towards doing things. For bot games and tests, not play.
import { M, type PromptMsg } from './lib'

export type Rng = () => number // 0 <= n < 1

export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0), (s >>> 8) / 0x1000000)
}

// attempt counts retries of the same prompt, so repeated invalid picks vary.
// codes are card codes it may declare when asked to name a card.
export function botResponse(m: PromptMsg, rng: Rng, attempt = 0, codes: number[] = []): Uint8Array {
  const int = (n: number) => Math.floor(rng() * n)
  const pick = <T,>(xs: T[]) => xs[int(xs.length)]
  const keen = rng() < 0.8 - attempt * 0.1

  if (m instanceof M.YGOProMsgSelectIdleCmd) {
    const options: [number, object][] = [
      ...m.activatableCards.map((c) => [M.IdleCmdType.ACTIVATE, c] as [number, object]),
      ...m.spSummonableCards.map((c) => [M.IdleCmdType.SPSUMMON, c] as [number, object]),
      ...m.summonableCards.map((c) => [M.IdleCmdType.SUMMON, c] as [number, object]),
      ...m.msetableCards.map((c) => [M.IdleCmdType.MSET, c] as [number, object]),
      ...m.ssetableCards.map((c) => [M.IdleCmdType.SSET, c] as [number, object]),
    ]
    if (options.length && keen) {
      const [type, card] = pick(options)
      return m.prepareResponse(type, card as never)
    }
    return m.prepareResponse(m.canBp ? M.IdleCmdType.TO_BP : M.IdleCmdType.TO_EP)
  }
  if (m instanceof M.YGOProMsgSelectBattleCmd) {
    if (m.attackableCards.length && keen) return m.prepareResponse(M.BattleCmdType.ATTACK, pick(m.attackableCards))
    return m.prepareResponse(m.canM2 ? M.BattleCmdType.TO_M2 : M.BattleCmdType.TO_EP)
  }
  if (m instanceof M.YGOProMsgSelectChain) {
    const forced = m.chains.find((c) => c.forced)
    if (forced) return m.prepareResponse(forced)
    if (m.chains.length && attempt === 0 && rng() < 0.5) return m.prepareResponse(pick(m.chains))
    return m.defaultResponse()
  }
  if (m instanceof M.YGOProMsgSelectEffectYn || m instanceof M.YGOProMsgSelectYesNo) return m.prepareResponse(rng() < 0.7)
  if (m instanceof M.YGOProMsgSelectPosition) return m.prepareResponse(pick([1, 2, 4, 8].filter((b) => m.positions & b)))
  if (m instanceof M.YGOProMsgSelectOption) return m.prepareResponse(m.options[int(m.options.length)])
  if (m instanceof M.YGOProMsgSelectPlaceCommon) return m.prepareResponse(m.getSelectablePlaces().slice(0, Math.max(1, m.count)))
  if (m instanceof M.YGOProMsgSelectCard || m instanceof M.YGOProMsgSelectTribute) {
    const n = Math.min(m.cards.length, m.min + (attempt ? int(m.max - m.min + 1) : 0))
    return m.prepareResponse(shuffled([...m.cards.keys()], int).slice(0, n).map((i) => M.IndexResponse(i)))
  }
  if (m instanceof M.YGOProMsgSelectUnselectCard) {
    if (m.finishable && (!m.selectableCards.length || rng() < 0.5)) return m.prepareResponse(null)
    return m.prepareResponse(M.IndexResponse(int(m.selectableCards.length)))
  }
  if (m instanceof M.YGOProMsgSelectSum) {
    const order = shuffled([...m.cards.keys()], int)
    return m.prepareResponse(order.slice(0, Math.max(1, m.min + (attempt % Math.max(1, m.cards.length)))).map((i) => M.IndexResponse(i)))
  }
  if (m instanceof M.YGOProMsgSelectCounter) {
    // Take them off the cards in order until there are enough.
    let left = m.counterCount
    return m.prepareResponse(
      m.cards.map((c, i) => {
        const count = Math.min(left, c.counterCount)
        left -= count
        return { card: M.IndexResponse(i), count }
      }),
    )
  }
  if (m instanceof M.YGOProMsgAnnounceCard && codes.length) return m.prepareResponse(codes[(attempt + int(codes.length)) % codes.length])
  if (m instanceof M.YGOProMsgAnnounceNumber) return m.prepareResponse(M.IndexResponse(int(m.numbers.length)))
  if (m instanceof M.YGOProMsgAnnounceRace) return m.prepareResponse(1)
  if (m instanceof M.YGOProMsgAnnounceAttrib) return m.prepareResponse(1)
  if (m instanceof M.YGOProMsgRockPaperScissors) return m.prepareResponse(1 as never)
  const fallback = m.defaultResponse()
  if (!fallback) throw new Error(`the bot can't answer ${m.constructor.name}`)
  return fallback
}

function shuffled<T>(xs: T[], int: (n: number) => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = int(i + 1)
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
}
