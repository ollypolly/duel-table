// Waiting on a friend for a while: a nudge, as a notification on their phone.
import { BellRing } from 'lucide-react'
import { useEffect, useState } from 'react'

const A_WHILE = 60_000

export function Nudge({ since, onNudge }: { since: number; onNudge: () => Promise<{ nudged: boolean }> }) {
  const [now, setNow] = useState(() => Date.now())
  const [sent, setSent] = useState<number>()
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  if (now - since < A_WHILE) return null
  if (sent && now - sent < A_WHILE) return <span className="text-xs text-faint">Nudged</span>
  return (
    <button
      type="button"
      className="btn flex items-center gap-1.5 text-xs"
      onClick={() =>
        void onNudge().then(
          () => setSent(Date.now()),
          () => {},
        )
      }
      title="Send them a notification"
    >
      <BellRing size={14} aria-hidden /> Nudge
    </button>
  )
}
