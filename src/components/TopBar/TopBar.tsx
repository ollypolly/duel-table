import type { ReactNode } from 'react'

// The one header: app navigation on the left, the table's status (LP, turn,
// phase) on the right when a scenario is open. On a phone the status gets a
// row of its own under the navigation.
export function TopBar({ nav, status }: { nav: ReactNode; status?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-line px-3 py-1.5 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">{nav}</div>
      {status && <div className="flex w-full justify-center sm:w-auto">{status}</div>}
    </header>
  )
}
