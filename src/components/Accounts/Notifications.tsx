// Settings → Notifications: on this device, "your move" and the rest with the
// app closed. An iPhone needs the app on its Home Screen first.
import { useEffect, useState } from 'react'
import { PUSH_NOTE, pushState, turnOffPush, turnOnPush, type PushState } from '../../push'

export function Notifications() {
  const [state, setState] = useState<PushState>()
  const [busy, setBusy] = useState(false)
  useEffect(() => void pushState().then(setState), [])
  if (!state) return null
  const toggle = async () => {
    setBusy(true)
    setState(await (state === 'on' ? turnOffPush() : turnOnPush()).catch(() => state))
    setBusy(false)
  }
  return (
    <section className="space-y-2 border-b border-line p-5">
      <h3 className="font-display text-sm font-semibold">Notifications</h3>
      {state === 'on' || state === 'off' ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={state === 'on'} disabled={busy} onChange={() => void toggle()} />
          On this device: your move, someone joining, a rematch, or a mention
        </label>
      ) : (
        <p className="text-sm text-muted">{PUSH_NOTE[state]}</p>
      )}
    </section>
  )
}
