// An idea book in the header: write an idea down the moment you have it, and
// get back to what you were doing. Each idea is a page of its own that you
// can go back and change. They're kept on the server (sessions/ideas.json)
// to go through together later.
import { Check, Lightbulb, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Idea } from '../../api/ideas'

const DRAFT_KEY = 'duel-table:idea-draft'

// What you were writing survives closing the book or the tab.
const draft = {
  read: () => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? ''
    } catch {
      return ''
    }
  },
  write: (text: string) => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text)
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      // Then it's only kept while the page is open.
    }
  },
}

// A text box as tall as what's in it.
function Grow({ value, onChange, min, ...rest }: { value: string; onChange: (text: string) => void; min: string } & Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const fit = () => {
      box.style.height = 'auto'
      box.style.height = `${box.scrollHeight + 2}px`
    }
    fit()
    // Again when its width changes: the book opening, or the phone turning.
    let width = box.clientWidth
    const resized = new ResizeObserver(() => {
      if (box.clientWidth === width) return
      width = box.clientWidth
      fit()
    })
    resized.observe(box)
    return () => resized.disconnect()
  }, [value])
  return <textarea ref={ref} rows={1} {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={`block w-full resize-none px-2.5 py-2 text-sm leading-relaxed ${min} ${rest.className ?? ''}`} />
}

// One saved idea: change it in place, and it saves when you leave the box.
function Page({ idea, onSave, onDelete }: { idea: Idea; onSave: (text: string) => Promise<boolean>; onDelete: () => void }) {
  const [text, setText] = useState(idea.text)
  const [saved, setSaved] = useState(false)
  const changed = text.trim() !== idea.text
  const save = async () => {
    if (!changed || !text.trim()) return setText((t) => (t.trim() ? t : idea.text))
    if (await onSave(text.trim())) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }
  return (
    <li className="rounded-lg border border-line bg-surface">
      <Grow aria-label="Idea" min="min-h-10" className="border-0 bg-transparent" value={text} onChange={setText} onBlur={() => void save()} />
      <div className="flex items-center gap-2 px-2.5 pb-1.5 text-[11px] text-faint">
        <span className="min-w-0 flex-1 truncate">
          {new Date(idea.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {idea.where && ` · ${idea.where}`}
        </span>
        {saved && (
          <span className="flex items-center gap-1 text-gold">
            <Check size={11} aria-hidden /> Saved
          </span>
        )}
        {changed && !saved && <span>Saves when you click away</span>}
        <button type="button" className="rounded p-1 text-muted hover:bg-raised hover:text-danger" aria-label="Delete this idea" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  )
}

// where: what's open, saved with the idea so it's clear later what it was about.
export function Ideas({ where }: { where?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [text, setText] = useState(draft.read)
  const [error, setError] = useState('')
  // The last one deleted, to put back.
  const [gone, setGone] = useState<Idea>()

  useEffect(() => {
    void api.ideas().then(setIdeas, () => {})
  }, [])
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  const write = (t: string) => {
    setText(t)
    draft.write(t)
  }
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
  const add = async () => {
    if (!text.trim()) return
    // Kept in the box if it didn't save.
    if (await update(api.addIdea(text.trim(), where))) write('')
  }

  return (
    <>
      <button type="button" className="btn relative order-last flex shrink-0 items-center gap-1" title="Jot down an idea" aria-label="Ideas" onClick={() => setOpen(true)}>
        <Lightbulb size={14} className={text.trim() ? 'text-gold' : ''} aria-hidden />
        {ideas.length > 0 && <span className="text-xs tabular-nums text-muted">{ideas.length}</span>}
      </button>
      <dialog
        ref={ref}
        aria-label="Ideas"
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="panel m-auto h-[var(--safe-h)] max-h-none w-full max-w-none flex-col rounded-none p-0 text-ink max-sm:bg-bg! backdrop:bg-bg/70 backdrop:backdrop-blur-md open:flex sm:h-[calc(100%-3rem)] sm:w-[min(42rem,94vw)] sm:rounded-xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
          <Lightbulb size={16} className="text-gold" aria-hidden />
          <h2 className="flex-1 font-display text-lg font-semibold">Idea book</h2>
          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            <Grow
              autoFocus
              aria-label="A new idea"
              min="min-h-32"
              placeholder="A new idea: something to change or add, or that would help you learn…"
              value={text}
              onChange={write}
              onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void add()}
            />
            <div className="flex items-center gap-2">
              <p className={`min-w-0 flex-1 text-xs ${error ? 'text-danger' : 'text-faint'}`}>{error || 'One idea a page. Write it down and carry on: these are gone through together later.'}</p>
              <button type="submit" className="btn btn-primary shrink-0 text-sm" disabled={!text.trim()} title="Ctrl or ⌘ + Enter">
                Add to the book
              </button>
            </div>
          </form>
          {gone && (
            <p className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted">
              <span className="min-w-0 flex-1 truncate">Deleted “{gone.text}”</span>
              <button
                type="button"
                className="btn shrink-0 text-xs"
                onClick={() => {
                  void update(api.addIdea(gone.text, gone.where))
                  setGone(undefined)
                }}
              >
                Put it back
              </button>
            </p>
          )}
          <ul className="space-y-2.5" aria-label="Saved ideas">
            {ideas.toReversed().map((idea) => (
              <Page
                key={idea.id}
                idea={idea}
                onSave={(t) => update(api.changeIdea(idea.id, t))}
                onDelete={() => {
                  setGone(idea)
                  void update(api.removeIdea(idea.id))
                }}
              />
            ))}
          </ul>
          {ideas.length === 0 && <p className="py-6 text-center text-xs text-muted">The book is empty.</p>}
        </div>
      </dialog>
    </>
  )
}
