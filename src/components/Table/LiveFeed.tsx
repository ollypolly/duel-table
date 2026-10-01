// One banner on the board for what the other player does in a game, so it can
// be followed with the scene panel hidden. Only their plays show (a summon, an
// activation, an attack, a Set) and each new turn, with the card's picture;
// the next one takes its place rather than stacking under it. Phases,
// resolutions and your own moves don't: the board shows those. Claude's
// messages and the question waiting for you show, with a chime, only while
// the panel is hidden, since otherwise they're in front of you.
import { useEffect, useRef } from 'react'
import { toast, Toaster } from 'sonner'
import type { Iid, Step } from '../../engine'
import { VIEWER } from '../../view/boardView'
import { isTurnStart, played, playedBy } from '../../view/plays'
import { play } from '../../view/sounds'

const DURATION = 4500

type Props = {
  steps: Step[]
  opponent: string // the other player's name
  image: (iid: Iid) => string | undefined // a card's picture, when its face can be seen
  messages: number // Claude's messages so far
  latest?: string // the last of them
  action: boolean // a question is waiting for you
  asking?: string // what it asks
  panelOpen: boolean
  muted: boolean
  onOpen: () => void
}

export function LiveFeed({ steps, opponent, image, messages, latest, action, asking, panelOpen, muted, onOpen }: Props) {
  const seen = useRef<{ steps: number; messages: number; asking?: string }>({ steps: steps.length, messages, asking: action ? (asking ?? 'Your move') : undefined })

  useEffect(() => {
    const fresh = steps.slice(seen.current.steps)
    seen.current.steps = steps.length
    const step = fresh.findLast((s) => (played(s) ? !playedBy(s, VIEWER) : isTurnStart(s)))
    if (!step) return
    const p = played(step)
    const src = p?.shown ? image(p.card) : undefined
    toast(step.label ?? 'A move', {
      id: 'play',
      description: p ? opponent : undefined,
      icon: src ? <img src={src} alt="" className="h-20 rounded-sm" /> : undefined,
      duration: DURATION,
    })
  }, [steps, opponent, image])

  useEffect(() => {
    const was = seen.current.messages
    seen.current.messages = messages
    if (messages > was && !panelOpen && latest) {
      const text = latest.replace(/[*_`#>]/g, '')
      toast(`${opponent} says`, { id: 'says', description: text.length > 140 ? `${text.slice(0, 140)}…` : text, action: { label: 'Open', onClick: onOpen }, duration: 6000 })
      if (!muted) play('message')
    }
  }, [messages, latest, opponent, panelOpen, muted, onOpen])

  // A new question, not each time the same one is polled.
  useEffect(() => {
    const was = seen.current.asking
    const now = action ? (asking ?? 'Your move') : undefined
    seen.current.asking = now
    if (!now || panelOpen) return void toast.dismiss('ask')
    if (now === was) return
    toast(now, { id: 'ask', description: now === 'Your move' ? undefined : 'Your move', action: { label: 'Open', onClick: onOpen }, duration: DURATION })
    if (!muted) play('message')
  }, [action, asking, panelOpen, muted, onOpen])

  return (
    <Toaster
      position="top-center"
      offset={{ top: 56 }}
      mobileOffset={{ top: 96 }}
      visibleToasts={3}
      expand
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'panel flex w-full items-center gap-4 px-4 py-3 text-ink',
          icon: 'shrink-0 empty:hidden',
          content: 'min-w-0 flex-1',
          title: 'text-base font-semibold leading-snug break-words',
          description: 'line-clamp-3 break-words text-sm text-muted',
          actionButton: 'btn ml-auto shrink-0 text-sm',
        },
      }}
    />
  )
}
