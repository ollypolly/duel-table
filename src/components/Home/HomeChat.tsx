// Claude on the home page: a chat about what to play and learn. It opens on
// a new chat; the ones you've had are listed under it to go back to. The
// open chat is polled while Claude is answering, so the reply shows as it's
// written.
import { ArrowLeft, MoreHorizontal, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { ModelChoice } from '../../api/game'
import type { HomeThread, HomeView } from '../../api/home'
import { ClaudeChat, ClaudeInput } from '../Game/ClaudePanel'
import { Menu, MenuItem } from '../Menu/Menu'
import { when } from './names'

const POLL_MS = 1000
const MODEL_KEY = 'duel-table:home-model'
const IDEAS = ['What deck should I learn next?', 'What am I getting wrong in my games?', 'Show me how my deck wins']

const savedModel = (): ModelChoice => {
  try {
    const m = localStorage.getItem(MODEL_KEY)
    return m === 'opus' || m === 'sonnet' ? m : 'haiku'
  } catch {
    return 'haiku'
  }
}

export function HomeChat() {
  const [threads, setThreads] = useState<HomeThread[]>([])
  const [view, setView] = useState<HomeView>()
  const [model, setModel] = useState(savedModel)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; title: string }>()

  const refresh = () => void api.homeThreads().then(setThreads)
  useEffect(refresh, [])

  const id = view?.id
  const thinking = view?.status === 'thinking'
  useEffect(() => {
    if (!id || !thinking) return
    const timer = setInterval(() => void api.homeThread(id).then(setView, () => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [id, thinking])

  const update = (p: Promise<HomeView>) =>
    void p.then(
      (v) => {
        setView(v)
        setError('')
        refresh()
      },
      (e: Error) => setError(e.message),
    )
  const pick = (m: ModelChoice) => {
    setModel(m)
    try {
      localStorage.setItem(MODEL_KEY, m)
    } catch {
      // The choice just isn't remembered.
    }
  }

  if (view) {
    return (
      <section className="panel flex h-[min(46rem,85dvh)] flex-col overflow-hidden" data-testid="home-chat">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button type="button" className="btn flex items-center gap-1.5 text-xs" onClick={() => setView(undefined)}>
            <ArrowLeft size={13} aria-hidden />
            Chats
          </button>
          <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold">{view.title}</h2>
          <button type="button" className="btn flex items-center gap-1.5 text-xs" onClick={() => setView(undefined)}>
            <Plus size={13} aria-hidden />
            New chat
          </button>
        </header>
        <ClaudeChat claude={view} empty="Ask Claude anything about what to play or learn." />
        {error && <p className="px-3 text-xs text-danger">{error}</p>}
        <div className="border-t border-line p-2">
          <ClaudeInput
            claude={view}
            placeholder="Ask Claude…"
            onChat={(text) => update(api.askHome(view.id, text))}
            onStop={() => update(api.stopHome(view.id))}
            onSettings={(s) => {
              if (!s.model) return
              pick(s.model)
              update(api.changeHome(view.id, { model: s.model }))
            }}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="panel space-y-3 p-4" data-testid="home-chat">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
        <Sparkles size={15} className="text-gold" aria-hidden />
        Ask Claude
      </h2>
      <ClaudeInput
        claude={{ model, costUsd: 0, status: 'idle' }}
        placeholder="What deck should I learn next?"
        onChat={(text) => update(api.startHome(text, model))}
        onStop={() => {}}
        onSettings={(s) => s.model && pick(s.model)}
      />
      <div className="flex flex-wrap gap-1.5">
        {IDEAS.map((idea) => (
          <button key={idea} type="button" className="btn text-xs text-muted" onClick={() => update(api.startHome(idea, model))}>
            {idea}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {threads.length > 0 && (
        <ul className="divide-y divide-line border-t border-line" aria-label="Your chats">
          {threads.map((t) =>
            renaming?.id === t.id ? (
              <li key={t.id}>
                <form
                  className="flex items-center gap-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!renaming.title.trim()) return
                    void api.changeHome(t.id, { title: renaming.title.trim() }).then(() => {
                      setRenaming(undefined)
                      refresh()
                    })
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Chat name"
                    className="min-w-0 flex-1 px-2 py-1 text-sm"
                    value={renaming.title}
                    onChange={(e) => setRenaming({ id: t.id, title: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(undefined)}
                  />
                  <button type="submit" className="btn text-xs">
                    Save
                  </button>
                </form>
              </li>
            ) : (
              <li key={t.id} className="flex items-center gap-2 has-[[aria-expanded=true]]:relative has-[[aria-expanded=true]]:z-20">
                <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 py-2 text-left text-sm hover:text-gold" onClick={() => update(api.homeThread(t.id))}>
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-faint">{when(new Date(t.updatedAt).toISOString())}</span>
                </button>
                <Menu label={<MoreHorizontal size={14} />} title={`More for ${t.title}`} align="right">
                  <MenuItem onClick={() => setRenaming({ id: t.id, title: t.title })}>Rename</MenuItem>
                  <MenuItem danger onClick={() => void api.deleteHome(t.id).then(refresh, (e: Error) => setError(e.message))}>
                    Delete
                  </MenuItem>
                </Menu>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
