// Claude, when it plays one side: the chat with it (its moves and the app's
// notes in among what it says), Stop/Resume, and its model and coach
// settings. Cost is what the same tokens would cost on the API; on a Claude
// plan it comes out of your usage instead.
import { Pause, Play, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ClaudeSettings, ClaudeView, ModelChoice } from '../../api/game'

type Props = {
  claude: ClaudeView
  onChat: (text: string) => void
  onStop: () => void
  onResume: () => void
  onSettings: (s: ClaudeSettings) => void
}

const STYLE = {
  you: 'ml-8 self-end rounded-lg bg-gold/15 px-2.5 py-1.5',
  claude: 'mr-8 rounded-lg bg-raised px-2.5 py-1.5',
  move: 'text-xs text-muted',
  note: 'text-xs text-warn',
}

export function ClaudePanel({ claude, onChat, onStop, onResume, onSettings }: Props) {
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const { chat, status } = claude
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [chat.length, status])

  const send = () => {
    if (!text.trim()) return
    onChat(text.trim())
    setText('')
  }

  return (
    <section aria-label="Claude" className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <select aria-label="Model" className="px-1.5 py-0.5" value={claude.model} onChange={(e) => onSettings({ model: e.target.value as ModelChoice })}>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" className="accent-gold" checked={claude.coach} onChange={(e) => onSettings({ coach: e.target.checked })} />
            Coach
          </label>
          <label className="flex cursor-pointer items-center gap-1" title="Claude sees your hidden cards (hand, face-down cards, Extra Deck) and what you're being asked, so it can advise on the best play">
            <input type="checkbox" className="accent-gold" checked={claude.share} onChange={(e) => onSettings({ share: e.target.checked })} />
            Show my cards
          </label>
        </span>
        <span title="What these tokens would cost on the API. On a Claude plan they come out of your usage instead.">≈ ${claude.costUsd.toFixed(2)} API-equivalent</span>
      </div>
      <div ref={list} role="log" aria-label="Chat with Claude" className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-sm">
        {chat.map((e, i) => (
          e.from === 'claude' ? (
            <div key={i} className={`chat-md ${STYLE.claude}`}>
              <Markdown remarkPlugins={[remarkGfm]}>{e.text}</Markdown>
            </div>
          ) : (
            <p key={i} className={`whitespace-pre-wrap ${STYLE[e.from]}`}>
              {e.from === 'move' ? `Claude: ${e.text}` : e.text}
            </p>
          )
        ))}
        {status === 'thinking' && <p className="animate-pulse text-xs text-muted">Claude is thinking…</p>}
        {status === 'stopped' && <p className="text-xs text-warn">Stopped. Resume, or say something, to carry on.</p>}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          aria-label="Message Claude"
          className="min-w-0 flex-1 px-2 py-1 text-sm"
          placeholder="Say something to Claude…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn px-2" disabled={!text.trim()} aria-label="Send" title="Send">
          <Send size={16} />
        </button>
        {status === 'stopped' ? (
          <button type="button" className="btn px-2" onClick={onResume} aria-label="Resume" title="Resume">
            <Play size={16} />
          </button>
        ) : (
          <button type="button" className="btn px-2" onClick={onStop} disabled={status !== 'thinking'} aria-label="Stop" title="Stop Claude">
            <Pause size={16} />
          </button>
        )}
      </form>
    </section>
  )
}
