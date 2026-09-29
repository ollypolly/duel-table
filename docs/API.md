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

1. Create a session, or find the one the human started with the "Go live" button (`GET /sessions`). To play a deck, read it first with `GET /decks/{id}`, or create it from a decklist with `POST /decks`.
2. `GET /sessions/{id}` and read `state`: hands, field, LP, turn, phase.
3. Look up card text with `GET /cards?name=...` before relying on what a card does. Your memory of card text may be wrong.
4. `POST /sessions/{id}/steps` one step at a time. Check the response: `issues` holds warnings, a `422` means nothing was applied.
5. Made a mistake? `POST /sessions/{id}/undo` drops the last step.

## Endpoints

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /sessions` | | `[{ id, title, steps, basedOn? }]` |
| `POST /sessions` | `{ scenario?, atStep?, deck?, opponentDeck?, seed?, title? }` | `201` session |
| `GET /sessions/{id}` | | `{ id, title, steps, basedOn?, file, state, lesson }` |
| `POST /sessions/{id}/steps` | a step, plus optional `"strict": true` and `"reveal"` | `{ position, revealed, state, events, issues }`, or `422 { error, issues }` |
| `POST /sessions/{id}/undo` | | the session; drops a queued step first; `409` if there's nothing to undo |
| `POST /sessions/{id}/cursor` | `{ position, from? }` | the session. Points the viewer at a position, or replays `from`..`position` |
| `POST /sessions/{id}/prompt` | `{ type, message, ... }` | `201` the open prompt; `409` if one is already open |
| `DELETE /sessions/{id}/prompt` | | withdraws the open prompt |
| `GET /sessions/{id}/wait?since=&timeout=` | | `{ events, cursor }`: what the viewer did (long-poll) |
| `POST /sessions/{id}/fork` | `{ atStep? }` | `201` a new session cut at that position |
| `POST /sessions/{id}/export` | `{ id?, title?, write?, overwrite? }` | `{ file, path? }`. `write: true` saves `scenarios/<id>.json` (`409` if it exists and `overwrite` isn't set) |
| `GET /sessions/{id}/events` | | Server-sent events: `session` (the whole session) after every change |
| `GET /scenarios`, `GET /scenarios/{id}` | | scenarios, and one scenario's steps |
| `GET /cards?name=...` | | card data (name matching ignores case and punctuation); `404` with `suggestions` on a miss |
| `GET /cards/{passcode}` | | card data |
| `GET /decks` | | `[{ id, name, size: { main, extra } }]` |
| `GET /decks/{id}` | | the deck with every card's text and stats (see [Decks](#decks)) |
| `POST /decks` | `{ id, name, list? \| cards?, fetch?, overwrite? }` | `201` the saved deck; `422` unknown names with suggestions; `409` if it exists |

Creating a session:

- From a scenario position: `{ "scenario": "free-table", "atStep": 1 }`. `atStep` defaults to the end of the scenario.
- From decks: `{ "deck": "chazz-armed-ojama", "opponentDeck": "...", "seed": 7 }`. `opponentDeck` defaults to `deck`. The game starts at the setup: both Decks are in list order and both hands are empty. Your first step should `shuffle` each Deck and `draw` 5 for each player.

Errors look like `{ "error": "...", "details": ["..."] }`. A malformed body is a `400` whose `details` point at the bad field.

## Decks

Decks live in `decks/<id>.json` as card names and counts. Before playing a deck, read it with `GET /decks/{id}`: it has the full text of every card, so you can plan from the real cards rather than from memory.

```jsonc
{
  "id": "chazz-armed-ojama", "name": "Chazz: Armed Ojama VWXYZ",
  "size": { "main": 40, "extra": 9 },
  "main": [
    { "count": 3, "id": 90140980, "name": "Ojamatch", "type": "Spell Card", "race": "Normal", "desc": "..." },
    { "count": 1, "id": 46384672, "name": "Armed Dragon LV5", "type": "Effect Monster", "attribute": "WIND",
      "race": "Dragon", "level": 5, "atk": 2400, "def": 1700, "desc": "..." }
  ],
  "extra": [ ... ],
  "warnings": []      // e.g. "Main Deck has 38 cards (40 to 60 is legal)"
}
```

Each entry is the count plus the card's data; `id` is the passcode. Xyz monsters have `rank` instead of `level`, and Link monsters have `linkval` and no `def`.

### Creating a deck

When the human gives you a decklist, pass it as-is in `list`:

```sh
curl -s -X POST $API/decks -H 'content-type: application/json' -d '{
  "id": "my-deck",
  "name": "My Deck",
  "list": "Main Deck:\n3 Ash Blossom & Joyous Spring\n2x Maxx \"C\"\nEffect Veiler x1\nExtra Deck:\nAccesscode Talker\nSide Deck:\n3 Nibiru, the Primal Being"
}'
```

- **List format:** one card per line, as `3 Name`, `3x Name`, `Name x3` or just `Name` (one copy). Blank lines and `#` or `//` comments are ignored, and so is everything under a "Side Deck" heading. Repeats are added together. Lines that can't be read come back in `skipped`.
- **Main or Extra:** decided by card type (Fusion, Synchro, Xyz and Link cards go to the Extra Deck), so headings are optional.
- **Names:** matching ignores case and punctuation. The saved file uses the official spelling.
- **Structured input:** you can send `"cards": [{ "name": "...", "count": 3 }]` instead of `list`.
- **Fetching cards:** cards missing from the local card DB are fetched from YGOPRODeck, with their images. For a new deck this can take 10 to 30 seconds. Pass `"fetch": false` to use only local cards.
- **Unknown names:** if any name matches no real card, nothing is saved and you get a `422`:

  ```json
  { "error": "unknown card: Pot of Grreed", "unknown": [{ "name": "Pot of Grreed", "suggestions": ["Pot of Greed"] }] }
  ```

  Fix the names and send the request again. Cards that were already fetched stay in the DB, so the retry is quick. If the right card isn't obvious from the suggestions, ask the human rather than guessing.
- **Overwriting:** an existing id is a `409` unless you pass `"overwrite": true`.
- **Response:** `201` with the saved deck in the same shape as `GET /decks/{id}`, plus `path`, `fetched` (names that were added to the DB) and `skipped`.
- **Warnings:** a deck that breaks deck-building rules (size, more than 3 copies) is still saved, with `warnings`.

Then start a game with it: `POST /sessions { "deck": "my-deck", "opponentDeck": "...", "seed": 7 }`.

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

## Running an interactive lesson

A lesson is a session where you pace the steps and the viewer answers you. The viewer's side all happens in the browser: a **Next** button, a **Back to live** button if they've scrubbed away, and your prompt in the scene panel (it never covers the board).

**Pacing.** Add `"reveal"` to a step. Omitted, it shows at once. `{ "afterMs": 3000 }` shows it 3 seconds after the step before it shows. `"onNext"` waits for the viewer's Next click. Queued steps show in order, and a step posted without `reveal` behind queued ones waits its turn. `state` and new steps always build on every step, queued or not; `lesson.revealed` is the last position the viewer can see, `lesson.queued` how many are waiting. Undo drops the last queued step first.

**Pointing.** `POST /cursor { "position": 5 }` moves viewers who are following along to position 5. `{ "from": 3, "position": 5 }` replays 3 to 5. A viewer who has scrubbed elsewhere isn't moved; they get Back to live. Only shown positions are allowed. Each reveal moves the cursor to the new step.

**Prompts.** One at a time, and it appears once nothing is queued. `message` is markdown.

| `type` | Extra fields | The viewer | The `answer` event carries |
| --- | --- | --- | --- |
| `ack` | `button?` (default "Got it") | clicks it | nothing else |
| `choice` | `options` (2 or more) | picks one | `choice: { index, option }` |
| `text` | `placeholder?` | types an answer | `text` |
| `move` | | plays on the board, then clicks Done | `steps`: positions of the steps they made |

**Listening.** `GET /sessions/{id}/wait?since=<cursor>&timeout=<seconds>` returns as soon as there are events after `since`, or `{ "events": [], "cursor": <since> }` after the timeout (default 300, max 540: under the 10 minutes a tool call can run). Always pass the returned `cursor` as the next `since`. Without `since` it waits for the next new event. Events:

- `revealed` `{ position, via: "now" | "next" | "timer" }`: a step became visible (`next` means the viewer clicked Next).
- `step` `{ position, step }`: the viewer made a move. Their steps have `"author": "user"`; yours are stamped `"claude"`. While steps are queued the viewer can't move.
- `undo` `{ position }`: the viewer undid a step.
- `answer` `{ prompt: { id, type }, ... }`: the viewer answered, as in the table above.

Lesson state (the queue, cursor, prompt and event log) is in memory: if the API restarts, every step shows and cursors start again from 0.

The loop: queue a beat of steps, ask, wait, react.

```sh
API=http://127.0.0.1:5181/api
ID=$(curl -s -X POST $API/sessions -H 'content-type: application/json' \
  -d '{"scenario":"free-table","atStep":1,"title":"Lesson: opening"}' | jq -r .id)
post() { curl -s -X POST "$API/sessions/$ID/$1" -H 'content-type: application/json' -d "$2"; }

# Where the event log is now, so we only hear about what happens next
CURSOR=$(curl -s "$API/sessions/$ID/wait?timeout=0" | jq .cursor)

# Two beats, each shown when the viewer clicks Next
post steps '{"label":"Draw for turn","reveal":"onNext","actions":[{"type":"draw","player":"p1"}]}' >/dev/null
post steps '{"label":"Into Main Phase 1","narration":"Now you have **6** cards.","reveal":"onNext",
  "actions":[{"type":"phase","phase":"main1"}]}' >/dev/null

# Then hand them the board
post prompt '{"type":"move","message":"Your turn: **Normal Summon** a monster, then click Done."}' | jq -c .

# Wait for what they do; loop until the answer arrives
while :; do
  R=$(curl -s "$API/sessions/$ID/wait?since=$CURSOR&timeout=300")
  CURSOR=$(jq .cursor <<<"$R")
  jq -c '.events[]' <<<"$R"
  jq -e '.events[] | select(.type == "answer")' <<<"$R" >/dev/null && break
done
```

Keep each `wait` call under your tool's time limit, and react to each event: comment on the viewer's move in the next step's narration, or `undo` and explain if it was illegal.

### Playing a game against the viewer

The same loop runs a real game: you play `p2`, the viewer plays `p1` in the browser.

1. Create the session from decks (`{ "deck": "...", "opponentDeck": "..." }`), then post the setup step: shuffle both Decks, draw 5 each. Tell the viewer the session id so they can open it.
2. **Their turn:** post a `move` prompt ("Your turn. Click Done when you pass"), then `wait`. Each `step` event is one of their moves; read it as it arrives.
3. **Response windows:** the browser can't interrupt the viewer, so when one of their moves is something you'd respond to (an activation, a summon that triggers your hand trap), undo nothing. Just post your response as a step once their prompt ends. If the timing matters, give them a `choice` prompt first, e.g. "You're activating Ojamatch: I chain Ash Blossom. Continue?", and resolve the chain in steps.
4. **Your turn:** post each play as its own step with narration saying what you did and why, pacing with `{ "afterMs": 1500 }` so they can follow. Ask with a `choice` prompt whenever they could respond ("Do you chain anything?" with their plausible options plus "No").
5. **Their illegal moves:** the table doesn't enforce rules. Explain in a step's narration or an `ack` prompt, and `undo` their step if they agree.

Play fair. `state` shows their hand and Deck order: don't use them. Decide only from what a real opponent would know (public zones, card counts, what they revealed), and don't read your own Deck order before drawing.

## Playing well

- **Check card text** with `/cards?name=` before a play that depends on it, and say in the narration if you're simplifying a ruling.
- **Model costs and chains explicitly:** push the link, pay costs as separate `move`s with `cause.reason: "cost"`, let the opponent respond with more `chainPush`es, then `chainResolve` each link newest first, doing each link's effects before its `chainResolve`.
- **Use `arrow` and `highlight`** when an effect targets something, so the viewer sees it.
- **Keep a step about one player where you can.** The viewer's camera zooms to the player a step touches (its `intent` card, cards moved, summoned or chained, arrows) and pulls back to the whole table for attacks or anything touching both sides. A long step mixing both players' plays stays zoomed out.
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
