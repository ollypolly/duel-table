// A live lesson's controls in the scene panel: Next for queued steps, Back
// to live for a viewer who has scrubbed away, and Claude's open prompt.
import { useState } from 'react'
import type { Answer, LessonView, OpenPrompt } from '../../api/lesson'
import { CardMarkdown } from '../CardLink/CardLink'

type Props = {
  lesson: LessonView
  away: boolean
  onBackToLive: () => void
  onNext: () => void
  onAnswer: (answer: Answer) => void
}

export function LessonPanel({ lesson, away, onBackToLive, onNext, onAnswer }: Props) {
  return (
    <>
      {(away || lesson.queued > 0) && (
        <div className="flex items-center gap-2">
          {lesson.queued > 0 && (
            <button type="button" className="btn btn-primary" onClick={onNext}>
              Next ▸
            </button>
          )}
          {lesson.waiting === 'timer' && <span className="text-xs text-muted">or wait a moment…</span>}
          {away && (
            <button type="button" className="btn ml-auto" onClick={onBackToLive}>
              Back to live
            </button>
          )}
        </div>
      )}
      {lesson.prompt && lesson.queued === 0 && <PromptCard key={lesson.prompt.id} prompt={lesson.prompt} onAnswer={onAnswer} />}
    </>
  )
}

// What a lesson covers and the point it's on, under the playback bar: a
// segment per point, the current one named. Click it for the whole list.
export function LessonPlan({ plan }: { plan: { points: string[]; now: number } }) {
  const [open, setOpen] = useState(false)
  const { points, now } = plan
  const done = now >= points.length
  return (
    <div className="px-1" data-testid="lesson-plan">
      <button type="button" className="w-full space-y-1.5 rounded-md px-1 py-1 text-left hover:bg-raised" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex gap-1" aria-hidden>
          {points.map((p, i) => (
            <span key={p + i} className={`h-1 flex-1 rounded-full ${i < now ? 'bg-gold' : i === now ? 'bg-gold/60' : 'bg-line'}`} />
          ))}
        </span>
        <span className="flex items-baseline gap-2 text-xs">
          <span className="shrink-0 font-display font-bold uppercase tracking-wider text-gold">{done ? 'Lesson done' : `${now + 1} of ${points.length}`}</span>
          {!done && <span className="min-w-0 truncate text-ink">{points[now]}</span>}
        </span>
      </button>
      {open && (
        <ol className="mt-1 space-y-0.5 px-1 text-xs">
          {points.map((p, i) => (
            <li key={p + i} className={i < now ? 'text-muted line-through' : i === now ? 'font-semibold text-ink' : 'text-muted'}>
              {i + 1}. {p}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PromptCard({ prompt, onAnswer }: { prompt: OpenPrompt; onAnswer: (answer: Answer) => void }) {
  const [text, setText] = useState('')
  const answer = (a: Omit<Answer, 'id'> = {}) => onAnswer({ id: prompt.id, ...a })
  return (
    <div className="space-y-2.5 rounded-lg border border-gold/40 bg-gold/5 p-3" role="region" aria-label="Question from Claude" data-testid="prompt">
      <div className="prose-narration text-sm leading-relaxed text-ink">
        <CardMarkdown>{prompt.message}</CardMarkdown>
      </div>
      {prompt.type === 'ack' && (
        <button type="button" className="btn btn-primary" onClick={() => answer()}>
          {prompt.button ?? 'Got it'}
        </button>
      )}
      {prompt.type === 'choice' && (
        <div className="flex flex-col gap-1.5">
          {prompt.options.map((o, i) => (
            <button key={o} type="button" className="btn whitespace-normal! text-left" onClick={() => answer({ choice: i })}>
              {o}
            </button>
          ))}
        </div>
      )}
      {prompt.type === 'move' && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-muted">Make your move on the board, then</span>
          <button type="button" className="btn btn-primary" onClick={() => answer()}>
            Done
          </button>
        </div>
      )}
      {prompt.type === 'text' && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) answer({ text })
          }}
        >
          <textarea
            aria-label="Your answer"
            rows={2}
            className="w-full resize-y px-2 py-1.5 text-sm"
            placeholder={prompt.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), e.currentTarget.form?.requestSubmit())}
          />
          <button type="submit" className="btn btn-primary self-end" disabled={!text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  )
}
