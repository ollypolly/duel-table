// The end of a game against a friend: a win screen with applause, or a sad one
// with a trombone, then Rematch, a review, or back to the table. Only when it
// has just ended (not on opening an old game).
import { useEffect, useState } from 'react'
import type { GameView } from '../../api/game'
import { usePlayerStore } from '../../store/playerStore'
import { playFun } from '../../view/funSounds'
import { FriendRematch, type Rematch } from './Rematch'

const JUST = 60_000

export function GameOver({
  game,
  them,
  rematch,
  busy,
  onRematch,
  onOpen,
  onReview,
}: {
  game: GameView
  them: string
  rematch?: Rematch
  busy?: boolean
  onRematch: (accept: boolean) => void
  onOpen: (session: string) => void
  onReview?: () => void
}) {
  const won = game.winner?.player === 'p1'
  const [open, setOpen] = useState(() => !!game.endedAt && Date.now() - game.endedAt < JUST)
  const muted = usePlayerStore((s) => s.muted)
  useEffect(() => {
    if (open && !muted) playFun(won ? 'applause' : 'trombone')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it opens
  }, [])
  if (!open || !game.winner) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-label={won ? 'You win' : `${them} wins`}>
      <div className="panel w-full max-w-sm animate-[pop_0.4s_ease-out] space-y-4 p-6 text-center">
        <p className="text-6xl" aria-hidden>
          {won ? '🏆' : '😭'}
        </p>
        <h2 className={`font-display text-3xl font-bold ${won ? 'text-gold' : 'text-muted'}`}>{won ? 'You win!' : `${them} wins`}</h2>
        <p className="text-sm text-muted">{won ? `Well played. ${them} will want another go.` : 'Unlucky. Ask for a rematch, or see where it turned with a review.'}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FriendRematch rematch={rematch} them={them} busy={busy} onAnswer={onRematch} onOpen={onOpen} />
          {onReview && (
            <button type="button" className="btn" onClick={onReview}>
              Review
            </button>
          )}
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            See the table
          </button>
        </div>
      </div>
    </div>
  )
}
