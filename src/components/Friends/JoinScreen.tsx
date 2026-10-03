// Opening an invite link: who it's from, then a deck (yours, or one to borrow),
// its sleeves, and when to be asked to respond. Someone new gives a name too,
// which makes their account as they join.
import { useEffect, useState, type FormEvent } from 'react'
import { api, type DeckSummary, type Invite } from '../../api/client'
import { RESPOND_LEVELS, type Respond } from '../../api/game'
import { accountError, useAccountStore } from '../../store/accountStore'
import { AccountFields } from '../Accounts/Welcome'
import { DeckCosmetics } from '../Cosmetics/Cosmetics'
import { Logo } from '../Logo/Logo'
import { InvitePanel } from './InvitePanel'

export function JoinScreen({ code, onOpen, onLeave }: { code: string; onOpen: (session: string) => void; onLeave: () => void }) {
  const { me, everyone, load } = useAccountStore()
  const [invite, setInvite] = useState<Invite>()
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [deck, setDeck] = useState('')
  const [respond, setRespond] = useState<Respond>('auto')
  const [fields, setFields] = useState({ name: '', username: '' })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.invite(code).then(setInvite, (e: unknown) => setError(accountError(e)))
    void api.decks().then((all) => {
      const usable = all.filter((d) => !d.errors?.length)
      setDecks(usable)
      setDeck((d) => d || (usable.find((x) => me && x.owner === me.id) ?? usable[0])?.id || '')
    })
  }, [code, me])

  // Already playing it: straight to the table.
  useEffect(() => {
    if (invite?.playing && invite.session) onOpen(invite.session)
  }, [invite, onOpen])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const joined = await api.joinInvite(code, { deck, respond, ...(!me && { account: fields }) })
      await load()
      onOpen(joined.session!)
    } catch (err) {
      setError(accountError(err))
      setBusy(false)
    }
  }

  const whose = (d: DeckSummary) => (d.owner && d.owner !== me?.id ? everyone.find((a) => a.id === d.owner)?.name : undefined)
  const mine = decks.filter((d) => !whose(d))
  const borrowed = decks.filter((d) => whose(d))
  const taken = invite?.session && !invite.playing

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-4 text-ink">
      <form onSubmit={(e) => void submit(e)} className="panel w-full max-w-md space-y-5 p-6">
        <div className="flex justify-center">
          <Logo className="size-12" />
        </div>
        {!invite ? (
          <p className="text-center text-sm text-muted">{error ?? 'Finding the invite…'}</p>
        ) : invite.yours ? (
          <>
            <h1 className="text-center font-display text-xl font-semibold">Your invite</h1>
            <InvitePanel invite={invite} onJoined={onOpen} onCancelled={onLeave} />
          </>
        ) : taken ? (
          <p className="text-center text-sm text-muted">Someone else has already joined this game. Ask {invite.from.name} for a new link.</p>
        ) : (
          <>
            <div className="space-y-1 text-center">
              <h1 className="font-display text-xl font-semibold">{invite.from.name} wants a duel</h1>
              <p className="text-sm text-muted">They’re playing {invite.deck.name}.</p>
            </div>
            {!me && <AccountFields {...fields} onChange={setFields} />}
            <label className="block space-y-1">
              <span className="text-sm text-muted">Your deck</span>
              <select className="w-full px-3 py-2 text-base" value={deck} onChange={(e) => setDeck(e.target.value)}>
                {mine.length > 0 && (
                  <optgroup label={me ? 'Yours' : 'Decks'}>
                    {mine.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name ?? d.id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {borrowed.length > 0 && (
                  <optgroup label="To borrow">
                    {borrowed.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name ?? d.id} ({whose(d)}’s)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {deck && (
              <details>
                <summary className="cursor-pointer text-sm text-muted">Sleeves and playmat</summary>
                <div className="pt-3">
                  <DeckCosmetics deck={deck} />
                </div>
              </details>
            )}
            <label className="block space-y-1">
              <span className="text-sm text-muted">Ask me to respond</span>
              <select className="w-full px-3 py-2 text-base" value={respond} onChange={(e) => setRespond(e.target.value as Respond)}>
                {RESPOND_LEVELS.map(([level, label]) => (
                  <option key={level} value={level}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" className="btn btn-primary w-full py-2" disabled={busy || !deck || (!me && fields.username.length < 2)}>
              Join the game
            </button>
          </>
        )}
        <button type="button" className="btn w-full text-xs" onClick={onLeave}>
          Not now
        </button>
      </form>
    </div>
  )
}
