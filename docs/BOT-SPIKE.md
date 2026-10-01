# Spike: a better bot that costs nothing to play

**Status:** the ygo-agent container runs on servitor and answers a hand-written question (2026-10-01). No translation from our engine yet.

## Why

A game against the bot today is a game against random legal moves (`server/ocg/bot.ts`), which teaches nothing. A game against Claude is a real opponent but spends Claude usage on every move. The aim is an opponent that plays sensibly for free, leaving Claude for coaching, hints and reviews.

## What the spike should answer

1. Can an existing bot answer the questions our rules engine asks, with little enough glue to be worth it?
2. Does it play well enough against the Chazz decks to learn from?
3. What does it cost to run on servitor (memory, CPU per move, latency)?

## Options found

### ygo-agent (lead candidate)

[sbl1996/ygo-agent](https://github.com/sbl1996/ygo-agent): a neural net trained by self-play on ygopro-core. MIT licence. Last commit August 2024.

- **Runs as an HTTP service.** `docker compose up -d ygo-agent` builds `docker/ygo-agent/Dockerfile` and serves it on `127.0.0.1:5182`. TensorFlow Lite on CPU, no GPU. Measured: 271 MB image, 83 MB of memory idle, under 10 ms per prediction.
- **API** (`ygoinf/ygoinf/server.py`, `models.py`): `POST /v0/duels` creates a duel, `DELETE /v0/duels/{id}` drops it, and a predict endpoint takes the open question plus the visible table. Each option carries a `response` number we choose; it returns a probability per option and a win rate. The question types match the engine's: idle command, chain, card, tribute, sum, yes/no, effect yes/no, position, place, option, announce number and attribute.
- **Fit.** It would replace the random pick in `server/ocg/bot.ts`: translate the engine's question and the table to their JSON, POST, play the most probable option. The translation of the table is the real work.
- **Card coverage: 864 cards.** The released checkpoint (`0546_26550M.tflite`, July 2024) has an embedding per line of the `code_list.txt` of its time, 864 cards. The repo's later 13,472-card list is for a model that was never published, so the build is pinned to the July 2024 commit. None of our decks is fully covered (91 of the 349 cards in `data/cards.json` are).
- **A card it doesn't know.** Sending its code is a 500 error. Sending code 0 (how a face-down or unknown card is sent) works: it plays on, treating the card as unknown. So it can face any deck of ours, blind to the cards it wasn't trained on, but it can only play a deck from its 864.
- **Trained decks** (`assets/deck`, 30 lists): Blue-Eyes, Hero, Cyber Dragon, Branded, Labrynth, Sky Striker, Snake-Eye, Shaddoll, Floowandereeze, Centur-Ion, Tenyi Swordsoul, Voiceless Voice, Blackwing, Chimera, Eldlich and others. These are its own lists, not ours of the same name.

Unknown:
- How well it plays against a deck made mostly of cards it sees as unknown.
- Cases its schema marks unsupported (more than one zone at once, sum with overflow, more than two must-select cards, a pick of zero cards). These would fall back to the random bot.

### WindBot

A hand-scripted bot with one "executor" per deck. Plays its own deck's known lines competently; no general play.

- [ProjectIgnis/windbot](https://github.com/ProjectIgnis/windbot) (AGPL-3.0, C# on Mono) has 45+ decks but speaks EDOPro's network protocol.
- The older MyCard build ([nanahira/windbot](https://hub.docker.com/r/nanahira/windbot) Docker image) speaks the YGOPro protocol, which is the family our core (koishipro) comes from.
- **Fit.** It joins a game as a network player, so our server would have to act as a YGOPro room it can dial into. `ygopro-msg-encode` is the message library for that protocol, so it's feasible, but it's a bigger build than an HTTP call.
- No Super Quant or Ojama executor exists; the bot would play one of its own decks.

Unknown: which messages a room must send for WindBot to play, and whether its card database version matches ours.

### Rules for our own bot

No dependency. A few rules on top of the random bot: attack when it's safe, don't activate an effect with nothing to hit, summon the strongest monster available, don't pass with lethal on board. Far less silly, but it won't play combos. Worth doing as the fallback whichever option wins, since both have cases they can't answer.

## Spike

Done:
1. The container builds, starts and returns OK.
2. A hand-written idle-command question (Blue-Eyes opening hand) gets a probability per option, in 9 ms.

Next:
3. Write the smallest translation that covers idle command, battle command, chain and select card, behind a flag, and let it play p2 in a bot-vs-bot game with its Blue-Eyes list. Count how often it falls back to random and whether the game finishes. It keeps state per duel (`index`, and the option picked last time), so a take-back needs a fresh duel replayed up to that point.
4. Play one game against it with the Pink Chazz deck and judge whether it's an opponent worth learning against.

Stop and write up if step 3 falls back for more than a small share of questions. WindBot is the next thing to try in that case.

## Decision to make afterwards

Which bot, which decks it plays, and whether the bot picker in the app offers "Random", "Bot" and "Claude" as three levels.
