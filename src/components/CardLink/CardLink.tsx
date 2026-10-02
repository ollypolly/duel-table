// Card names in narration, lesson questions and Claude's chat: hover one for
// its text, click it for the full-screen inspector. In Claude's chat a deck's
// name or id is a link too, which opens the deck hub on it.
import * as Tooltip from '@radix-ui/react-tooltip'
import type { ComponentProps, ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CardData } from '../../data/cardDb'
import { cardDb } from '../../data/cards'
import { useUiStore } from '../../store/uiStore'
import { catalogFace } from '../../view/boardView'
import { rawDecks } from '../../scenarios/load'
import { CARD_HREF, DECK_HREF, cardNames, deckNames } from '../../view/cardLinks'
import { CardInspector } from '../CardInspector/CardInspector'

const names = cardNames(cardDb)
const decks = deckNames(Object.entries(rawDecks).map(([id, raw]) => ({ id, name: (raw as { name?: string }).name ?? id })))

function DeckLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button type="button" className="cursor-pointer font-[inherit] text-gold underline decoration-gold/40 underline-offset-2 hover:decoration-gold" title="Open this deck" onClick={() => useUiStore.getState().openDecks(id)}>
      {children}
    </button>
  )
}

export function CardLink({ card, children }: { card: CardData; children: string }) {
  const stars = card.level ?? card.rank
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="cursor-pointer font-[inherit] text-gold underline decoration-gold/40 decoration-dotted underline-offset-2 hover:decoration-gold"
            onClick={() => useUiStore.getState().inspectCard(card.id)}
          >
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={6} collisionPadding={8} className="panel z-50 flex pointer-coarse:hidden w-[min(24rem,92vw)] gap-3 p-3 text-ink">
            <img src={catalogFace(card).image} alt="" className="h-fit w-20 shrink-0 rounded-[4%]" />
            <div className="min-w-0 space-y-1">
              <p className="font-display text-sm font-bold leading-tight">{card.name}</p>
              <p className="text-[11px] text-muted">
                {[card.attribute, card.race, card.type, stars && `${card.rank ? 'Rank' : 'Level'} ${stars}`, card.linkval && `Link ${card.linkval}`]
                  .filter(Boolean)
                  .join(' · ')}
                {card.atk !== undefined && ` · ATK ${card.atk}${card.def !== undefined ? ` / DEF ${card.def}` : ''}`}
              </p>
              <p className="line-clamp-[10] whitespace-pre-line text-xs leading-snug text-ink/90">{card.desc}</p>
            </div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

// Plain text (Claude's move lines) with its card names linked.
export function CardText({ children }: { children: string }) {
  return names.split(children).map((part, i) =>
    typeof part === 'string' ? (
      part
    ) : (
      <CardLink key={i} card={part}>
        {part.name}
      </CardLink>
    ),
  )
}

const components: ComponentProps<typeof Markdown>['components'] = {
  a: ({ href, children }) => {
    const card = href?.startsWith(CARD_HREF) ? cardDb.byId(Number(href.slice(CARD_HREF.length))) : undefined
    if (card) return <CardLink card={card}>{card.name}</CardLink>
    if (href?.startsWith(DECK_HREF)) return <DeckLink id={href.slice(DECK_HREF.length)}>{children}</DeckLink>
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
  // Claude writes a deck's id as code: that links too.
  code: ({ children, className }) => {
    const id = typeof children === 'string' && !className ? decks.id(children) : undefined
    return id ? <DeckLink id={id}>{children}</DeckLink> : <code className={className}>{children}</code>
  },
}

// Markdown with its card names linked.
export function CardMarkdown({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm, names.remark, decks.remark]} components={components}>
      {children}
    </Markdown>
  )
}

// The card a link opened, over everything. Mounted once, in the app.
export function CardLinkInspector() {
  const { inspectedCard, inspectCard } = useUiStore()
  const card = inspectedCard === undefined ? undefined : cardDb.byId(inspectedCard)
  return <CardInspector card={card && catalogFace(card)} materialsOf={() => []} onClose={() => inspectCard(undefined)} />
}
