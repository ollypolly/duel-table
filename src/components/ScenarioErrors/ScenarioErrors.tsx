// Shown when a scenario file fails validation. Claude writes these files, so
// the errors are meant to be read and acted on, not hidden.
export function ScenarioErrors({ id, errors }: { id: string; errors: string[] }) {
  return (
    <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-red-500/40 bg-red-950/40 p-6" role="alert">
      <h2 className="text-lg font-semibold text-red-200">
        <code>scenarios/{id}.json</code> can't be loaded
      </h2>
      <ul className="mt-4 space-y-2 font-mono text-sm text-red-100">
        {errors.map((e) => (
          <li key={e} className="whitespace-pre-wrap">
            {e}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-slate-400">Fix the file and save; it reloads automatically.</p>
    </div>
  )
}

export function EmptyState() {
  return (
    <div className="mx-auto mt-12 max-w-xl text-center text-slate-400">
      <p className="text-lg">No scenarios yet.</p>
      <p className="mt-2 text-sm">
        Add a JSON file to <code>scenarios/</code> (see PLAN.md for the format) and it appears here.
      </p>
    </div>
  )
}
