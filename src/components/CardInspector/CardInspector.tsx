// A card, big: its art and text over the blurred table. Hovering a card opens
// it after a short delay; it ignores the pointer, so moving onto the next card
// swaps it and moving off closes it. Clicking pins it until ✕, Esc or a click
// outside.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CardFace } from '../../view/boardView'
import { CardArt, CardInfo } from '../CardDetail/CardDetail'

const OPEN_DELAY_MS = 350
const CLOSE_GRACE_MS = 120 // so sliding between neighbouring cards doesn't flicker

export function CardInspector({
  hovered,
  pinned,
  materialsOf,
  onClose,
  actions,
}: {
  hovered?: CardFace
  pinned?: CardFace
  materialsOf: (card: CardFace) => CardFace[]
  onClose: () => void
  actions?: ReactNode // shown when pinned
}) {
  const [shownHover, setShownHover] = useState<CardFace>()
  const open = useRef(false)
  useEffect(() => {
    const t = hovered
      ? setTimeout(() => setShownHover(hovered), open.current ? 0 : OPEN_DELAY_MS)
      : setTimeout(() => setShownHover(undefined), CLOSE_GRACE_MS)
    return () => clearTimeout(t)
  }, [hovered])
  useEffect(() => {
    open.current = !!shownHover
  }, [shownHover])

  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned, onClose])

  const card = pinned ?? shownHover
  return (
    <AnimatePresence>
      {card && (
        <motion.div
          key="inspector"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          role={pinned ? 'dialog' : 'tooltip'}
          aria-label={card.visible ? card.name : 'Face-down card'}
          className={`fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4 backdrop-blur-md sm:p-10 ${pinned ? '' : 'pointer-events-none'}`}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ scale: 0.94, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex max-h-full w-full max-w-5xl flex-col items-center gap-6 overflow-y-auto sm:flex-row sm:items-center sm:gap-10"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <div className="aspect-[1/1.46] w-[min(70vw,40vh)] shrink-0 text-4xl sm:w-[min(40vw,calc(78vh/1.46))]">
              <CardArt card={card} />
            </div>
            <div className="panel relative w-full min-w-0 max-w-xl p-5 sm:p-6">
              {pinned && (
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute right-3 top-3 rounded px-2 text-lg text-muted hover:bg-raised hover:text-ink"
                  aria-label="Close card"
                  title="Close (Esc)"
                >
                  ✕
                </button>
              )}
              <CardInfo card={card} materials={materialsOf(card)} large />
              {pinned && actions && <div className="mt-5 border-t border-line pt-4">{actions}</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
