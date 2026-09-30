// Pick a deck's sleeves (Main and Extra), deck box and playmat from image files,
// or sleeves from Dragon Shield's colours (in the deck hub).
import { useRef, useState } from 'react'
import { SLEEVE_COLOURS } from '../../data/sleeveColours'
import { useCosmeticsStore, type Cosmetic } from '../../store/cosmeticsStore'

type Sleeve = Extract<Cosmetic, 'sleeve' | 'extraSleeve'>

const SLOTS: { kind: Cosmetic; label: string; aspect: string }[] = [
  { kind: 'sleeve', label: 'Main sleeves', aspect: 'aspect-[1/1.46]' },
  { kind: 'extraSleeve', label: 'Extra sleeves', aspect: 'aspect-[1/1.46]' },
  { kind: 'deckBox', label: 'Deck box', aspect: 'aspect-[1/1.3]' },
  { kind: 'playmat', label: 'Playmat', aspect: 'aspect-[16/9]' },
]

export function DeckCosmetics({ deck }: { deck: string }) {
  const [picking, setPicking] = useState<Sleeve>()
  return (
    <section className="space-y-2">
      <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-muted">Sleeves, deck box & playmat</h3>
      <div className="grid max-w-lg grid-cols-[1fr_1fr_1fr_2fr] gap-3">
        {SLOTS.map((s) => (
          <Slot key={s.kind} deck={deck} {...s} picking={picking === s.kind} onPick={() => setPicking(picking === s.kind ? undefined : (s.kind as Sleeve))} />
        ))}
      </div>
      {picking && <Palette deck={deck} kind={picking} onDone={() => setPicking(undefined)} />}
      <p className="text-xs text-faint">Images stay in this browser. JPEG, PNG or WebP. Extra sleeves fall back to the Main ones.</p>
    </section>
  )
}

function Slot({ deck, kind, label, aspect, picking, onPick }: { deck: string; kind: Cosmetic; label: string; aspect: string; picking: boolean; onPick: () => void }) {
  const value = useCosmeticsStore((s) => s.cosmetics[deck]?.[kind])
  const setCosmetic = useCosmeticsStore((s) => s.set)
  const input = useRef<HTMLInputElement>(null)
  const colour = value?.startsWith('#') ? value : undefined
  const sleeve = kind === 'sleeve' || kind === 'extraSleeve'
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        style={colour ? { backgroundColor: colour } : undefined}
        className={`${aspect} grid w-full place-items-center overflow-hidden rounded-md border border-dashed border-line bg-raised/40 text-center text-xs text-muted hover:border-gold hover:text-ink`}
        aria-label={`${label}: choose image`}
      >
        {value && !colour ? <img src={value} alt="" className="h-full w-full object-cover" /> : !value && `Choose ${label.toLowerCase()}`}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void setCosmetic(deck, kind, file)
          e.target.value = ''
        }}
      />
      <div className="text-xs text-muted">{label}</div>
      <div className="flex gap-2 text-xs">
        {sleeve && (
          <button type="button" className={picking ? 'text-gold' : 'text-faint hover:text-ink'} onClick={onPick}>
            Colour
          </button>
        )}
        {value && (
          <button type="button" className="text-faint hover:text-danger" onClick={() => void setCosmetic(deck, kind, undefined)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function Palette({ deck, kind, onDone }: { deck: string; kind: Sleeve; onDone: () => void }) {
  const current = useCosmeticsStore((s) => s.cosmetics[deck]?.[kind])
  const setCosmetic = useCosmeticsStore((s) => s.set)
  return (
    <div
      className="flex max-w-lg flex-wrap gap-1.5 rounded-md border border-line bg-raised/40 p-2"
      role="radiogroup"
      aria-label={`${kind === 'sleeve' ? 'Main' : 'Extra'} sleeve colour`}
    >
      {SLEEVE_COLOURS.map(({ name, hex }) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={current === hex}
          title={name}
          aria-label={name}
          onClick={() => void setCosmetic(deck, kind, hex).then(onDone)}
          style={{ backgroundColor: hex }}
          className={`h-8 w-6 rounded-sm border ${current === hex ? 'border-gold ring-2 ring-gold' : 'border-black/40 hover:scale-110'}`}
        />
      ))}
    </div>
  )
}
