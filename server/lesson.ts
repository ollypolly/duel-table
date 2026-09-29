// A session's lesson runtime: which steps the viewer can see yet, where the
// presenter wants them looking, the open prompt, and a log of what the
// viewer did for Claude to long-poll. Kept in memory: after a restart every
// step is shown and the log starts again.
import type { Step } from '../src/engine'
import type { Answer, Cursor, LessonEvent, LessonView, OpenPrompt, Prompt, Reveal } from '../src/api/lesson'
import { SessionError } from './errors'

const LOG_LIMIT = 1000

// Distributive, so each event type keeps its own fields.
type NewEvent = LessonEvent extends infer E ? (E extends LessonEvent ? Omit<E, 'seq'> : never) : never

export class Lesson {
  private queue: Reveal[] = [] // one per queued step, in order
  private revealed: number
  private cursor: Cursor
  private prompt?: OpenPrompt
  private promptCount = 0
  private log: LessonEvent[] = []
  private seq = 0
  private waiters = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private onChange: () => void

  constructor(steps: number, onChange: () => void) {
    this.revealed = steps
    this.cursor = { position: steps, seq: 0 }
    this.onChange = onChange
  }

  view(): LessonView {
    const head = this.queue[0]
    return {
      revealed: this.revealed,
      queued: this.queue.length,
      ...(head && { waiting: head === 'onNext' ? 'next' : 'timer' }),
      cursor: this.cursor,
      ...(this.prompt && { prompt: this.prompt }),
    }
  }

  get total() {
    return this.revealed + this.queue.length
  }

  // A step was appended at position (= total + 1).
  added(step: Step, position: number, reveal?: Reveal) {
    if (step.author === 'user') this.emit({ type: 'step', position, step })
    if (!reveal && this.queue.length === 0) this.reveal('now')
    else {
      this.queue.push(reveal ?? { afterMs: 0 })
      this.pump()
    }
  }

  // The last step was dropped.
  removed(byUser: boolean) {
    if (this.queue.length) {
      this.queue.pop()
      if (this.queue.length === 0) this.clearTimer()
    } else {
      this.revealed--
      this.moveCursor({ position: this.revealed })
    }
    if (byUser) this.emit({ type: 'undo', position: this.total })
  }

  // The viewer's Next: shows the first queued step, whatever it waits for.
  next() {
    if (!this.queue.length) throw new SessionError(409, 'nothing is queued')
    this.clearTimer()
    this.queue.shift()
    this.reveal('next')
    this.pump()
  }

  present(to: { position: number; from?: number }) {
    const { position, from } = to
    if (position > this.revealed) throw new SessionError(400, `position must be 0-${this.revealed} (steps after that aren't shown yet)`)
    if (from !== undefined && from >= position) throw new SessionError(400, 'from must be before position')
    this.moveCursor({ position, ...(from !== undefined && { from }) })
  }

  ask(prompt: Prompt): OpenPrompt {
    if (this.prompt) throw new SessionError(409, `prompt ${this.prompt.id} is still open (DELETE /prompt to withdraw it)`)
    this.prompt = { ...prompt, id: `q-${++this.promptCount}`, openedAt: this.total }
    return this.prompt
  }

  withdraw() {
    if (!this.prompt) throw new SessionError(409, 'no prompt is open')
    this.prompt = undefined
  }

  answer(a: Answer) {
    const p = this.prompt
    if (!p || p.id !== a.id) throw new SessionError(409, `prompt ${a.id} isn't open`)
    if (this.queue.length) throw new SessionError(409, "the prompt isn't showing yet: steps are still queued")
    const base = { type: 'answer' as const, prompt: { id: p.id, type: p.type } }
    if (p.type === 'choice') {
      if (a.choice === undefined || a.choice >= p.options.length) throw new SessionError(400, `choice must be 0-${p.options.length - 1}`)
      this.emit({ ...base, choice: { index: a.choice, option: p.options[a.choice] } })
    } else if (p.type === 'text') {
      if (!a.text?.trim()) throw new SessionError(400, 'text is required')
      this.emit({ ...base, text: a.text })
    } else if (p.type === 'move') {
      this.emit({ ...base, steps: Array.from({ length: this.total - p.openedAt }, (_, i) => p.openedAt + i + 1) })
    } else this.emit(base)
    this.prompt = undefined
  }

  // Events after since (default: now), waiting up to timeoutMs for the first.
  async wait(since: number | undefined, timeoutMs: number): Promise<{ events: LessonEvent[]; cursor: number }> {
    const from = Math.min(since ?? this.seq, this.seq)
    const after = () => this.log.filter((e) => e.seq > from)
    if (!after().length && timeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t)
          this.waiters.delete(done)
          resolve()
        }
        const t = setTimeout(done, timeoutMs)
        this.waiters.add(done)
      })
    }
    const events = after()
    return { events, cursor: events.at(-1)?.seq ?? from }
  }

  dispose() {
    this.clearTimer()
    for (const w of [...this.waiters]) w()
  }

  private reveal(via: 'now' | 'next' | 'timer') {
    this.revealed++
    this.moveCursor({ position: this.revealed })
    this.emit({ type: 'revealed', position: this.revealed, via })
  }

  // Show immediate steps at the head of the queue, and time the next delay.
  private pump() {
    const head = this.queue[0]
    if (!head || head === 'onNext' || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.queue.shift()
      this.reveal('timer')
      this.pump()
      this.onChange()
    }, head.afterMs)
  }

  private clearTimer() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private moveCursor(to: Omit<Cursor, 'seq'>) {
    this.cursor = { ...to, seq: this.cursor.seq + 1 }
  }

  private emit(e: NewEvent) {
    this.log.push({ ...e, seq: ++this.seq } as LessonEvent)
    if (this.log.length > LOG_LIMIT) this.log.shift()
    for (const w of [...this.waiters]) w()
  }
}
