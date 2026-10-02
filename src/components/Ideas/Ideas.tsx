// A scratch pad in the header: write an idea down the moment you have it, and
// get back to what you were doing. They're kept on the server (sessions/ideas.json)
// to go through together later.
import { Lightbulb, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Idea } from '../../api/ideas'

// where: what's open, saved with the idea so it's clear later what it was about.
export function Ideas({ where }: { where?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void api.ideas().then(setIdeas, () => {})
  }, [])
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  const update = (p: Promise<Idea[]>) =>
    p.then(
      (all) => {
        setIdeas(all)
        setError('')
        return true
      },
      (e: Error) => {
        setError(e.message)
        return false
      },
    )
  const save = async () => {
    if (!text.trim()) return
    // Kept in the box if it didn't save.
    if (await update(api.addIdea(text.trim(), where))) setText('')
  }

  return (
    <>
      <button type="button" className="btn relative order-last flex shrink-0 items-center gap-1" title="Jot down an idea" aria-label="Ideas" onClick={() => setOpen(true)}>
        <Lightbulb size={14} aria-hidden />
        {ideas.length > 0 && <span className="text-xs tabular-nums text-muted">{ideas.length}</span>}
      </button>
      <dialog
        ref={ref}
        aria-label="Ideas"
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="panel m-auto max-h-[min(40rem,90dvh)] w-[min(30rem,94vw)] flex-col p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md open:flex"
      >
        <div className="flex shrink-0 items-center border-b border-line px-5 py-3">
          <h2 className="flex-1 font-display text-lg font-semibold">Ideas</h2>
          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <form
          className="shrink-0 space-y-2 border-b border-line p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <p className="text-sm text-muted">Write it down and carry on. These are kept to go through together later.</p>
          <textarea
            autoFocus
            aria-label="Your idea"
            className="block min-h-20 w-full px-2 py-1.5 text-sm"
            placeholder="Something to change, add, or that would help you learn…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void save()}
          />
          <div className="flex items-center gap-2">
            {error && <p className="min-w-0 flex-1 text-xs text-danger">{error}</p>}
            <button type="submit" className="btn btn-primary ml-auto text-sm" disabled={!text.trim()}>
              Save
            </button>
          </div>
        </form>
        <ul className="min-h-16 divide-y divide-line overflow-y-auto px-5" aria-label="Saved ideas">
          {ideas.length === 0 && <li className="py-4 text-center text-xs text-muted">Nothing saved yet.</li>}
          {ideas.toReversed().map((idea) => (
            <li key={idea.id} className="flex items-start gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm">{idea.text}</p>
                <p className="text-[11px] text-faint">
                  {new Date(idea.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {idea.where && ` · ${idea.where}`}
                </p>
              </div>
              <button type="button" className="rounded p-1 text-muted hover:bg-raised hover:text-danger" aria-label="Delete this idea" onClick={() => void update(api.removeIdea(idea.id))}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  )
}
