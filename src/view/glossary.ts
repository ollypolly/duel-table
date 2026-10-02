// Game terms in Claude's chat get a dotted underline and their meaning in a
// line or two. Only the first use in a message is marked. Capitalised terms
// match as printed (so "Set" the game word, not "set"); slang matches any case.
import type { Root } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'

export const TERM_HREF = '#term-'

// [the term, also written as, what it means]
const TERMS: [string, string[], string][] = [
  ['Normal Summon', ['Normal Summoned', 'Normal Summons'], 'Putting a monster from your hand onto the field face-up, once per turn. Level 5 and higher need Tributes.'],
  ['Tribute Summon', ['Tribute Summoned', 'Tribute Summons'], 'A Normal Summon of a Level 5 or higher monster: send one of your monsters to the Graveyard for Level 5 or 6, two for Level 7 and up.'],
  ['Special Summon', ['Special Summoned', 'Special Summons'], "Any Summon that isn't your Normal Summon or Set: by a card's effect, or from the Extra Deck. There's no limit on how many you do in a turn."],
  ['Flip Summon', ['Flip Summoned'], 'Turning your own face-down Defense Position monster face-up into Attack Position. Not on the turn it was Set.'],
  ['Fusion Summon', ['Fusion Summoned'], 'Special Summoning a Fusion Monster from the Extra Deck with a card like Polymerization, sending the materials it lists to the Graveyard.'],
  ['Synchro Summon', ['Synchro Summoned'], 'Special Summoning a Synchro Monster from the Extra Deck by sending a Tuner and non-Tuners from your field to the Graveyard, whose Levels add up to its Level.'],
  ['Xyz Summon', ['Xyz Summoned'], 'Special Summoning an Xyz Monster from the Extra Deck by stacking monsters of the same Level on your field. They go under it as its materials.'],
  ['Link Summon', ['Link Summoned'], 'Special Summoning a Link Monster from the Extra Deck by sending monsters from your field to the Graveyard, as many as its Link Rating (a Link Monster can count as its own Rating).'],
  ['Ritual Summon', ['Ritual Summoned'], 'Special Summoning a Ritual Monster from your hand with a Ritual Spell, Tributing monsters whose Levels meet its Level.'],
  ['Pendulum Summon', ['Pendulum Summoned'], 'Once per turn, with a card in each Pendulum Zone: Special Summon any number of monsters from your hand whose Levels are between the two Scales.'],
  ['Tribute', ['Tributes', 'Tributed', 'Tributing'], "Sending your own monster from the field to the Graveyard as a cost or for a Summon. It isn't destroyed."],
  ['Set', ['Sets', 'Setting'], 'Putting a card on the field face-down. A Set monster is in Defense Position; a Set Trap, or a Quick-Play Spell, can\'t be activated the turn it was Set.'],
  ['Extra Deck', [], 'The up to 15 Fusion, Synchro, Xyz and Link Monsters kept face-down beside the field, Summoned from there when you meet their requirements.'],
  ['Graveyard', ['GY'], 'Where used Spells and Traps, destroyed and discarded cards go. Face-up, and either player can look through it.'],
  ['banish', ['banished', 'banishes', 'banishing', 'Banish', 'Banished'], 'Removing a card from play. Banished cards are much harder to get back than cards in the Graveyard.'],
  ['Chain Link', ['Chain Links'], "One effect's place in a Chain. Chain Link 1 was activated first and resolves last."],
  ['Chain', ['Chains', 'chain', 'chains', 'chained'], 'Effects stacked in response to each other. Once both players pass, they resolve backwards: the last one activated goes first.'],
  ['Spell Speed', ['Spell Speeds'], 'How fast an effect is. 1: only on your own turn, never in response. 2: Quick Effects, Traps and Quick-Play Spells, which can respond. 3: Counter Traps, which only a Counter Trap can respond to.'],
  ['Quick Effect', ['Quick Effects'], "A monster effect that can be used in response to things, and on the opponent's turn. Spell Speed 2."],
  ['Ignition Effect', ['Ignition Effects'], "A monster effect you choose to activate in your own Main Phase, when nothing else is happening. Spell Speed 1."],
  ['Trigger Effect', ['Trigger Effects'], 'A monster effect that activates when something specific happens: "If this card is Summoned", "When this card is destroyed".'],
  ['Continuous Effect', ['Continuous Effects'], "An effect that just applies while the card is face-up on the field. It never activates, so it can't be chained to."],
  ['Quick-Play Spell', ['Quick-Play Spells', 'Quick-Play'], "A Spell you can activate from your hand in any phase of your turn, or on the opponent's turn if it was Set on an earlier turn."],
  ['Continuous Spell', ['Continuous Spells', 'Continuous Trap', 'Continuous Traps'], 'Stays on the field after it activates. If it leaves the field before it resolves, its effect does nothing.'],
  ['Counter Trap', ['Counter Traps'], 'The fastest kind of card (Spell Speed 3). Only another Counter Trap can be chained to it.'],
  ['Field Spell', ['Field Spells'], "A Spell that goes in its own zone and stays. Each player can have one of their own."],
  ['Equip Spell', ['Equip Spells'], 'A Spell that stays on the field attached to one monster. If that monster leaves the field, the Equip Spell is destroyed.'],
  ['Tuner', ['Tuners'], 'A monster marked Tuner. A Synchro Summon needs exactly one, unless the Synchro Monster says otherwise.'],
  ['Xyz Material', ['Xyz Materials', 'materials'], "The cards under an Xyz Monster. They aren't on the field, and are detached to pay for its effects."],
  ['Link Rating', [], "A Link Monster's number: how many materials it needs, and how many arrows it has. Link Monsters have no DEF and can't be in Defense Position."],
  ['Draw Phase', [], 'The start of the turn: the turn player draws a card. The player going first skips their draw on turn one.'],
  ['Standby Phase', [], 'Between the draw and Main Phase 1. Nothing happens here unless a card says "during the Standby Phase".'],
  ['Main Phase', ['Main Phase 1', 'Main Phase 2'], 'Where you Summon, Set, and activate cards. There is one before the Battle Phase and one after.'],
  ['Battle Phase', [], "Where monsters attack. Nobody attacks on the first turn of the duel. Main Phase 2 comes after, so you can still Set cards."],
  ['Damage Step', [], 'The part of a battle from when the attack is locked in until the damage is done. Very few cards can be activated here: mostly ATK/DEF changes and Counter Traps.'],
  ['End Phase', [], 'The end of the turn. "Until the end of this turn" effects stop here, and a player with more than 6 cards in hand discards down to 6.'],
  ['direct attack', ['direct attacks', 'attack directly', 'attacks directly'], "An attack on the player, when they have no monsters. The attacker's full ATK comes off their Life Points."],
  ['piercing', ['Piercing'], "When a monster attacks a Defense Position monster with less DEF than its ATK, the difference is dealt as damage. Normally a defender's controller takes none."],
  ['replay', ['Replay'], "If the number of monsters the opponent controls changes after an attack is declared, the attacker picks again: a new target, a direct attack, or not attacking."],
  ['target', ['targets', 'targeting', 'targeted'], 'Choosing the card an effect will apply to when you activate it. Only effects that say "target" do; "cannot be targeted" does nothing against the rest.'],
  ['negate', ['negates', 'negated', 'negating'], 'Stopping an activation or an effect. A negated activation never happened, and its cost stays paid. A negated effect activates and then does nothing.'],
  ['cost', ['costs'], "What you pay to activate, written before the semicolon in a card's text. It's paid on activation, and you don't get it back if the effect is negated."],
  ['once per turn', ['Once per turn'], 'Written "You can only use this effect of [name] once per turn": once, whichever copy it is, and even if it was negated. Written just "Once per turn": each copy has its own, and a new copy starts fresh.'],
  ['missing the timing', ['miss the timing', 'misses the timing', 'missed the timing'], 'A "When... you can" effect can only activate if its trigger was the very last thing to happen. If something else happened after, the chance is gone. "If... you can" effects never miss.'],
  ['hand trap', ['hand traps', 'handtrap', 'handtraps', 'Hand trap', 'Hand traps'], "A monster whose effect is used from the hand on the opponent's turn, usually by discarding it, to stop their play."],
  ['floodgate', ['floodgates'], 'A card that stays on the field and stops both players, or just the opponent, from doing something at all: Special Summoning, activating Spells.'],
  ['board breaker', ['board breakers'], "A card for the player going second, to clear what the opponent set up on their first turn."],
  ['brick', ['bricks', 'bricked', 'bricking'], "A card you can't do anything with in your opening hand, or drawing a hand of them."],
  ['mill', ['mills', 'milled', 'milling'], 'Sending cards from the top of a Deck to the Graveyard.'],
  ['search', ['searches', 'searched', 'searching', 'searcher'], 'Adding a specific card from your Deck to your hand with an effect.'],
  ['starter', ['starters'], 'A card that gets your whole combo going by itself.'],
  ['extender', ['extenders'], "A card that keeps your combo going after your Normal Summon is used, or after the opponent stops a play."],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const byText = new Map(TERMS.flatMap(([term, also], i) => [term, ...also].map((text) => [text, i] as const)))
const texts = [...byText.keys()].sort((a, b) => b.length - a.length)
// "Set up" and "set of" are English, not the game word.
const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${texts.map(escape).join('|')})(?![\\p{L}\\p{N}-]| up\\b)`, 'gu')

export const term = (key: string) => {
  const t = TERMS[Number(key)]
  return t && { term: t[0], meaning: t[2] }
}

// A remark plugin: the first use of each term becomes a link to TERM_HREF +
// its key. Run after the cards' and decks', so a card's name is never split.
export const glossary = () => (tree: Root) => {
  const seen = new Set<number>()
  findAndReplace(
    tree,
    [
      pattern,
      (text: string) => {
        const key = byText.get(text)!
        if (seen.has(key)) return false
        seen.add(key)
        return { type: 'link', url: `${TERM_HREF}${key}`, children: [{ type: 'text', value: text }] }
      },
    ],
    { ignore: ['link', 'linkReference', 'inlineCode', 'code', 'heading'] },
  )
}
