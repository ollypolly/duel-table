# Spike: a better bot that costs nothing to play

**Status:** research only, nothing built. Checked 2026-10-01.

## Why

A game against the bot today is a game against random legal moves (`server/ocg/bot.ts`), which teaches nothing. A game against Claude is a real opponent but spends Claude usage on every move. The aim is an opponent that plays sensibly for free, leaving Claude for coaching, hints and reviews.

## What the spike should answer

1. Can an existing bot answer the questions our rules engine asks, with little enough glue to be worth it?
2. Does it play well enough against the Chazz decks to learn from?
3. What does it cost to run on servitor (memory, CPU per move, latency)?

## Options found

### ygo-agent (lead candidate)

[sbl1996/ygo-agent](https://github.com/sbl1996/ygo-agent): a neural net trained by self-play on ygopro-core. MIT licence. Last commit August 2024.

- **Runs as an HTTP service.** The repo's `Dockerfile` builds a Python 3.10 image with the `0546_26550M.tflite` checkpoint downloaded into it, served by uvicorn on port 3000. TensorFlow Lite on CPU, no GPU. The Dockerfile binds `127.0.0.1` inside the container, so it needs `--host 0.0.0.0` to be reachable.
- **API** (`ygoinf/ygoinf/server.py`, `models.py`): `POST /v0/duels` creates a duel, `DELETE /v0/duels/{id}` drops it, and a predict endpoint takes the open question plus the visible table. Each option carries a `response` number we choose; it returns a probability per option and a win rate. The question types match the engine's: idle command, chain, card, tribute, sum, yes/no, effect yes/no, position, place, option, announce number and attribute.
- **Fit.** It would replace the random pick in `server/ocg/bot.ts`: translate the engine's question and the table to their JSON, POST, play the most probable option. The translation of the table is the real work.
- **Card coverage.** `scripts/code_list.txt` lists 13,472 cards. Of the 349 in `data/cards.json`, 6 are missing: Super Quantum Black Layer, Super Quantal Fairy Zetan, Ojamandala, Dark Armed Dragon Punisher, Drill Armed Dragon, Fist Armed Dragon. Both Chazz decks are fully covered. Super Quant is not, so the bot needs another deck or a list without those two.
- **Trained decks** (`assets/deck`): Blue-Eyes, Branded, Labrynth, Sky Striker, Snake-Eye, Hero, Cyber Dragon, Shaddoll, Floowandereeze, Centur-Ion, Tenyi Swordsoul, Voiceless Voice, Blackwing and others, about 30 lists.

Unknown:
- How it plays a deck it never trained on, and how it copes with an opponent on one.
- What it does with cards outside its list (and anything released after August 2024).
- Cases its schema marks unsupported (more than one zone at once, sum with overflow, more than two must-select cards). These would fall back to the random bot.
- Memory and time per prediction on servitor.

### WindBot

A hand-scripted bot with one "executor" per deck. Plays its own deck's known lines competently; no general play.

- [ProjectIgnis/windbot](https://github.com/ProjectIgnis/windbot) (AGPL-3.0, C# on Mono) has 45+ decks but speaks EDOPro's network protocol.
- The older MyCard build ([nanahira/windbot](https://hub.docker.com/r/nanahira/windbot) Docker image) speaks the YGOPro protocol, which is the family our core (koishipro) comes from.
- **Fit.** It joins a game as a network player, so our server would have to act as a YGOPro room it can dial into. `ygopro-msg-encode` is the message library for that protocol, so it's feasible, but it's a bigger build than an HTTP call.
- No Super Quant or Ojama executor exists; the bot would play one of its own decks.

Unknown: which messages a room must send for WindBot to play, and whether its card database version matches ours.

### Rules for our own bot

No dependency. A few rules on top of the random bot: attack when it's safe, don't activate an effect with nothing to hit, summon the strongest monster available, don't pass with lethal on board. Far less silly, but it won't play combos. Worth doing as the fallback whichever option wins, since both have cases they can't answer.

## Proposed spike

Timebox: about half a day, ygo-agent first.

1. Build the image on servitor with the host fix and check `GET /` returns OK. Note image size and idle memory.
2. Send one hand-written idle-command question for a real position from a saved game and check the answer is legal and plausible. Time it.
3. Write the smallest translation that covers idle command, chain and select card, behind a flag, and let it play p2 in a bot-vs-bot game with a trained deck (Blue-Eyes). Count how often it falls back to random and whether the game finishes.
4. Play one game against it with the Pink Chazz deck and judge whether it's an opponent worth learning against.

Stop and write up if step 2 fails, or if step 3 falls back for more than a small share of questions. WindBot is the next thing to try in that case.

## Decision to make afterwards

Which bot, which decks it plays, and whether the bot picker in the app offers "Random", "Bot" and "Claude" as three levels.
