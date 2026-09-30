import type { Intent, Step } from '../../engine'
import type { CardFace } from '../../view/boardView'
import { CardMarkdown } from '../CardLink/CardLink'

const INTENT_LABELS: Record<Intent['type'], string> = {
  activate: 'Activate',
  normalSummon: 'Normal Summon',
  tributeSummon: 'Tribute Summon',
  specialSummon: 'Special Summon',
  set: 'Set',
  attack: 'Attack',
  declarePhase: 'Phase',
  endTurn: 'End turn',
}

export function NarrationPanel({
  step,
  position,
  description,
  intentCard,
  warnings,
}: {
  step?: Step
  position: number
  description?: string
  intentCard?: CardFace
  warnings: string[]
}) {
  return (
    <section className="space-y-3 p-4" data-testid="narration" aria-live="polite">
      <h2 className="font-display font-semibold leading-tight">{step ? (step.label ?? `Step ${position}`) : 'Setup'}</h2>
      {step?.intent && (
        <span className="inline-block rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
          {INTENT_LABELS[step.intent.type]}
          {intentCard && `: ${intentCard.name}`}
        </span>
      )}
      <div className="prose-narration text-sm leading-relaxed text-ink">
        <CardMarkdown>{step ? (step.narration ?? '') : (description ?? 'Press → to start.')}</CardMarkdown>
      </div>
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
