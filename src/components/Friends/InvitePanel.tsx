// An invite to a game against a friend, waiting for them: the link to send
// (copied, or shared from a phone), until they join and the game opens.
import { Copy, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Invite } from '../../api/client'

const joinLink = (code: string) => `${window.location.origin}/?join=${code}`

export function InvitePanel({ invite, onJoined, onCancelled }: { invite: Invite; onJoined: (session: string) => void; onCancelled?: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = joinLink(invite.code)
  // Checked every couple of seconds while it's open.
  useEffect(() => {
    const t = setInterval(
      () =>
        void api.invite(invite.code).then(
          (i) => i.session && onJoined(i.session),
          () => {},
        ),
      2000,
    )
    return () => clearInterval(t)
  }, [invite.code, onJoined])
  const share = typeof navigator.share === 'function'
  return (
    <div className="space-y-3" data-testid="invite">
      <p className="text-sm">Send this link to whoever you want to play. They pick a deck and join, and the game opens here.</p>
      <input readOnly aria-label="Invite link" className="w-full px-2 py-1.5 font-mono text-xs" value={link} onFocus={(e) => e.target.select()} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center gap-1.5"
          onClick={() =>
            void navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </button>
        {share && (
          <button
            type="button"
            className="btn flex flex-1 items-center justify-center gap-1.5"
            onClick={() => void navigator.share({ title: 'A duel', text: `${invite.from.name} wants a duel`, url: link }).catch(() => {})}
          >
            <Share2 size={14} aria-hidden /> Share
          </button>
        )}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="size-2 animate-pulse rounded-full bg-gold" aria-hidden />
        Waiting for someone to join…
      </p>
      {onCancelled && (
        <button type="button" className="btn text-xs text-danger" onClick={() => void api.cancelInvite(invite.code).then(onCancelled)}>
          Cancel the invite
        </button>
      )}
    </div>
  )
}
