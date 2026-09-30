// Toasts on the board for what happens live in a game, so it can be followed
// with the scene panel hidden. Each new step shows; a burst of them from one
// player (a combo) folds into one toast that counts up. Claude's messages and
// "Your move" show, with a chime, only while the panel is hidden, since
// otherwise they're in front of you.
import { useEffect, useRef } from 'react'
import { toast, Toaster } from 'sonner'
import type { Step } from '../../engine'
import { play } from '../../view/sounds'

const DURATION = 4000
const BURST_MS = 2500 // steps closer together than this are one burst

type Burst = { id: string | number; author?: Step['author']; count: number; at: number }

type Props = {
  steps: Step[]
  opponent: string // the other player's name
  messages: number // Claude's messages so far
  latest?: string // the last of them
  action: boolean // a question is waiting for you
  panelOpen: boolean
  muted: boolean
  onOpen: () => void
}

export function LiveFeed({ steps, opponent, messages, latest, action, panelOpen, muted, onOpen }: Props) {
  const seen = useRef({ steps: steps.length, messages, action })
  const burst = useRef<Burst | undefined>(undefined)

  useEffect(() => {
    const fresh = steps.slice(seen.current.steps)
    seen.current.steps = steps.length
    if (!fresh.length) return
    const author = fresh.at(-1)!.author
    const who = author === 'user' ? 'You: ' : author ? `${opponent}: ` : ''
    const label = fresh.at(-1)!.label ?? 'A move'
    const now = Date.now()
    const b = burst.current
    if (b && b.author === author && now - b.at < BURST_MS) {
      b.count += fresh.length
      b.at = now
      toast(`${who}${b.count} moves`, { id: b.id, description: label, duration: DURATION })
    } else if (fresh.length > 1) {
      burst.current = { id: toast(`${who}${fresh.length} moves`, { description: label, duration: DURATION }), author, count: fresh.length, at: now }
    } else {
      burst.current = { id: toast(`${who}${label}`, { duration: DURATION }), author, count: 1, at: now }
    }
  }, [steps, opponent])

  useEffect(() => {
    const was = seen.current.messages
    seen.current.messages = messages
    if (messages > was && !panelOpen && latest) {
      const text = latest.replace(/[*_`#>]/g, '')
      toast(`${opponent} says`, { description: text.length > 140 ? `${text.slice(0, 140)}…` : text, action: { label: 'Open', onClick: onOpen }, duration: 6000 })
      if (!muted) play('message')
    }
  }, [messages, latest, opponent, panelOpen, muted, onOpen])

  useEffect(() => {
    const was = seen.current.action
    seen.current.action = action
    if (action && !was && !panelOpen) {
      toast('Your move', { action: { label: 'Open', onClick: onOpen }, duration: DURATION })
      if (!muted) play('message')
    }
  }, [action, panelOpen, muted, onOpen])

  return (
    <Toaster
      position="top-center"
      offset={{ top: 56 }}
      mobileOffset={{ top: 96 }}
      visibleToasts={3}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'panel flex w-full items-center gap-3 px-3 py-2 text-sm text-ink',
          content: 'min-w-0 flex-1',
          title: 'font-semibold break-words',
          description: 'line-clamp-3 break-words text-xs text-muted',
          actionButton: 'btn ml-auto shrink-0 text-xs',
        },
      }}
    />
  )
}
