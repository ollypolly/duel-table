// A card, big: its art and text over the blurred table, with what you can do
// with it. Opens on click, closes on ✕, Esc or a click outside.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import type { CardFace } from '../../view/boardView'
import { CardArt, CardInfo } from '../CardDetail/CardDetail'

export function CardInspector({
  card,
  materialsOf,
  onClose,
  actions,
}: {
  card?: CardFace
  materialsOf: (card: CardFace) => CardFace[]
  onClose: () => void
  actions?: ReactNode
}) {
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, onClose])

  return (
    <AnimatePresence>
      {card && (
        <motion.div
          key="inspector"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-label={card.visible ? card.name : 'Face-down card'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 pad-safe backdrop-blur-md sm:[--pad:2.5rem]"
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
              <button
                type="button"
                onClick={onClose}
                className="absolute right-3 top-3 rounded px-2 text-lg text-muted hover:bg-raised hover:text-ink"
                aria-label="Close card"
                title="Close (Esc)"
              >
                ✕
              </button>
              <CardInfo card={card} materials={materialsOf(card)} />
              {actions && <div className="mt-5 border-t border-line pt-4">{actions}</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
