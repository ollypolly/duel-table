// Export, delete and import branches. An exported branch is a fork file, so
// it can be dropped straight into scenarios/.
import { useRef, useState } from 'react'
import { parseBranch, uniqueId } from '../../branches/branches'
import { cardDb } from '../../data/cards'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import { useBranchStore } from '../../store/branchStore'
import { usePlayerStore } from '../../store/playerStore'

const btn = 'rounded-md bg-raised px-2 py-1 text-xs hover:bg-raised-hover'

export function BranchActions({ id }: { id: string }) {
  const { branches, remove } = useBranchStore()
  const [confirming, setConfirming] = useState(false)
  const branch = branches.find((b) => b.id === id)
  if (!branch) return null

  const exportJson = () => {
    const blob = new Blob([`${JSON.stringify(branch, null, 2)}\n`], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${branch.id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <span className="flex items-center gap-2">
      <button type="button" className={btn} onClick={exportJson}>
        Export JSON
      </button>
      {confirming ? (
        <>
          <button type="button" className="btn bg-danger text-bg hover:bg-danger/80" onClick={() => remove(id)}>
            Delete for good
          </button>
          <button type="button" className={btn} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <button type="button" className={btn} onClick={() => setConfirming(true)}>
          Delete branch
        </button>
      )}
    </span>
  )
}

export function ImportBranch({ takenIds }: { takenIds: string[] }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const { branches, add } = useBranchStore()
  const open = usePlayerStore((s) => s.open)

  const onFile = async (file: File) => {
    setError(undefined)
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      setError(`${file.name} isn't valid JSON`)
      return
    }
    const parsed = parseBranch(raw)
    if (!parsed.ok) {
      setError(parsed.errors.join('; '))
      return
    }
    const branch = { ...parsed.branch, id: uniqueId(parsed.branch.id, takenIds) }
    const scenarios = { ...rawScenarios, ...Object.fromEntries(branches.map((b) => [b.id, b])), [branch.id]: branch }
    const r = resolveScenario(branch, { db: cardDb, decks: rawDecks, scenarios })
    if (!r.ok) {
      setError(r.errors.join('; '))
      return
    }
    add(branch)
    open(branch.id, r.scenario.game.steps.length)
  }

  return (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm">
      {error && (
        <span role="alert" className="max-w-md truncate text-xs text-danger" title={error}>
          Import failed: {error}
        </span>
      )}
      <button type="button" className={btn} onClick={() => input.current?.click()}>
        Import branch
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import branch file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onFile(file)
          e.target.value = ''
        }}
      />
    </span>
  )
}
