// Export, delete and import branches. An exported branch is a fork file, so
// it can be dropped straight into scenarios/.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseBranch, uniqueId } from '../../branches/branches'
import { cardDb } from '../../data/cards'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import { useBranchStore } from '../../store/branchStore'
import { usePlayerStore } from '../../store/playerStore'
import { MenuItem } from '../Menu/Menu'

// Menu items: a branch's export and delete.
export function BranchActions({ id }: { id: string }) {
  const { branches, remove } = useBranchStore()
  const [confirming, setConfirming] = useState(false)
  const branch = branches.find((b) => b.id === id)
  // Delete asks twice; the second ask lapses so a later click can't delete.
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(t)
  }, [confirming])
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
    <>
      <MenuItem onClick={exportJson}>Export branch JSON</MenuItem>
      {confirming ? (
        <MenuItem danger onClick={() => remove(id)}>
          Delete for good
        </MenuItem>
      ) : (
        <MenuItem danger data-keep-open onClick={() => setConfirming(true)}>
          Delete branch…
        </MenuItem>
      )}
    </>
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

  // A menu item; the error shows as a toast, outside the (closed) menu.
  return (
    <>
      <MenuItem onClick={() => input.current?.click()}>Import branch…</MenuItem>
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
      {error &&
        createPortal(
          <div role="alert" className="panel fixed bottom-[max(1rem,var(--safe-bottom))] left-1/2 z-50 flex max-w-[min(40rem,90vw)] -translate-x-1/2 items-center gap-3 px-4 py-2 text-sm text-danger">
            <span className="truncate" title={error}>
              Import failed: {error}
            </span>
            <button type="button" className="btn" onClick={() => setError(undefined)}>
              OK
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
