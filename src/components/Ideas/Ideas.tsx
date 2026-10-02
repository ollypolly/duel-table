// An idea book in the header: write an idea down the moment you have it, and
// get back to what you were doing. It opens on the book, a page per idea;
// New idea, or a page, opens a box to write in that fills the window. They're kept on the server (sessions/ideas.json)
// to go through together later.
import { ArrowLeft, Lightbulb, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

  // On a phone the book is pinned under the status bar, not centred, and with
  // the keyboard up it's as tall as what's left above it, so the top bar and
  // the button under the box both stay on screen.
  useEffect(() => {
    const dialog = ref.current
    const view = window.visualViewport
    if (!open || !dialog || !view || !window.matchMedia('(max-width: 639px)').matches) return
    const fit = () => {
      const keyboard = window.innerHeight - view.height > 80
      dialog.style.height = keyboard ? `calc(${view.height}px - var(--safe-top))` : ''
      dialog.style.translate = keyboard ? `0 ${view.offsetTop}px` : ''
    }
    fit()
    view.addEventListener('resize', fit)
    view.addEventListener('scroll', fit)
    return () => {
      view.removeEventListener('resize', fit)
      view.removeEventListener('scroll', fit)
      dialog.style.height = dialog.style.translate = ''
    }
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
  // What's being written: a new page, or a saved one. Otherwise the book is showing.
  const [writing, setWriting] = useState<'new' | Idea>()
  const [edit, setEdit] = useState('')
  const page = writing === 'new' ? undefined : writing
  const body = page ? edit : text
  const save = async () => {
    if (!body.trim()) return
    // Kept in the box if it didn't save.
    if (page) {
      if (body.trim() === page.text || (await update(api.changeIdea(page.id, body.trim())))) setWriting(undefined)
    } else if (await update(api.addIdea(body.trim(), where))) {
      write('')
      setWriting(undefined)
    }
  }
  const when = (at: number) => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <button type="button" className="btn relative order-last flex shrink-0 items-center gap-1" title="Your idea book" aria-label="Ideas" onClick={() => setOpen(true)}>
        <Lightbulb size={14} className={text.trim() ? 'text-gold' : ''} aria-hidden />
        {ideas.length > 0 && <span className="text-xs tabular-nums text-muted">{ideas.length}</span>}
      </button>
      <dialog
        ref={ref}
        aria-label="Ideas"
        onClose={() => {
          setOpen(false)
          setWriting(undefined)
        }}
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="panel m-auto h-[var(--safe-h)] max-h-none max-sm:my-0 w-full max-w-none flex-col rounded-none p-0 text-ink max-sm:bg-bg! backdrop:bg-bg/70 backdrop:backdrop-blur-md open:flex sm:h-[calc(100%-3rem)] sm:w-[min(42rem,94vw)] sm:rounded-xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
          {writing ? (
            <button type="button" className="-ml-1.5 rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Back to the book" onClick={() => setWriting(undefined)}>
              <ArrowLeft size={16} />
            </button>
          ) : (
            <Lightbulb size={16} className="text-gold" aria-hidden />
          )}
          <h2 className="flex-1 font-display text-lg font-semibold">{writing ? (page ? 'Idea' : 'New idea') : 'Idea book'}</h2>
          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        {writing ? (
          // A page to write on: the box takes all the room there is.
          <form
            className="flex min-h-0 flex-1 flex-col gap-2 p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <textarea
              key={page?.id ?? 'new'}
              autoFocus
              aria-label="Your idea"
              className="block min-h-0 w-full flex-1 resize-none px-3 py-2.5 text-sm leading-relaxed"
              placeholder="Something to change or add, or that would help you learn…"
              value={body}
              onChange={(e) => (page ? setEdit(e.target.value) : write(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void save()}
            />
            <div className="flex shrink-0 items-center gap-2">
              <p className={`min-w-0 flex-1 truncate text-xs ${error ? 'text-danger' : 'text-faint'}`}>{error || (page ? `${when(page.at)}${page.where ? ` · ${page.where}` : ''}` : 'What you write is kept if you go back.')}</p>
              {page && (
                <button
                  type="button"
                  className="btn flex shrink-0 items-center gap-1 text-sm hover:text-danger"
                  onClick={() => {
                    setGone(page)
                    setWriting(undefined)
                    void update(api.removeIdea(page.id))
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete
                </button>
              )}
              <button type="submit" className="btn btn-primary shrink-0 text-sm" disabled={!body.trim()} title="Ctrl or ⌘ + Enter">
                {page ? 'Save' : 'Add to the book'}
              </button>
            </div>
          </form>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            <button type="button" className="btn btn-primary flex w-full items-center justify-center gap-1.5 py-2 text-sm" onClick={() => setWriting('new')}>
              <Plus size={15} aria-hidden />
              {text.trim() ? 'Carry on with your draft' : 'New idea'}
            </button>
            {error && <p className="text-xs text-danger">{error}</p>}
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
                <li key={idea.id}>
                  <button
                    type="button"
                    className="block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:border-gold/60"
                    onClick={() => {
                      setEdit(idea.text)
                      setWriting(idea)
                    }}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{idea.text}</p>
                    <p className="mt-1 text-[11px] text-faint">
                      {when(idea.at)}
                      {idea.where && ` · ${idea.where}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {ideas.length === 0 && <p className="py-6 text-center text-xs text-muted">The book is empty. Write an idea down the moment you have it, and carry on: they're gone through together later.</p>}
          </div>
        )}
      </dialog>
    </>
  )
}
