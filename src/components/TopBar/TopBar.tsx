import type { ReactNode } from 'react'

// The one header: app navigation on the left, what's open in the middle, and
// on the right the table's status (LP, turn, phase) when a scenario is open,
// then settings. On a phone the status gets the top row to itself, and the
// navigation goes under it with bigger buttons. Past a phone the navigation's
// items sit straight in the header's row (sm:contents), so one of them can be
// ordered after the status (sm:order-last).
// It's the same height with or without the status (a minimum height).
// The top padding clears the status bar in the installed app, which draws
// under it, and the fade iOS puts just below it.
export function TopBar({ nav, status }: { nav: ReactNode; status?: ReactNode }) {
  return (
    <header className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-3 pb-2 pt-[max(0.375rem,calc(var(--safe-top)+0.75rem))] sm:min-h-[4.0625rem] sm:gap-x-4 sm:px-4 sm:pb-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:[&_.btn]:h-10 max-sm:[&_.btn]:px-3 max-sm:[&_.btn]:text-sm sm:contents">
        {nav}
      </div>
      <div className="flex-1 max-sm:hidden sm:order-5" />
      {status && <div className="flex w-full justify-center max-sm:order-first sm:order-6 sm:w-auto">{status}</div>}
    </header>
  )
}
