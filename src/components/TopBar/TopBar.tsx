import type { ReactNode } from 'react'

// The one header: app navigation on the left, the table's status (LP, turn,
// phase) on the right when a scenario is open. On a phone the status gets the
// top row to itself, and the navigation goes under it with bigger buttons.
// The top padding clears the status bar in the installed app, which draws
// under it.
export function TopBar({ nav, status }: { nav: ReactNode; status?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-3 pb-2 pt-[max(0.375rem,env(safe-area-inset-top))] sm:px-4 sm:pb-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:[&_.btn]:h-10 max-sm:[&_.btn]:px-3 max-sm:[&_.btn]:text-sm sm:gap-4">
        {nav}
      </div>
      {status && <div className="flex w-full justify-center max-sm:order-first sm:w-auto">{status}</div>}
    </header>
  )
}
