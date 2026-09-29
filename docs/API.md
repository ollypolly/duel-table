# Duel Table API: a guide for Claude

You are driving a Yu-Gi-Oh table that a human is watching in their browser. The table is a **manual simulator**: it moves cards where you tell it to and checks only physical things (does the card exist, is the slot free). It does **not** know card effects, costs, timing or legality. Getting the game right is your job; the API just keeps the board honest and shows it.

- Base URL: `http://127.0.0.1:5181/api` (local only; start it with `npm run dev` or `npm run api`)
- Machine-readable spec: `GET /api/openapi.json`
- The human watches a session at `http://localhost:5173/?session=<id>` (the Vite port may differ). Every change you make appears there immediately.

## Core ideas

**Sessions** are games in progress. You create one, then append **steps** to it. A session is stored as a scenario file, so it can be replayed, forked or saved to `scenarios/` later.

**A step** is one beat the viewer steps through: a label, optional markdown narration, an optional intent, and a list of **actions** applied in order. Make each step something a learner would want to pause on ("Activate Ojamatch", "Chain Link 2: Ash Blossom"), not one step per card movement and not a whole turn in one step.

**Positions** count steps: `0` is the setup, `n` is "after step n". `atStep` in requests is a position.

**Players** are `p1` (the viewer, "You") and `p2` (the opponent). Names come from the session.

**Cards** are referred to by instance id (**iid**): `<owner>-<card-name-slug>-<copy>`, e.g. `p1-armed-dragon-lv5-1`, `p2-ash-blossom-joyous-spring-2`. Never guess iids. Read them from the session state.

## Workflow

1. Create a session, or find the one the human started with the "Go live" button (`GET /sessions`).
2. `GET /sessions/{id}` and read `state`: hands, field, LP, turn, phase.
3. Look up card text with `GET /cards?name=...` before relying on what a card does. Your memory of card text may be wrong.
4. `POST /sessions/{id}/steps` one step at a time. Check the response: `issues` holds warnings, a `422` means nothing was applied.
5. Made a mistake? `POST /sessions/{id}/undo` drops the last step.

## Endpoints

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /sessions` | | `[{ id, title, steps, basedOn? }]` |
| `POST /sessions` | `{ scenario?, atStep?, deck?, opponentDeck?, seed?, title? }` | `201` session |
| `GET /sessions/{id}` | | `{ id, title, steps, basedOn?, file, state }` |
| `POST /sessions/{id}/steps` | a step, plus optional `"strict": true` | `{ position, state, events, issues }`, or `422 { error, issues }` |
| `POST /sessions/{id}/undo` | | the session; `409` if there's nothing to undo |
| `POST /sessions/{id}/fork` | `{ atStep? }` | `201` a new session cut at that position |
| `POST /sessions/{id}/export` | `{ id?, title?, write?, overwrite? }` | `{ file, path? }`. `write: true` saves `scenarios/<id>.json` (`409` if it exists and `overwrite` isn't set) |
| `GET /sessions/{id}/events` | | Server-sent events: `session` (the whole session) after every change |
| `GET /scenarios`, `GET /scenarios/{id}` | | scenarios, and one scenario's steps |
| `GET /cards?name=...` | | card data (name matching ignores case and punctuation); `404` with `suggestions` on a miss |
| `GET /cards/{passcode}` | | card data |

Creating a session:

- From a scenario position: `{ "scenario": "free-table", "atStep": 1 }`. `atStep` defaults to the end of the scenario.
- From decks: `{ "deck": "chazz-armed-ojama", "opponentDeck": "...", "seed": 7 }` (decks live in `decks/`).

Errors look like `{ "error": "...", "details": ["..."] }`. A malformed body is a `400` whose `details` point at the bad field.

## Reading the state

`GET /sessions/{id}` returns `state`:

```jsonc
{
  "turn": 1, "activePlayer": "p1", "phase": "main1",
  "players": {
    "p1": {
      "name": "You", "lp": 8000,
      "zones": {
        "hand": ["p1-ash-blossom-joyous-spring-3", "p1-armed-dragon-lv5-1"],
        "deck": ["..."],        // index 0 is the TOP
        "extraDeck": [], "gy": [], "banished": [],   // index 0 is the top / most recent
        "monster":   [null, null, "p1-armed-dragon-lv7-1", null, null],  // 5 slots, left to right
        "spellTrap": [null, null, null, null, null],
        "fieldSpell": [null]
      }
    },
    "p2": { "...": "..." }
  },
  "extraMonster": [null, null],   // shared Extra Monster Zones (left, right)
  "cards": {
    "p1-armed-dragon-lv7-1": { "iid": "...", "cardId": 73879377, "owner": "p1", "faceUp": true, "position": "atk", "materials": [] }
  },
  "chain": [{ "card": "...", "player": "p1", "label": "..." }],   // CL1 first
  "modifiers": [{ "id": "m1", "target": "...", "kind": "atk", "op": "add", "value": 500, "until": "endOfTurn" }],
  "turnFlags": { "normalSummonUsed": { "p1": false, "p2": false } }
}
```

Look card names up with `GET /cards/{cardId}`. Xyz materials are listed in `materials` on the monster they're attached to, not in any zone.

## Steps

```json
{
  "label": "Special Summon Armed Dragon LV7",
  "narration": "Markdown. Explain **why**, not just what: this is a learning tool.",
  "intent": { "type": "specialSummon", "card": "p1-armed-dragon-lv7-1" },
  "actions": [
    { "type": "move", "card": "p1-armed-dragon-lv5-1", "to": { "player": "p1", "zone": "gy" }, "cause": { "card": "p1-armed-dragon-lv5-1", "reason": "cost" } },
    { "type": "move", "card": "p1-armed-dragon-lv7-1", "to": { "player": "p1", "zone": "monster", "slot": 2 }, "summon": "special" }
  ]
}
```

`intent` is what the step is "about" and drives the badge in the UI: `activate {card, effect?}`, `normalSummon {card}`, `tributeSummon {card, tributes?}`, `specialSummon {card, method?}`, `set {card}`, `attack {attacker, target?}`, `declarePhase {phase}`, `endTurn`.

Any action can carry `"cause": { "card"?: iid, "reason": "cost" | "effect" | "battle" | "rule" | "manual" }`, which the UI uses in its narration of events.

### Actions

| `type` | Fields | Notes |
| --- | --- | --- |
| `move` | `card`, `to`, `faceUp?`, `position?`, `index?`, `summon?` | The workhorse: summons, sends to GY, banishes, adds to hand, sets. `to` is `{ player, zone, slot? }` |
| `draw` | `player`, `count?` | From the top of the Deck |
| `shuffle` | `player`, `zone` | Uses the session's seeded RNG, so replays are deterministic |
| `lp` | `player`, `delta?` or `set?` | `delta: -1500` for damage |
| `phase` | `phase` | `draw`, `standby`, `main1`, `battle`, `main2`, `end` |
| `nextTurn` | | Next turn, other player, Draw Phase. Resets the Normal Summon flag and expires `endOfTurn` modifiers. It doesn't draw: add a `draw` |
| `attach` | `card`, `to` | Makes `card` an Xyz material of monster `to` |
| `detach` | `card`, `to?` | Default destination is the owner's GY |
| `flip` | `card` | Face-up ⇄ face-down |
| `position` | `card`, `position` | `atk` or `def` |
| `chainPush` | `card`, `label?`, `player?` | Adds a chain link (player defaults to the card's controller) |
| `chainResolve` | | Resolves the newest link. Do the resolution's effects as separate actions around it |
| `modify` | `modifier` | Continuous change: `{ id, target, kind, value?, op?, label?, source?, until }` |
| `unmodify` | `id` | Removes a modifier early |
| `reveal` | `cards` | Shows cards face-up for this step only |
| `highlight` | `cards` | Glows cards for this step only |
| `arrow` | `from`, `to` | Draws a targeting arrow for this step only |

**Zones** (`to.zone`): `deck`, `hand`, `extraDeck`, `gy`, `banished` (piles), and `monster` (slots 0-4), `spellTrap` (slots 0-4), `fieldSpell` (slot 0), `extraMonster` (shared slots 0-1, no `player`). Omit `slot` to take the first free one. For piles, `index` 0 is the top; by default cards go on top, except the hand, where they're added at the end.

**`move` defaults:** the card is face-up on the field, GY and banished and face-down in the Deck, Extra Deck and hand. Set a monster with `"faceUp": false, "position": "def"`, and a Spell/Trap with `"faceUp": false`. Pass `summon` (`normal`, `tribute`, `flip`, `special`, `fusion`, `synchro`, `xyz`, `link`, `ritual`) when the move is a summon, so it's recorded (and a Normal Summon uses up the turn's Normal Summon).

**Modifier kinds:** `atk` and `def` (with `op` `add`, `set` or `multiply`), `name` (value is the name it's treated as), `negated`, `unaffected`, `cannotAttack`, or anything else with a `label`. `until`: `endOfTurn`, `endOfNextTurn`, `leavesField`, `permanent`. Ids must be unique among active modifiers.

## Validation

Every step is checked action by action against the state the previous action produced.

- **Errors** (the card doesn't exist, the slot is taken, not enough cards to draw) reject the whole step with `422`. Nothing is applied. The `issues` entries say which action (`action`, 0-based) failed.
- **Warnings** (sending a card to the other player's GY, a `summon` into a non-Monster Zone, attaching to a card off the field) are returned in `issues` but the step is still applied. Send `"strict": true` to reject on warnings too. If a warning was a mistake, `undo` and resend.

```json
{ "error": "step rejected", "issues": [{ "severity": "error", "message": "Unknown card \"nope\"", "action": 0 }] }
```

## Playing well

- **Check card text** with `/cards?name=` before a play that depends on it, and say in the narration if you're simplifying a ruling.
- **Model costs and chains explicitly:** push the link, pay costs as separate `move`s with `cause.reason: "cost"`, let the opponent respond with more `chainPush`es, then `chainResolve` each link newest first, doing each link's effects before its `chainResolve`.
- **Use `arrow` and `highlight`** when an effect targets something, so the viewer sees it.
- **Don't reach into hidden information** for the opponent unless the human asked you to play both sides.
- **Keep narration short and explanatory.** The human reads it while stepping through.
- When the line is worth keeping, `POST /sessions/{id}/export` with `{ "id": "my-line", "title": "...", "write": true }` saves it as a scenario.

## Example

```sh
API=http://127.0.0.1:5181/api
ID=$(curl -s -X POST $API/sessions -H 'content-type: application/json' \
  -d '{"scenario":"free-table","atStep":1}' | jq -r .id)

curl -s $API/sessions/$ID | jq '.state.players.p1.zones.hand'

curl -s -X POST $API/sessions/$ID/steps -H 'content-type: application/json' -d '{
  "label": "Armed Dragon LV7: destroy effect",
  "intent": { "type": "activate", "card": "p1-armed-dragon-lv7-1" },
  "actions": [
    { "type": "chainPush", "card": "p1-armed-dragon-lv7-1", "label": "Destroy monsters" },
    { "type": "move", "card": "p1-armed-dragon-lv5-1", "to": { "player": "p1", "zone": "gy" },
      "cause": { "card": "p1-armed-dragon-lv7-1", "reason": "cost" } },
    { "type": "chainResolve" }
  ]
}' | jq '{position, issues}'
```
