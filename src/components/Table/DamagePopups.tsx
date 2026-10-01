// LP changes this step, big over the board: damage in red on the side of
// the player who took it, with a flash along their edge of the table. Keyed
// by position, so stepping back onto a step plays it again.
import { AnimatePresence, motion } from 'motion/react'
import { PLAYERS, type Player } from '../../engine'

export function DamagePopups({ changes, position, names }: { changes: Partial<Record<Player, number>>; position: number; names: Record<Player, string> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-live="polite">
      <AnimatePresence>
        {PLAYERS.map((p) => {
          const delta = changes[p]
          if (!delta) return null
          const damage = delta < 0
          const top = p === 'p2'
          return (
            <motion.div key={`${p}-${position}`} className="absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 1.6, duration: 0.6 }}>
              <div
                className={`absolute inset-x-0 h-1/3 ${top ? 'top-0 bg-gradient-to-b' : 'bottom-0 bg-gradient-to-t'} ${damage ? 'from-danger/35' : 'from-ok/25'} to-transparent`}
              />
              <motion.div
                className={`absolute left-1/2 -translate-x-1/2 text-center ${top ? 'top-[18%]' : 'bottom-[22%]'}`}
                initial={{ scale: 1.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, y: damage ? [0, -6, 4, -2, 0] : 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                data-testid={`damage-${p}`}
              >
                <div
                  className={`font-display text-6xl font-black tabular-nums sm:text-7xl ${damage ? 'text-danger' : 'text-ok'}`}
                  style={{ textShadow: '0 0 24px currentColor, 0 2px 0 rgb(0 0 0 / 0.8)' }}
                >
                  {delta > 0 && '+'}
                  {delta}
                </div>
                <div className="mt-1 font-display text-xs font-semibold uppercase tracking-widest text-ink/80">
                  {names[p]} {names[p] === 'You' ? (damage ? 'take damage' : 'gain LP') : damage ? 'takes damage' : 'gains LP'}
                </div>
              </motion.div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
