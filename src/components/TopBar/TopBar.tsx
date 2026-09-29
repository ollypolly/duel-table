import type { ReactNode } from 'react'

// The one header: app navigation on the left, the table's status (LP, turn,
// phase) on the right when a scenario is open.
export function TopBar({ nav, status }: { nav: ReactNode; status?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-800/80 px-4 py-1.5">
      {nav}
      {status && <div className="ml-auto">{status}</div>}
    </header>
  )
}
