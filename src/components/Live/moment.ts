// How each kind of key moment looks, and when you're at one.
import type { Moment } from '../../api/review'

export const MOMENT: Record<Moment['kind'], { mark: string; label: string; text: string; dot: string }> = {
  blunder: { mark: '??', label: 'Blunder', text: 'text-danger border-danger/50', dot: 'bg-danger' },
  mistake: { mark: '?', label: 'Mistake', text: 'text-warn border-warn/50', dot: 'bg-warn' },
  missed: { mark: '?!', label: 'Missed chance', text: 'text-accent border-accent/50', dot: 'bg-accent' },
  good: { mark: '!', label: 'Good play', text: 'text-ok border-ok/50', dot: 'bg-ok' },
}

// You're at a moment on its step, or just before it where Claude takes you.
export const atMoment = (m: Moment, position: number) => position === m.step || position === m.step - 1
