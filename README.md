# Duel Table

A local web tool for learning Yu-Gi-Oh!. Step through scripted games with narration explaining each play, fork from any step and play on by hand, or play real games on the YGOPro rules engine against a bot or against Claude.

See [PLAN.md](PLAN.md) for the design.

## Bring your own intelligence

Everything works without AI. A Claude login adds intelligence on top.

- **Without Claude:** preset scenarios and lessons, free play and branches, and games on the rules engine against a bot that makes random legal moves.
- **With Claude:** Claude as your opponent in those games. It chats, can coach you, and, if you show it your cards, advises on your position.

Claude runs through the [Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) on the Claude Code login of the machine running the server. There's no login inside the app: run `claude` and `/login` there, and the Claude option in **New game** turns on. Usage comes out of your Claude plan; the app shows what it would have cost on the API.

## Running it

```sh
npm install
npm run fetch-cards   # card data and images from YGOPRODeck (once)
npm run fetch-ocg     # the rules engine's scripts and card database (once, for games)
npm run dev
```

Then open http://localhost:5180. In tmux, the devserver popup (prefix+d) runs it for you through `mise.toml`. To run it on a server and use it from your phone over Tailscale, see [docs/HOSTING.md](docs/HOSTING.md).

**Accounts.** The first start makes your admin account and prints a sign-in link in the API's log. Open it, and Settings → "Use on another device" signs in the rest (or run `npm run signin`). Friends make their own from a game invite. Each account changes only its own games and decks; see [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md), which also covers playing a friend and the live copy they play on.

Card images go in `public/cards/` and the engine's files in `data/ocg/`; neither is committed. YGOPRODeck asks that images are self-hosted rather than hotlinked.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite on :5180 plus the API on :5181 (proxied at `/api`). Scenario files and prompts reload as you edit them. |
| `npm run web` / `npm run api` | Just one of the two |
| `npm test` | Vitest, once |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |
| `npm run fetch-cards` | Rebuild `data/cards.json` from every card named in `decks/` and `scenarios/`, and download missing images |
| `npm run fetch-ocg` | Download the YGOPro scripts, card database and strings into `data/ocg/` |
| `npm run signin -- [username]` | A new sign-in link (and a curl cookie) for an account, the admin's by default |
| `mise run deploy` | Build `origin/main` into the live copy (`~/dev/duel-table-live`) and restart it on :5190 |

## In the browser

- Step with ← → or the controls at the top of the scene panel. The panel slides away to the left (to the bottom on a phone).
- Click a card to read it full screen, with whatever you can do with it. Click a Deck, GY or other pile to see what's in it.
- The camera follows each step's action. Pan or zoom the board, or untick **Focus**, to move it yourself. Focus is back on at each page load.
- **Branch** forks from the current step so you can play on by hand. In free play, drag a card onto a zone, or click it for Move, Flip, Position and material options. Draws, shuffles, LP, next turn and undo are in the **Free play** menu.
- **☰ → Sleeves, deck boxes & playmats** sets each seat's images, kept in this browser only.

## Playing a game

**Tables → New game…** picks your deck, the opponent's deck, and the opponent: the bot, or Claude (with a model, Opus or Sonnet, and whether it coaches you).

The rules engine asks you what to do: the options appear in the scene panel and the cards involved light up. Drag a card from your hand onto a zone to summon, set or activate it, or click it to see its options.

Against Claude, the scene panel also has:

- **Chat.** Say anything at any time. If Claude is mid-turn it reads your message when that run ends.
- **Coach.** Claude points out misplays, explains its own plays, and answers rules questions.
- **Show my cards.** Claude sees your hand, face-down cards and the question you're on, so it can tell you the best play and why. It's asked not to use them on its own turn.
- **Stop / Resume**, the model, and the API-equivalent cost so far.

Claude only sees the table from its side and gets each card's real text. Its prompts are `prompts/game.md` and `prompts/coach.md`, read fresh for each run.

## Driving it with curl

The local API (`server/`, bound to 127.0.0.1) holds **sessions**: boards in progress that the browser follows live. A session is stored in `sessions/<id>.json` as a scenario file, so it replays like any scenario and can be exported to `scenarios/`. The spec is at `/api/openapi.json`, and [docs/API.md](docs/API.md) is the full guide, written for handing to Claude Code.

Positions work like the UI and URLs: `0` is the setup and `n` is "after step n".

Changes need an account: pass the cookie `npm run signin` prints (`--cookie duel-key=…`) with each write, or set `DUEL_ACCOUNTS=off`.

```sh
API=http://127.0.0.1:5181/api

# Start a session from the free table after its opening hands (step 1)
curl -s -X POST $API/sessions -H 'content-type: application/json' \
  -d '{"scenario":"free-table","atStep":1}'
# → {"id":"s-1a2b3c", ...}. Open http://localhost:5180/?session=s-1a2b3c to watch it.

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

These boards check only physical things (a missing card, an occupied slot is a `422`). Rules are enforced only in games on the rules engine.

In the browser, the **Tables** picker lists your games (in progress and past, with the Claude chat kept) and boards, which you can rename and delete, above the lessons and scenarios. **More → New table from here** starts a session at the current step, and your free-play moves there are posted to it, so you and whatever is driving the API act on the same board. Sessions can also run as **interactive lessons**, with steps shown when you click Next and questions in the scene panel: see [Running an interactive lesson](docs/API.md#running-an-interactive-lesson).

## Where things are

| Path | What |
| --- | --- |
| `src/engine/` | The table: board state and actions, pure and replayable |
| `src/components/` | The UI. `Board/` draws the board, `Table/` wraps it with the scene panel |
| `server/` | The local API: sessions, lessons, decks |
| `server/ocg/` | Games on the YGOPro core, translated into our steps |
| `server/claude/` | Claude as a player: the agent, what it sees, and the chat |
| `prompts/` | Claude's system prompts |
| `scenarios/`, `decks/` | Content, as JSON |
| `sessions/` | Live sessions and games (gitignored) |
