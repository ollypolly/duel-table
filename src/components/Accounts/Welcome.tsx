// A first visit with no account in this browser: a username and what to call
// you, which makes one (the join screen does the same, as part of joining). Or
// a code from a device that's signed in.
import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../api/client'
import { accountError, useAccountStore } from '../../store/accountStore'
import { Logo } from '../Logo/Logo'

const toUsername = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 20)

// The two fields, with the username following the name until it's typed into.
export function AccountFields({ name, username, onChange }: { name: string; username: string; onChange: (v: { name: string; username: string }) => void }) {
  const [typed, setTyped] = useState(false)
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm text-muted">What should we call you?</span>
        <input
          className="w-full px-3 py-2 text-base"
          autoComplete="nickname"
          maxLength={40}
          value={name}
          onChange={(e) => onChange({ name: e.target.value, username: typed ? username : toUsername(e.target.value) })}
          autoFocus
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-muted">A username (short, lowercase)</span>
        <input
          className="w-full px-3 py-2 font-mono text-base"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => {
            setTyped(true)
            onChange({ name, username: toUsername(e.target.value) })
          }}
        />
      </label>
    </div>
  )
}

export function Welcome({ children }: { children?: ReactNode }) {
  const setMe = useAccountStore((s) => s.setMe)
  const [fields, setFields] = useState({ name: '', username: '' })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<string>()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      setMe(await (code === undefined ? api.makeAccount(fields) : api.signIn({ code })))
    } catch (err) {
      setError(accountError(err))
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-4 text-ink">
      <form onSubmit={(e) => void submit(e)} className="panel w-full max-w-sm space-y-5 p-6">
        <div className="flex justify-center">
          <Logo className="size-12" />
        </div>
        <div className="space-y-1 text-center">
          <h1 className="font-display text-xl font-semibold">{code === undefined ? 'Welcome' : 'Sign in'}</h1>
          {code === undefined && <p className="text-sm text-muted">Make an account to play and keep your own decks. It lives in this browser: no password.</p>}
        </div>
        {code === undefined ? (
          <AccountFields {...fields} onChange={setFields} />
        ) : (
          <label className="block space-y-1">
            <span className="text-sm text-muted">The code from Settings → Use on another device, on a device you’re signed in on</span>
            <input
              className="w-full px-3 py-2 text-center font-mono text-2xl tracking-widest uppercase"
              aria-label="Sign-in code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={9}
              placeholder="ABC-123"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" className="btn btn-primary w-full py-2" disabled={busy || (code === undefined ? fields.username.length < 2 : code.replace(/[^A-Za-z0-9]/g, '').length < 6)}>
          {code === undefined ? 'Make my account' : 'Sign in'}
        </button>
        {children}
        <button
          type="button"
          className="w-full text-center text-xs text-muted underline"
          onClick={() => {
            setCode(code === undefined ? '' : undefined)
            setError(undefined)
          }}
        >
          {code === undefined ? 'Already have an account? Sign in with a code' : 'New here? Make an account'}
        </button>
      </form>
    </div>
  )
}
