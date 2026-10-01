# Plan: bots worth playing, for free

**Status:** rough plan, nothing built beyond the ygo-agent container. Research checked 2026-10-01.

## Why

A game against the bot today is a game against random legal moves (`server/ocg/bot.ts`), which teaches nothing. A game against Claude is a real opponent but spends Claude usage on every move. The aim is opponents that play sensibly for free, leaving Claude for coaching, hints and reviews.

## The shape

No single bot plays every deck well, so there are several, and the opponent you pick decides which answers the engine's questions:

| Opponent | Plays | How |
|---|---|---|
| **Rules bot** | any deck | our own bot, with WindBot's generic heuristics ported to TypeScript |
| **Trained bot** (ygo-agent) | its own 30 lists | HTTP call to a container |
| **Claude** | any deck | as today |
| WindBot, later if wanted | its 73 scripted decks | joins as a network player |

The random bot stays for tests. The rules bot is also the fallback when another bot can't answer a question or is down.

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

### WindBot

[IceYGO/windbot](https://github.com/IceYGO/windbot) (MIT, C# on Mono, active): a hand-scripted bot with one "executor" per deck, 73 of them, speaking the YGOPro protocol our core's family uses.

- **Any deck.** `LuckyExecutor` sits on `DefaultExecutor.cs`: attack-target logic, summon/set/reposition defaults, sensible handling of about 40 staples (Ash Blossom, Veiler, Solemns, Raigeki), card picks by hint (enemy cards first to destroy, lowest ATK as material), and a coin flip for other effects. Better than random; no combos.
- **Scripted decks** beyond ygo-agent's: Dark Magician, Albaz, Altergeist, Dogmatika, Dragunity, Exosister, Kashtira, Lightsworn, Mathmech, Orcust, Salamangreat, Tearlaments, Thunder Dragon, Zoodiac and more. None for Super Quant or Ojama.
- **To run the real thing** our server would act as a YGOPro room: a TCP listener, about ten join/deck/ready messages and a relay of game messages. [purerosefallen/srvpro2](https://github.com/purerosefallen/srvpro2) (MIT, TypeScript) does this on the same `koishipro-core.js` and `ygopro-msg-encode` versions we use, so it's a reference to copy from.

Nothing else usable turned up: other projects are stale or have no published weights.

## Plan

### 1. Rules bot

The one that plays the decks we have, and everyone's fallback.

- Read `DefaultExecutor.cs` and `LuckyExecutor.cs` and list which heuristics need only the question and the table, and which lean on state WindBot tracks itself (what was summoned this turn, chain history). Port the first kind; decide per item on the second.
- `server/ocg/rulesBot.ts`: same signature as `botResponse`, plus the board state. Anything it has no rule for goes to the random pick.
- First rules, by how silly the random bot looks without them: attack only when it's safe or lethal, and pick the target; don't pass with lethal on board; summon the strongest it can and set the rest; destroy/banish/target the opponent's cards, not its own; pay costs with its weakest cards; chain staples only when they have something to hit; don't activate an effect with no legal use.
- Tests: fixed positions with one right answer (lethal on board, a safe attack, a bad one), and whole games against the random bot from seeds, where it should win most.
- Unknown: how much of `DefaultExecutor` is usable without mirroring WindBot's duel state.

### 2. Which bot, per game

- `duel.bots` (which players are bots) gains which bot each is: `random`, `rules`, `agent`. Saved with the game, so resume and rematch keep it. Replays don't change, since answers are already recorded.
- `GameService` asks a bot through one interface: given the question and the state, return a response, or nothing to fall through to the next bot.
- An opponents endpoint (alongside the Claude status) says which are available and which decks each can play.

### 3. New game screen

- **Opponent dropdown** in place of the radios, with a line under it that changes with the choice: Rules bot (free, plays sensibly), Trained bot (free, plays to win with its own decks), Claude (plays to win, chats and coaches, uses your plan). An unavailable one stays listed but disabled, with the reason.
- **Three groups:** Opponent, Decks, Options. Claude's model and coach toggle show only for Claude; Start from moves into Options.
- **Deck pickers:** the opponent's list narrows to what that opponent can play.
- Lessons keep the same dialog and layout, without the opponent picker.

Doesn't depend on the bots beyond step 2, so it can ship with Rules bot and Claude and gain Trained bot later.

### 4. Trained bot

- `server/ocg/agentBot.ts`: translate the question and the table from its side to the agent's JSON, post it, play the most probable option. Cards outside its list go as code 0. Start with idle command, battle command, chain and select card, then the rest.
- A duel on the agent per game, dropped when the game ends; rebuilt by replaying its answers after a take-back or a server restart.
- `YGO_AGENT_URL` in the environment; unset or unreachable means the option is unavailable, and a failure mid-game falls back to the rules bot.
- Decks: add its lists as decks of ours, marked as playable by the trained bot (cards into `data/cards.json`, images fetched). Start with Blue-Eyes, Hero and Cyber Dragon.
- Check before building the rest: a bot-vs-bot game with its Blue-Eyes list finishes, falling back on only a small share of questions; then one game against it with the Pink Chazz deck to judge how it copes with cards it can't see.

### 5. Real WindBot, only if its decks are wanted

A minimal room copied from srvpro2, with WindBot in a container. One to two weeks. Unknown: Mono's memory use, whether its card database and protocol version match ours, and take-back with a connected player.

## Open decisions

- Order: this plan goes rules bot, picker, screen, trained bot. The screen could go first with today's two opponents.
- What the opponents are called in the picker.
- Whether a fallback is silent or leaves a line in the feed.
