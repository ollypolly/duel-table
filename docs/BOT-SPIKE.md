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

No bigger model exists publicly (checked 2026-10-01): the only release is v0.1, no fork or Hugging Face repo carries weights, and the README lists new-card generalisation as future work.

### WindBot

A hand-scripted bot with one "executor" per deck, plus generic ones that play any deck.

- **Forks.** [IceYGO/windbot](https://github.com/IceYGO/windbot) (MIT, C# on Mono, active) has 73 executors and speaks the YGOPro protocol, the family our core (koishipro) comes from. ProjectIgnis/windbot has 66 and speaks EDOPro's.
- **Any deck.** `LuckyExecutor` and `DoEveryThingExecutor` sit on `DefaultExecutor.cs`: attack-target logic, summon/set/reposition defaults, sensible handling of about 40 staples (Ash Blossom, Veiler, Solemns, Raigeki), card picks by hint (enemy cards first to destroy, lowest ATK as material), and a coin flip for other effects. Better than random with any deck; no combos.
- **Scripted decks** beyond ygo-agent's: Dark Magician, Albaz, Altergeist, Dogmatika, Dragunity, Exosister, Kashtira, Lightsworn, Mathmech, Orcust, Salamangreat, Tearlaments, Thunder Dragon, Zoodiac and more. None for Super Quant or Ojama.
- **Fit.** It joins as a network player, so our server would act as a YGOPro room: a TCP listener, about ten join/deck/ready messages and a relay of game messages. [purerosefallen/srvpro2](https://github.com/purerosefallen/srvpro2) (MIT, TypeScript) does this on the same `koishipro-core.js` and `ygopro-msg-encode` versions we use, with WindBot support and a rewind service, so it's a reference to copy from.

Unknown: Mono's memory use, whether its card database and protocol version match ours, and how take-back works with a connected bot.

### Rules for our own bot

No dependency: port WindBot's generic heuristics (`DefaultExecutor`) to TypeScript in `server/ocg/bot.ts`. Any deck, no new service. Unknown: how much of it leans on the duel state WindBot tracks, which we'd have to mirror. Worth doing whichever other bot is added, as the fallback for questions they can't answer.

## Several bots

Each deck records which bot can play it, and picking the opponent's deck picks the bot:
1. **Rules bot** (the WindBot port) for any deck. Days of work.
2. **ygo-agent** for its 30 lists, as the strong opponent. The work is translating the table.
3. **Real WindBot** for its 73 scripted decks, if those are wanted. One to two weeks, for the room.

## Spike

Done:
1. The container builds, starts and returns OK.
2. A hand-written idle-command question (Blue-Eyes opening hand) gets a probability per option, in 9 ms.

Next:
3. Write the smallest translation that covers idle command, battle command, chain and select card, behind a flag, and let it play p2 in a bot-vs-bot game with its Blue-Eyes list. Count how often it falls back to random and whether the game finishes. It keeps state per duel (`index`, and the option picked last time), so a take-back needs a fresh duel replayed up to that point.
4. Play one game against it with the Pink Chazz deck and judge whether it's an opponent worth learning against.

Stop and write up if step 3 falls back for more than a small share of questions.

## Decision to make afterwards

Which bot, which decks it plays, and whether the bot picker in the app offers "Random", "Bot" and "Claude" as three levels.
