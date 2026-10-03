// Invites you've sent that nobody has joined yet, on the home page: the link
// again, or cancel. One that's joined opens its game.
import { useCallback, useEffect, useState } from 'react'
import { api, type Invite } from '../../api/client'
import { InvitePanel } from './InvitePanel'

export function PendingInvites({ onJoined }: { onJoined: (session: string) => void }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const refresh = useCallback(() => void api.invites().then(setInvites), [])
  useEffect(refresh, [refresh])
  if (!invites.length) return null
  return (
    <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {invites.map((i) => (
        <div key={i.code} className="panel border-l-4 border-l-gold p-4">
          <h3 className="mb-2 font-display font-semibold">A duel with {i.deck.name}</h3>
          <InvitePanel invite={i} onJoined={onJoined} onCancelled={refresh} />
        </div>
      ))}
    </div>
  )
}
