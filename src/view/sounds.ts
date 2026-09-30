// Sound effects for a step as you move forward through a duel: cards sliding
// and landing for ordinary moves, something more magical for Special Summons
// and effects. Plus a chime for a new message. The files are in public/sounds
// (Kenney, CC0).
import type { Action, EngineEvent, Location } from '../engine'

export type Sound = 'slide' | 'place' | 'shuffle' | 'turn' | 'attack' | 'summon' | 'activate' | 'destroy' | 'damage' | 'heal' | 'message'

// Most striking first: a step plays its top two.
const PRIORITY: Sound[] = ['summon', 'activate', 'destroy', 'damage', 'heal', 'attack', 'place', 'turn', 'shuffle', 'slide']
const VARIANTS: Partial<Record<Sound, number>> = { slide: 4, place: 4 }
const VOLUME: Partial<Record<Sound, number>> = { summon: 0.5, activate: 0.5, destroy: 0.5, damage: 0.9 }

const onField = (l: Location) => 'zone' in l && ['monster', 'spellTrap', 'fieldSpell', 'extraMonster'].includes(l.zone.zone)
// Sent from the field by battle or an effect; materials and spent spells just slide.
const destroyed = (e: Extract<EngineEvent, { type: 'moved' }>) =>
  onField(e.from) && 'zone' in e.to && ['gy', 'banished'].includes(e.to.zone.zone) && (e.cause?.reason === 'battle' || e.cause?.reason === 'effect')

export function stepSounds(events: EngineEvent[], actions: Action[] = []): Sound[] {
  const found = new Set<Sound>()
  for (const e of events) {
    if (e.type === 'summoned') found.add(['normal', 'tribute', 'flip'].includes(e.method) ? 'place' : 'summon')
    else if (e.type === 'chainLinkAdded') found.add('activate')
    else if (e.type === 'lpChanged') found.add(e.to < e.from ? 'damage' : 'heal')
    else if (e.type === 'moved') found.add(destroyed(e) ? 'destroy' : onField(e.to) ? 'place' : 'slide')
    else if (e.type === 'drew') found.add('slide')
    else if (e.type === 'shuffled') found.add('shuffle')
    else if (e.type === 'turnStarted') found.add('turn')
    else if (e.type === 'flipped' || e.type === 'positionChanged' || e.type === 'created') found.add('place')
  }
  // Attacks show as an arrow, which changes nothing on the board.
  if (actions.some((a) => a.type === 'arrow')) found.add('attack')
  return PRIORITY.filter((s) => found.has(s)).slice(0, 2)
}

const loaded = new Map<string, HTMLAudioElement>()

export function play(sound: Sound) {
  const n = VARIANTS[sound]
  const file = n ? `${sound}-${1 + Math.floor(Math.random() * n)}` : sound
  let audio = loaded.get(file)
  if (!audio) loaded.set(file, (audio = new Audio(`/sounds/${file}.mp3`)))
  const copy = audio.cloneNode() as HTMLAudioElement // so the same sound can overlap itself
  copy.volume = VOLUME[sound] ?? 0.7
  // Browsers block sound until the page has been clicked or tapped.
  copy.play().catch(() => {})
}
