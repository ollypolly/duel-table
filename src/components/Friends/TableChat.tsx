// The group chat at a game against a friend, with the game's question under it
// (as Claude's chat has). @claude brings Claude in; "Hide this message" sends it
// to Claude alone. The smiley menu plays a sound on both screens, or sticks an
// emoji on a card.
import { EyeOff, Lock, Send, Smile } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import { EMOJI, SOUNDS, type Sound, type TableView } from '../../api/table'
import { CardMarkdown } from '../CardLink/CardLink'
import { Menu, MenuItem, MenuLabel } from '../Menu/Menu'

const SOUND_LABEL: Record<Sound, string> = { laugh: '😆 Laugh', trombone: '🎺 Sad trombone', applause: '👏 Applause', drumroll: '🥁 Drumroll', gasp: '😮 Gasp', ding: '🛎️ Ding' }

const time = (at: string) => <time className="ml-1.5 whitespace-nowrap text-[10px] font-normal text-faint">{new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>

export function TableChatLog({ table, me, footer, footerKey }: { table: TableView; me?: string; footer?: ReactNode; footerKey?: string }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bottom = () => list.current?.scrollTo({ top: list.current.scrollHeight })
    bottom()
    const frame = requestAnimationFrame(bottom)
    return () => cancelAnimationFrame(frame)
  }, [table.chat.length, table.claudeTyping, footerKey])
  return (
    <div ref={list} role="log" aria-label="Chat" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3 text-sm">
      {table.chat.length === 0 && <p className="m-auto max-w-64 text-center text-xs text-muted">Say hello. Mention @claude to bring Claude in, or hide a message to ask Claude privately.</p>}
      {table.chat.map((m) => {
        const mine = m.from === me
        const claude = m.from === 'claude'
        return (
          <div key={m.id} className={`${mine ? 'ml-8 self-end bg-gold/15' : claude ? 'chat-md mr-8 bg-raised' : 'mr-8 bg-sky-500/10'} rounded-lg px-2.5 py-1.5`} data-testid="table-message">
            {!mine && <p className="text-xs font-semibold text-muted">{m.name}</p>}
            {claude ? <CardMarkdown>{m.text}</CardMarkdown> : <p className="whitespace-pre-wrap">{m.text}</p>}
            <p className="flex items-center justify-end gap-1 text-[10px] text-faint">
              {m.only && (
                <>
                  <Lock size={10} aria-hidden /> Only you and Claude
                </>
              )}
              {time(m.at)}
            </p>
          </div>
        )
      })}
      {table.claudeTyping && <p className="animate-pulse text-xs text-muted">Claude is thinking…</p>}
      {footer && <div className="mt-1.5 space-y-2.5 border-t border-line pt-2.5">{footer}</div>}
    </div>
  )
}

export function TableChatInput({ id, onSticker, report }: { id: string; onSticker: (emoji: string) => void; report: (p: Promise<unknown>) => void }) {
  const [text, setText] = useState('')
  const [hidden, setHidden] = useState(false)
  const send = () => {
    if (!text.trim()) return
    report(api.tableChat(id, text.trim(), hidden))
    setText('')
    setHidden(false)
  }
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <Menu side="top" className="btn px-2" title="Sounds and emoji" label={<Smile size={16} aria-label="Sounds and emoji" />}>
        <MenuLabel>Play on both screens</MenuLabel>
        {SOUNDS.map((s) => (
          <MenuItem key={s} onClick={() => report(api.tableFun(id, { sound: s }))}>
            {SOUND_LABEL[s]}
          </MenuItem>
        ))}
        <MenuLabel>Stick on a card</MenuLabel>
        <div className="grid grid-cols-5 gap-1 px-1 pb-1">
          {EMOJI.map((e) => (
            <MenuItem key={e} className="text-center text-lg" onClick={() => onSticker(e)} title="Then tap a card">
              {e}
            </MenuItem>
          ))}
        </div>
      </Menu>
      <button
        type="button"
        className={`btn px-2 ${hidden ? 'border-gold text-gold' : ''}`}
        aria-pressed={hidden}
        onClick={() => setHidden(!hidden)}
        title={hidden ? 'Only Claude will see this (and answer you alone)' : 'Hide this message: only Claude sees it, and answers you alone'}
      >
        <EyeOff size={16} aria-label="Hide this message" />
      </button>
      <input
        aria-label="Message"
        className="min-w-0 flex-1 px-2 py-1.5 text-sm"
        placeholder={hidden ? 'Ask Claude privately…' : 'Say something (@claude to ask Claude)…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn btn-primary px-2" aria-label="Send" disabled={!text.trim()}>
        <Send size={16} />
      </button>
    </form>
  )
}
