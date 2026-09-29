import type { ResolveResult } from "../../scenarios/resolve";

const Option = ({ r }: { r: ResolveResult }) =>
  r.ok ? (
    <option value={r.scenario.id}>
      {r.scenario.title} ({r.scenario.game.steps.length} steps)
    </option>
  ) : (
    <option value={r.id}>⚠ {r.id} (invalid)</option>
  );

export function ScenarioPicker({
  scenarios,
  branches,
  value,
  onChange,
}: {
  scenarios: ResolveResult[];
  branches: ResolveResult[];
  value?: string;
  onChange: (id: string) => void;
}) {
  const key = (r: ResolveResult) => (r.ok ? r.scenario.id : r.id);
  return (
    <select
      className="min-w-0 max-w-[20rem] flex-1 rounded-md sm:flex-none border border-line bg-surface px-2 py-1 text-sm text-ink"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Scenario"
    >
      <optgroup label="Scenarios">
        {scenarios.map((r) => (
          <Option key={key(r)} r={r} />
        ))}
      </optgroup>
      {branches.length > 0 && (
        <optgroup label="Your branches">
          {branches.map((r) => (
            <Option key={key(r)} r={r} />
          ))}
        </optgroup>
      )}
    </select>
  );
}
