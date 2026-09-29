import type { ReactNode } from 'react'

// Shown when a scenario file fails validation. Claude writes these files, so
// the errors are meant to be read and acted on, not hidden. A broken branch
// or live session (say its scenario changed underneath it) passes its own
// actions or advice as children.
export function ScenarioErrors({ id, errors, children }: { id: string; errors: string[]; children?: ReactNode }) {
  return (
    <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-danger/40 bg-danger/40 p-6" role="alert">
      <h2 className="text-lg font-semibold text-danger">
        <code>{children ? id : `scenarios/${id}.json`}</code> can't be loaded
      </h2>
      <ul className="mt-4 space-y-2 font-mono text-sm text-danger">
        {errors.map((e) => (
          <li key={e} className="whitespace-pre-wrap">
            {e}
          </li>
        ))}
      </ul>
      {children ? (
        <div className="mt-4 flex items-center gap-2 text-sm">{children}</div>
      ) : (
        <p className="mt-4 text-sm text-muted">Fix the file and save; it reloads automatically.</p>
      )}
    </div>
  )
}

export function EmptyState() {
  return (
    <div className="mx-auto mt-12 max-w-xl text-center text-muted">
      <p className="text-lg">No scenarios yet.</p>
      <p className="mt-2 text-sm">
        Add a JSON file to <code>scenarios/</code> (see PLAN.md for the format) and it appears here.
      </p>
    </div>
  )
}
