import type { ResolveResult } from '../../scenarios/resolve'

export function ScenarioPicker({
  results,
  value,
  onChange,
}: {
  results: ResolveResult[]
  value?: string
  onChange: (id: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-400">Scenario</span>
      <select
        className="max-w-[28rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Scenario"
      >
        {results.map((r) =>
          r.ok ? (
            <option key={r.scenario.id} value={r.scenario.id}>
              {r.scenario.title} ({r.scenario.game.steps.length} steps)
            </option>
          ) : (
            <option key={r.id} value={r.id}>
              ⚠ {r.id} (invalid)
            </option>
          ),
        )}
      </select>
    </label>
  )
}
