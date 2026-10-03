// Against a friend, once it's over: ask for a rematch, wait for them, or
// answer theirs. The rematch's game opens on both screens.
import type { Player } from '../../engine'
import { VIEWER } from '../../view/boardView'

export type Rematch = { by: Player; session?: string; refused?: boolean }

// Against a friend: ask for a rematch, wait for them, or answer theirs.
export function FriendRematch({ rematch, them, busy, onAnswer, onOpen }: { rematch?: Rematch; them: string; busy?: boolean; onAnswer: (accept: boolean) => void; onOpen?: (session: string) => void }) {
  if (rematch?.session)
    return (
      <button type="button" className="btn btn-primary" onClick={() => onOpen?.(rematch.session!)}>
        Open the rematch
      </button>
    )
  if (rematch && !rematch.refused && rematch.by === VIEWER) return <p className="text-sm text-muted">Asked {them} for a rematch…</p>
  if (rematch && !rematch.refused)
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid="rematch-asked">
        <span className="text-sm">{them} wants a rematch!</span>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAnswer(true)}>
          Rematch
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onAnswer(false)}>
          No thanks
        </button>
      </span>
    )
  return (
    <>
      {rematch?.refused && <span className="text-sm text-muted">{rematch.by === VIEWER ? `${them} said no to a rematch.` : 'You said no to a rematch.'}</span>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAnswer(true)} title={`Ask ${them} to play again, with them going first if you did`}>
        Rematch
      </button>
    </>
  )
}
