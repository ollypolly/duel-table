# Bots worth playing, for free

**Status:** the trained bot (ygo-agent), the opponent picker and Claude beside you in bot games are built. What's left is under Still to do.

## Why

A game against the simple bot is a game against random legal moves (`server/ocg/bot.ts`), which teaches nothing. A game against Claude is a real opponent but spends Claude usage on every move. The aim is opponents that play sensibly for free, leaving Claude for coaching, hints and reviews.

## The shape

ygo-agent is the bot worth playing. The opponent you pick decides who answers the engine's questions:

| Opponent | Plays | How |
|---|---|---|
| **Simple bot** | any deck | today's random legal moves |
| **Trained bot** (ygo-agent) | its own 30 lists | HTTP call to a container |
| **Claude** | any deck | as today |
| Rules bot, maybe later | any deck | our own bot, with hand-written heuristics |

The simple bot is the fallback when the trained bot can't answer a question or is down.

## What the research found

### ygo-agent

[sbl1996/ygo-agent](https://github.com/sbl1996/ygo-agent): a neural net trained by self-play on ygopro-core. MIT licence.

- **Runs here.** `docker compose up -d ygo-agent` builds `docker/ygo-agent/Dockerfile` and serves it on `127.0.0.1:5182`. Measured: 271 MB image, 83 MB of memory idle, under 10 ms per prediction.
- **API** (`ygoinf/ygoinf/server.py`, `models.py`): `POST /v0/duels` creates a duel, `DELETE /v0/duels/{id}` drops it, `POST /v0/duels/{id}/predict` takes the open question plus the visible table. Each option carries a `response` number we choose; it returns a probability per option and a win rate. Question types match the engine's: idle command, battle command, chain, card, unselect card, tribute, sum, yes/no, effect yes/no, position, place, option, announce number and attribute. A hand-written Blue-Eyes opening question was answered in 9 ms.
- **It keeps state per duel**: an `index` that must match, and the option picked last time. A take-back needs a fresh duel replayed up to that point.
- **864 cards.** The one released checkpoint (`0546_26550M.tflite`, July 2024) has an embedding per line of the `code_list.txt` of its time. The repo's later 13,472-card list is for a model that was never published, so the build is pinned to the July 2024 commit. No bigger model exists anywhere public, and the README lists new-card generalisation as future work.
- **A card it doesn't know.** Sending its code is a 500 error. Sending code 0 (how a face-down card is sent) works: it plays on, blind to that card. So it can face any deck of ours, but can only play a deck from its 864. None of our decks qualifies (91 of the 349 cards in `data/cards.json` are covered).
- **Its lists** (`assets/deck`): Blue-Eyes, Hero, Cyber Dragon, Branded, Labrynth, Sky Striker, Snake-Eye, Shaddoll, Floowandereeze, Centur-Ion, Tenyi Swordsoul, Voiceless Voice, Blackwing, Chimera, Eldlich and others. These are its lists, not ours of the same name.
- **Unsupported by its schema:** more than one zone at once, sum with overflow, more than two must-select cards, a pick of zero cards.

### WindBot: not pursuing

[IceYGO/windbot](https://github.com/IceYGO/windbot) (MIT, C#) is a hand-scripted bot with 73 deck scripts and a generic any-deck player. Set aside because:
- each deck needs its own script, and none exists for Ojama or Super Quant;
- it joins as a network player, so our server would have to act as a YGOPro room (one to two weeks, with [purerosefallen/srvpro2](https://github.com/purerosefallen/srvpro2) as the reference), against an HTTP call for ygo-agent;
- it's a second runtime to host, and a take-back means reconnecting it and replaying the game;
- WindBot Ignite speaks EDOPro's protocol, not ours, and libWindbot is the same bot built for embedding in the Android apps.

Its generic player (`DefaultExecutor.cs`: attack-target logic, summon and set defaults, about 40 staples handled, card picks by hint) is the source for a rules bot of our own, if we want one.

Nothing else usable turned up: other projects are stale or have no published weights.

## Built

**The trained bot** (`server/ocg/agentBot.ts`, `docker-compose.yml`). ygo-agent runs as a service (`docker compose up -d ygo-agent`, `YGO_AGENT_URL` in `mise.toml`). For each question the engine asks the bot, the question and the table from its side go to the agent, and the most probable option is played. Cards outside its 864 go as code 0. A question it can't take, or a failed call, falls back to the random pick, silently. `duel.bot` in the game's file says which bot it is, so resume and rematch keep it; after a take-back or a restart it starts a fresh conversation with the agent.

**Its decks.** `npm run import-agent-decks` writes its 30 lists to `decks/trained-*.json`. Nothing marks a deck as the bot's: it can play any deck made only of cards it knows, which `GET /games/opponents` works out. They are ordinary decks, so you, the simple bot and Claude can play them too.

**New game screen.** An opponent dropdown (Simple bot, Trained bot, Claude) with a line about the choice and the reason when one isn't available; the opponent's deck list narrows to what it can play; the trained bot only starts from opening hands.

**Claude beside you in a bot game** (`prompts/advisor.md`). With a Claude login, a game against a bot has the chat panel with Claude in no seat: it sees what you see, answers nothing, and costs nothing until you ask. "Claude knows the bot's deck" is on by default, on the new game screen and in the chat's settings. Its tools: `table`, `card`, `deck` (your list and what's left in the Deck; the bot's list when it has it), `options` (your open question), `history`, and `tryLine`, which plays your picks on a copy of the game through the engine and reports what happens. Claude as the opponent has `deck` and `history` too.

`tryLine` assumes the bot passes wherever it could respond, and stops at any other decision of the bot's. The copy is the real game, so its draws are the real next cards: the table it reports shows them as hidden.

When you ask, Claude also gets what has happened this turn so far, and at the start of a game your notes on the deck and the misplays past reviews marked with it.

Its other tools: `lethal` (battle sums on stats), `odds` (drawing a card, from the Deck or an opening hand), `searchCards` (the app's cards, then every card printed by name, from YGOPRODeck), `rules` (`prompts/rules.md`, a short reference it quotes from), `point` (highlights cards on your screen), `offerTakeBack`, `flag` (a moment for the review, which is told of them), `note` (appends to `sessions/notes/<deck>.md`), `suggestDeck` (saves a changed list as `<deck>-suggested`), and from the trained bot `botMove` (how sure it was, its own win estimate) and `evaluate` (its estimate of your chances and the move it would pick for you, for decks it knows).

## Still to do

- `lethal` works from stats only; an engine search over attack orders would be exact.

### Maybe later: rules bot

A free opponent for the decks the trained bot can't play, and a better fallback than the random pick.

- Read `DefaultExecutor.cs` and `LuckyExecutor.cs` and list which heuristics need only the question and the table, and which lean on state WindBot tracks itself (what was summoned this turn, chain history). Port the first kind; decide per item on the second.
- `server/ocg/rulesBot.ts`: same signature as `botResponse`, plus the board state. Anything it has no rule for goes to the random pick.
- First rules, by how silly the random bot looks without them: attack only when it's safe or lethal, and pick the target; don't pass with lethal on board; summon the strongest it can and set the rest; destroy/banish/target the opponent's cards, not its own; pay costs with its weakest cards; chain staples only when they have something to hit; don't activate an effect with no legal use.
- Tests: fixed positions with one right answer (lethal on board, a safe attack, a bad one), and whole games against the random bot from seeds, where it should win most.
- Unknown: how much of `DefaultExecutor` is usable without mirroring WindBot's duel state.

## Open decisions

- Whether a fallback to the random pick leaves a line in the feed.
