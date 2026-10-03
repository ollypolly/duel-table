// Claude on the home page: a box to start a chat about what to play and
// learn, with the ones you've had listed under it. A chat opens on its own
// page (?chat=<id>), filling the window; it's polled while Claude is
// answering, so the reply shows as it's written.
import { useMine } from '../../store/accountStore'
import { ArrowLeft, MoreHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { ModelChoice } from '../../api/game'
import type { HomeThread, HomeView } from '../../api/home'
import { usePlayerStore } from '../../store/playerStore'
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

const remember = (m: ModelChoice) => {
  try {
    localStorage.setItem(MODEL_KEY, m)
  } catch {
    // The choice just isn't remembered.
  }
}

export function ChatPage({ id }: { id: string }) {
  const goHome = usePlayerStore((s) => s.goHome)
  const [view, setView] = useState<HomeView>()
  const [error, setError] = useState('')

  useEffect(() => {
    void api.homeThread(id).then(setView, (e: Error) => setError(e.message))
  }, [id])
  const thinking = view?.status === 'thinking'
  useEffect(() => {
    if (!thinking) return
    const timer = setInterval(() => void api.homeThread(id).then(setView, () => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [id, thinking])

  const update = (p: Promise<HomeView>) =>
    void p.then(
      (v) => {
        setView(v)
        setError('')
      },
      (e: Error) => setError(e.message),
    )

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="home-chat">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-6">
        <button type="button" className="btn flex items-center gap-1.5 text-xs" onClick={goHome}>
          <ArrowLeft size={13} aria-hidden />
          Chats
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold">{view?.title}</h2>
      </header>
      {view ? <ClaudeChat claude={view} wide empty="Ask Claude anything about what to play or learn." /> : <div className="flex-1" />}
      {error && <p className="px-3 text-xs text-danger sm:px-6">{error}</p>}
      {view && (
        <div className="border-t border-line p-2 pb-[max(0.5rem,var(--safe-bottom))] sm:px-[max(1.5rem,calc((100%-64rem)/2))]">
          <ClaudeInput
            claude={view}
            placeholder="Ask Claude…"
            onChat={(text) => update(api.askHome(id, text))}
            onStop={() => update(api.stopHome(id))}
            onSettings={(s) => {
              if (!s.model) return
              remember(s.model)
              update(api.changeHome(id, { model: s.model }))
            }}
          />
        </div>
      )}
    </section>
  )
}

export function HomeChat() {
  const openChat = usePlayerStore((s) => s.openChat)
  const [all, setThreads] = useState<HomeThread[]>([])
  // Your own chats; anyone else's are theirs.
  const mine = useMine()
  const threads = all.filter((t) => mine(t.owner))
  const [model, setModel] = useState(savedModel)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; title: string }>()

  const refresh = () => void api.homeThreads().then(setThreads)
  useEffect(refresh, [])

  const start = (text: string) =>
    void api.startHome(text, model).then(
      (v) => openChat(v.id),
      (e: Error) => setError(e.message),
    )
  const pick = (m: ModelChoice) => {
    setModel(m)
    remember(m)
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
        onChat={start}
        onStop={() => {}}
        onSettings={(s) => s.model && pick(s.model)}
      />
      <div className="flex flex-wrap gap-1.5">
        {IDEAS.map((idea) => (
          <button key={idea} type="button" className="btn text-xs text-muted" onClick={() => start(idea)}>
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
                <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 py-2 text-left text-sm hover:text-gold" onClick={() => openChat(t.id)}>
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
