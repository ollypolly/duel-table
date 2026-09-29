# Duel Table

A local web tool for learning Yu-Gi-Oh! by stepping through scripted games. Each scenario is a list of steps that move cards around a two-player board, with narration explaining what happened and why. You can pause, rewind, fork from any step and play on by hand.

It tracks where cards are, like a real table. It doesn't enforce rules. See [PLAN.md](PLAN.md) for the design.

## Running it

```sh
npm install
npm run fetch-cards   # downloads card data + images from YGOPRODeck (once)
npm run dev
```

Card images go in `public/cards/` and aren't committed. YGOPRODeck asks that images are self-hosted rather than hotlinked, so run `fetch-cards` after cloning.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite on :5173 plus the API on :5181 (proxied at `/api`). Scenario files hot-reload. |
| `npm run web` / `npm run api` | Just one of the two |
| `npm test` | Vitest, once |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |
| `npm run fetch-cards` | Rebuild `data/cards.json` from every card named in `decks/` and `scenarios/`, and download missing images |

## Driving it with curl

The local API (`server/`, bound to 127.0.0.1) holds **sessions**: boards in progress that you and the browser both act on. A session is stored in `sessions/<id>.json` as a scenario file, so it replays like any scenario and can be exported to `scenarios/`. The full spec is at `/api/openapi.json`.

Positions work like the UI and URLs: `0` is the setup and `n` is "after step n".

```sh
API=http://127.0.0.1:5181/api

# Start a session from the free table after its opening hands (step 1)
curl -s -X POST $API/sessions -H 'content-type: application/json' \
  -d '{"scenario":"free-table","atStep":1}'
# → {"id":"s-1a2b3c", ...}. Open http://localhost:5173/?session=s-1a2b3c to watch it.

# See the hand (iids are owner-slug-copy, e.g. p1-armed-dragon-lv5-1)
curl -s $API/sessions/s-1a2b3c | jq '.state.players.p1.zones.hand'

# Normal Summon a monster. The open tab updates straight away (SSE).
curl -s -X POST $API/sessions/s-1a2b3c/steps -H 'content-type: application/json' -d '{
  "label": "Normal Summon Armed Dragon LV5",
  "narration": "Sent **from curl**.",
  "actions": [{ "type": "move", "card": "p1-armed-dragon-lv5-1",
                "to": { "player": "p1", "zone": "monster", "slot": 2 }, "summon": "normal" }]
}' | jq '{position, issues}'
```

Every step is checked with the table rules first. A physically impossible move (a missing card, an occupied slot) is rejected with `422` and the issues. Warnings, like sending a card to the other player's GY, are returned but still applied unless you pass `"strict": true`.

Other calls:

| Call | What it does |
| --- | --- |
| `GET /sessions/:id/events` | SSE: the whole session after every change |
| `POST /sessions/:id/undo` | Drop the last step |
| `POST /sessions/:id/fork` `{"atStep": 2}` | A new session from this one at a position |
| `POST /sessions/:id/export` `{"id": "my-line", "title": "My line", "write": true}` | Save it as `scenarios/my-line.json` |
| `POST /sessions` `{"deck": "chazz-armed-ojama", "seed": 7}` | A fresh game from decks instead of a scenario |
| `GET /scenarios`, `GET /scenarios/:id` | Scenarios and their steps |
| `GET /cards?name=...`, `GET /cards/:id` | Card text and stats from the local DB |

In the browser, "Go live from here" starts a session at the current step, and free-play moves made there are posted to the session, so both sides act on the same board.
