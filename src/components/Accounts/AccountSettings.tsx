// Settings → Account: who you are, a link (and QR code) to sign in another
// device, and for the admin, everyone's accounts.
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Account } from '../../api/accounts'
import { accountError, useAccountStore } from '../../store/accountStore'
import { AccountFields } from './Welcome'

const linkFor = (key: string) => `${window.location.origin}/?signin=${key}`

// A sign-in link shown once, with a QR code to scan with a phone.
function SignInLink({ link, onDone }: { link: string; onDone: () => void }) {
  const [svg, setSvg] = useState<string>()
  const [copied, setCopied] = useState(false)
  useEffect(() => void QRCode.toString(link, { type: 'svg', margin: 1 }).then(setSvg), [link])
  return (
    <div className="space-y-2 rounded border border-line p-3">
      {svg && <div className="mx-auto size-44 rounded bg-white p-1" aria-label="QR code of the link" dangerouslySetInnerHTML={{ __html: svg }} />}
      <input readOnly aria-label="Sign-in link" className="w-full px-2 py-1 font-mono text-xs" value={link} onFocus={(e) => e.target.select()} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn flex-1"
          onClick={() =>
            void navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn flex-1" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="text-xs text-muted">Anyone with this link can sign in as this account, so only send it to yourself (or them).</p>
    </div>
  )
}

function Everyone({ me }: { me: Account }) {
  const { everyone, load } = useAccountStore()
  const [link, setLink] = useState<{ id: string; link: string }>()
  const [error, setError] = useState<string>()
  const act = (p: Promise<unknown>) => p.then(load, (e) => setError(accountError(e)))
  return (
    <section className="space-y-2 p-5 pt-0">
      <h3 className="font-display text-sm font-semibold">Accounts</h3>
      <ul className="divide-y divide-line rounded border border-line">
        {everyone.map((a) => (
          <li key={a.id} className="space-y-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate">
                {a.name} <span className="font-mono text-muted">@{a.username}</span>
                {a.admin && <span className="ml-1 text-xs text-gold">admin</span>}
              </span>
              <button
                type="button"
                className="btn px-2 py-0.5 text-xs"
                onClick={() =>
                  void api.newKey(a.id === me.id ? undefined : a.id).then(
                    ({ key }) => setLink({ id: a.id, link: linkFor(key) }),
                    (e) => setError(accountError(e)),
                  )
                }
              >
                New sign-in link
              </button>
              {!a.admin && (
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-xs text-danger"
                  onClick={() => window.confirm(`Remove ${a.username}? What they own stays, owned by nobody but you.`) && act(api.removeAccount(a.id))}
                >
                  Remove
                </button>
              )}
            </div>
            {link?.id === a.id && <SignInLink link={link.link} onDone={() => setLink(undefined)} />}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}

export function AccountSettings() {
  const { on, me, setMe } = useAccountStore()
  const [editing, setEditing] = useState<{ name: string; username: string }>()
  const [link, setLink] = useState<string>()
  const [error, setError] = useState<string>()
  if (!on || !me) return null
  const save = () =>
    editing &&
    api.changeAccount(me.id, editing).then(
      (a) => {
        setMe(a)
        setEditing(undefined)
        setError(undefined)
      },
      (e) => setError(accountError(e)),
    )
  return (
    <>
      <section className="space-y-3 border-b border-line p-5">
        <h3 className="font-display text-sm font-semibold">Account</h3>
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <AccountFields {...editing} onChange={setEditing} />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary flex-1">
                Save
              </button>
              <button type="button" className="btn flex-1" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">
              {me.name} <span className="font-mono text-muted">@{me.username}</span>
            </span>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setEditing({ name: me.name, username: me.username })}>
              Change
            </button>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {link ? (
          <SignInLink link={link} onDone={() => setLink(undefined)} />
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn flex-1"
              onClick={() =>
                void api.newKey().then(
                  ({ key }) => setLink(linkFor(key)),
                  (e) => setError(accountError(e)),
                )
              }
            >
              Use on another device
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => window.confirm('Sign out of this browser? You’ll need a sign-in link to get back in.') && void api.signOut().then(() => setMe(undefined))}
            >
              Sign out
            </button>
          </div>
        )}
      </section>
      {me.admin && <Everyone me={me} />}
    </>
  )
}
