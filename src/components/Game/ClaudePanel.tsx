// Claude, when it plays one side, coaches you against a bot, tutors a lesson or reviews a game. The chat log fills the
// middle of the scene panel: what it says, with its moves and the app's notes
// in among it. The input bar sits at the bottom with Stop/Resume and a
// settings menu: the model, coaching and what to send it (in a game), and the
// cost so far (what the same tokens would cost on the API; on a Claude plan it
// comes out of your usage).
import { Check, Eye, Loader2, LogOut, Pause, Play, RotateCcw, Send, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import type { ChatEntry, ClaudeSettings, ClaudeView, ModelChoice } from '../../api/game'
import { CardMarkdown, CardText } from '../CardLink/CardLink'
import { Menu, MenuItem, MenuLabel } from '../Menu/Menu'
import { scrollLogTo } from './chatScroll'

const STYLE = {
  you: 'ml-8 self-end rounded-lg bg-gold/15 px-2.5 py-1.5',
  claude: 'mr-8 rounded-lg bg-raised px-2.5 py-1.5',
  move: 'text-xs text-muted',
  note: 'text-xs text-warn',
}

const MODELS: [ModelChoice, string][] = [
  ['opus', 'Opus (strongest)'],
  ['sonnet', 'Sonnet (faster, lighter on usage)'],
]

// earlier: a chat that came before this one (the game's, above a review), dimmed.
// footer: what you're being asked, after the last message, so it scrolls away
// with the chat; footerKey changes when it does, to bring it into view.
// outlines: in a review, a class per moment step, for Claude's messages on it.
type ChatProps = {
  claude: Pick<ClaudeView, 'chat'> & { status: ClaudeView['status'] }
  empty?: string
  earlier?: { chat: ChatEntry[]; divider: string }
  footer?: ReactNode
  footerKey?: string
  outlines?: Record<number, string>
}

// When an entry was said, small and after it.
function Time({ at }: { at?: number }) {
  if (!at) return null
  return <time className="ml-1.5 whitespace-nowrap text-[10px] font-normal text-faint">{new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
}

function Entry({ e, outline = '', anchor }: { e: ChatEntry; outline?: string; anchor?: Ref<HTMLElement> }) {
  return e.from === 'claude' ? (
    <div ref={anchor as Ref<HTMLDivElement>} className={`chat-md ${STYLE.claude} ${outline}`} data-moment={e.moment}>
      <CardMarkdown>{e.text}</CardMarkdown>
      <Time at={e.at} />
    </div>
  ) : (
    <p ref={anchor as Ref<HTMLParagraphElement>} className={`whitespace-pre-wrap ${STYLE[e.from]}`} data-moment={e.moment}>
      {e.from === 'move' ? <CardText>{`Claude: ${e.text}`}</CardText> : e.text}
      <Time at={e.at} />
    </p>
  )
}

export function ClaudeChat({ claude, empty = 'Claude is across the table. Say hello, or ask it anything about the game.', earlier, footer, footerKey, outlines }: ChatProps) {
  const list = useRef<HTMLDivElement>(null)
  const { chat, status } = claude
  // A new message from Claude is read from its top, so the chat goes there
  // (and to a moment's note, with the answer to come under it) and stays put.
  // Anything else new is followed at the bottom.
  const last = chat.at(-1)
  const moment = last?.moment
  const afterNote = last?.from === 'claude' && !!moment && chat.at(-2)?.from === 'note' && chat.at(-2)?.moment === moment
  const anchorAt = last?.from === 'claude' ? chat.length - (afterNote ? 2 : 1) : moment ? chat.length - 1 : -1
  const anchor = useRef<HTMLElement>(null)
  const seen = useRef(-1)
  useEffect(() => {
    const fresh = seen.current !== chat.length
    seen.current = chat.length
    if (anchorAt < 0) list.current?.scrollTo({ top: list.current.scrollHeight })
    else if (fresh && anchor.current) scrollLogTo(anchor.current)
  }, [chat.length, status, footerKey, anchorAt])

  return (
    <div ref={list} role="log" aria-label="Chat with Claude" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3 text-sm">
      {earlier && earlier.chat.length > 0 && (
        <>
          <div className="flex flex-col gap-1.5 opacity-60">
            {earlier.chat.map((e, i) => (
              <Entry key={i} e={e} />
            ))}
          </div>
          <p className="my-1 flex items-center gap-2 text-xs text-gold before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">{earlier.divider}</p>
        </>
      )}
      {chat.length === 0 && <p className="m-auto max-w-60 text-center text-xs text-muted">{empty}</p>}
      {chat.map((e, i) => (
        <Entry key={i} e={e} outline={e.moment ? outlines?.[e.moment] : undefined} anchor={i === anchorAt ? anchor : undefined} />
      ))}
      {status === 'thinking' &&
        (moment ? (
          <p className={`flex animate-pulse items-center gap-2 ${STYLE.claude} ${outlines?.[moment] ?? ''}`}>
            <Loader2 size={14} className="animate-spin" /> Claude is going through this moment…
          </p>
        ) : (
          <p className="animate-pulse text-xs text-muted">Claude is thinking…</p>
        ))}
      {status === 'stopped' && <p className="text-xs text-warn">Stopped. Resume, or say something, to carry on.</p>}
      {footer && <div className="mt-1.5 space-y-2.5 border-t border-line pt-2.5">{footer}</div>}
    </div>
  )
}

// A menu item with a tick when it's on.
function Checked({ on, role, onClick, children }: { on: boolean; role: 'menuitemradio' | 'menuitemcheckbox'; onClick: () => void; children: ReactNode }) {
  return (
    <MenuItem role={role} aria-checked={on} onClick={onClick}>
      <span className="flex items-center gap-2">
        <Check size={14} className={on ? 'text-gold' : 'invisible'} aria-hidden />
        {children}
      </span>
    </MenuItem>
  )
}

// A lesson's tutor and a review have no coaching or sharing to set (nor has a
// coach beside you, who may know the bot's deck instead), never
// wait stopped, and can start over instead. A review can also be left (onEnd).
type InputProps = {
  claude: Pick<ClaudeView, 'model' | 'costUsd'> & Partial<Pick<ClaudeView, 'coach' | 'share' | 'knowsDeck'>> & { status: ClaudeView['status'] }
  placeholder?: string
  onChat: (text: string) => void
  onStop: () => void
  onResume?: () => void
  onSettings: (s: ClaudeSettings) => void
  onClear?: () => void
  onEnd?: { label: string; run: () => void }
}

export function ClaudeInput({ claude, placeholder = 'Say something to Claude…', onChat, onStop, onResume, onSettings, onClear, onEnd }: InputProps) {
  const [text, setText] = useState('')
  const { status } = claude
  const send = () => {
    if (!text.trim()) return
    onChat(text.trim())
    setText('')
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <Menu
        side="top"
        className="btn flex items-center gap-1 px-2"
        title="Claude settings"
        label={
          <>
            <Settings2 size={16} aria-label="Claude settings" />
            {claude.share && <Eye size={14} className="text-gold" aria-label="Claude can see your cards" />}
          </>
        }
      >
        <MenuLabel>Model</MenuLabel>
        {MODELS.map(([m, label]) => (
          <Checked key={m} role="menuitemradio" on={claude.model === m} onClick={() => onSettings({ model: m })}>
            {label}
          </Checked>
        ))}
        {claude.coach !== undefined && (
          <>
            <MenuLabel>Claude</MenuLabel>
            <Checked role="menuitemcheckbox" on={claude.coach} onClick={() => onSettings({ coach: !claude.coach })}>
              Coach me
            </Checked>
          </>
        )}
        {claude.knowsDeck !== undefined && (
          <>
            <MenuLabel>Claude</MenuLabel>
            <Checked role="menuitemcheckbox" on={claude.knowsDeck} onClick={() => onSettings({ knowsDeck: !claude.knowsDeck })}>
              Knows the bot's deck
            </Checked>
          </>
        )}
        {claude.share !== undefined && (
          <>
            <MenuLabel>Send Claude</MenuLabel>
            <Checked role="menuitemcheckbox" on={claude.share} onClick={() => onSettings({ share: !claude.share })}>
              My hidden cards and question
            </Checked>
          </>
        )}
        {onClear && (
          <MenuItem onClick={onClear}>
            <span className="flex items-center gap-2">
              <RotateCcw size={14} aria-hidden />
              Start over
            </span>
          </MenuItem>
        )}
        {onEnd && (
          <MenuItem onClick={onEnd.run}>
            <span className="flex items-center gap-2">
              <LogOut size={14} aria-hidden />
              {onEnd.label}
            </span>
          </MenuItem>
        )}
        <p className="mt-1 border-t border-line px-2.5 pb-1 pt-2 text-xs text-muted" title="On a Claude plan this comes out of your usage instead.">
          ≈ ${claude.costUsd.toFixed(2)} API-equivalent so far
        </p>
      </Menu>
      <input
        aria-label="Message Claude"
        className="min-w-0 flex-1 px-2 py-1.5 text-sm"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {status === 'stopped' && onResume ? (
        <button type="button" className="btn px-2" onClick={onResume} aria-label="Resume" title="Resume">
          <Play size={16} />
        </button>
      ) : status === 'thinking' ? (
        <button type="button" className="btn px-2" onClick={onStop} aria-label="Stop" title="Stop Claude">
          <Pause size={16} />
        </button>
      ) : null}
      <button type="submit" className="btn btn-primary px-2" disabled={!text.trim()} aria-label="Send" title="Send">
        <Send size={16} />
      </button>
    </form>
  )
}
