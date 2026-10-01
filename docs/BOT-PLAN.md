# Plan: bots worth playing, for free

**Status:** rough plan, nothing built beyond the ygo-agent container. Research checked 2026-10-01.

## Why

A game against the bot today is a game against random legal moves (`server/ocg/bot.ts`), which teaches nothing. A game against Claude is a real opponent but spends Claude usage on every move. The aim is opponents that play sensibly for free, leaving Claude for coaching, hints and reviews.

## The shape

No single bot plays every deck well, so there are several, and the opponent you pick decides which answers the engine's questions:

| Opponent | Plays | How |
|---|---|---|
| **Simple bot** | any deck | today's random legal moves |
| **Trained bot** (ygo-agent) | its own 30 lists | HTTP call to a container |
| **Claude** | any deck | as today |
| Rules bot, later | any deck | our own bot, with WindBot's generic heuristics ported to TypeScript |
| WindBot, later if wanted | its 73 scripted decks | joins as a network player |

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

### WindBot

[IceYGO/windbot](https://github.com/IceYGO/windbot) (MIT, C# on Mono, active): a hand-scripted bot with one "executor" per deck, 73 of them, speaking the YGOPro protocol our core's family uses.

- **Any deck.** `LuckyExecutor` sits on `DefaultExecutor.cs`: attack-target logic, summon/set/reposition defaults, sensible handling of about 40 staples (Ash Blossom, Veiler, Solemns, Raigeki), card picks by hint (enemy cards first to destroy, lowest ATK as material), and a coin flip for other effects. Better than random; no combos.
- **Scripted decks** beyond ygo-agent's: Dark Magician, Albaz, Altergeist, Dogmatika, Dragunity, Exosister, Kashtira, Lightsworn, Mathmech, Orcust, Salamangreat, Tearlaments, Thunder Dragon, Zoodiac and more. None for Super Quant or Ojama.
- **To run the real thing** our server would act as a YGOPro room: a TCP listener, about ten join/deck/ready messages and a relay of game messages. [purerosefallen/srvpro2](https://github.com/purerosefallen/srvpro2) (MIT, TypeScript) does this on the same `koishipro-core.js` and `ygopro-msg-encode` versions we use, so it's a reference to copy from.

Nothing else usable turned up: other projects are stale or have no published weights.

## Plan

The trained bot first. The rules bot and WindBot are left for later.

### 1. Which bot, per game

- `duel.bots` (which players are bots) gains which bot each is: `random` or `agent` (and `rules` later). Saved with the game, so resume and rematch keep it. Replays don't change, since answers are already recorded.
- `GameService` asks a bot through one interface: given the question and the state, return a response, or nothing to fall through to the next bot.
- An opponents endpoint (alongside the Claude status) says which are available and which decks each can play.

**Decks say who can play them.** Claude and the simple bot play any deck. A bot with its own lists plays only those, so each of its lists is added to `decks/` as a deck of ours, marked with the bot it belongs to (a field on the deck file, say `bot: "agent"`). A marked deck is still an ordinary deck: you, the simple bot and Claude can play it too. Adding one means its cards go into `data/cards.json` and its images are fetched, so a script imports a list from the bot's own format (`.ydk`) rather than typing it out.

### 2. Trained bot

- `server/ocg/agentBot.ts`: translate the question and the table from its side to the agent's JSON, post it, play the most probable option. Cards outside its list go as code 0. Start with idle command, battle command, chain and select card, then the rest.
- A duel on the agent per game, dropped when the game ends; rebuilt by replaying its answers after a take-back or a server restart.
- `YGO_AGENT_URL` in the environment; unset or unreachable means the option is unavailable, and a question it can't answer, or a failure mid-game, falls back to the random pick.
- Decks: import its lists from `assets/deck` as decks of ours, marked as the trained bot's. Blue-Eyes, Hero and Cyber Dragon first, then the rest of the 30.
- Check before building the rest: a bot-vs-bot game with its Blue-Eyes list finishes, falling back on only a small share of questions; then one game against it with the Pink Chazz deck to judge how it copes with cards it can't see.

### 3. New game screen

- **Opponent dropdown** in place of the radios, with a line under it that changes with the choice: Simple bot (random legal moves, instant), Trained bot (free, plays to win with its own decks), Claude (plays to win, chats and coaches, uses your plan). An unavailable one stays listed but disabled, with the reason.
- **Three groups:** Opponent, Decks, Options. Claude's model and coach toggle show only for Claude; Start from moves into Options.
- **Deck pickers:** the opponent's list narrows to what that opponent can play: every deck for the simple bot and Claude, only its own for the trained bot.
- Lessons keep the same dialog and layout, without the opponent picker.

Doesn't depend on the trained bot beyond step 1, so it could ship first with today's two opponents.

### 4. In-game Claude improvements

Claude is worth having at the table even when it isn't the opponent, and its advice is only as good as what it can look up. Today it has three tools in a game (`table`, `card`, and `answer` when it's playing), and it only sees your hidden cards and your open question when you talk to it or turn sharing on.

**Claude as coach in a bot game.** A game against a bot can have Claude beside you: the same chat panel, with no seat. It answers when you ask and costs nothing while you don't. It's on your side, so it sees what you see (your hand, your face-downs, your Extra Deck, your open question) and never the bot's hidden cards. It does know the bot's full decklist, as a player who knows the matchup would: a checkbox, "Claude knows the opponent's deck", on by default on the new game screen and in the chat's settings. Off, it knows only what has been played. Against Claude as the opponent nothing changes: it sees your side only when you show it.

**Context it should always have when you ask.** Mostly there today for the table; the rest is new.
- Your open question as you see it: what it's for, which effect is asking, whether it costs you, and every option.
- What has been used up this turn: the Normal Summon, each once-per-turn effect already activated, attacks declared.
- The chain as it stands and what just resolved.
- The last few moves by both sides, not only those since it last looked.
- Your decklist and what's left in the Deck, so it stops guessing what you can still search.
- Who the opponent is (simple bot, trained bot, itself) and, for a bot, its decklist when the checkbox is on.
- What you're trying to learn: your notes on this deck (`docs/DECK-NOTES.md` is the start of this) and the misplays past reviews marked with it.

**Tools to add.** Roughly in order of how much better they'd make the advice.
- `deck`: your decklist with counts, and what's still in the Deck, hand, GY and banished by card. "Is there an Ojama Black left to search" should be a lookup, not a memory test. Its own list too when it's playing.
- `options`: your open question and its legal options, on demand, without you having to speak first.
- `tryLine`: play a line on a copy of the duel and report what happens (what resolves, what the opponent could respond with from open information, the table after). The game is a list of answers replayed through the engine, so a copy is cheap. This turns "I think that works" into "I checked it works", and catches the wrong-ruling advice it gives today. The copy mustn't leak hidden cards: the opponent's hidden cards and both Decks' order are reshuffled in it.
- `history`: the moves so far, by turn, and `tableAt(step)` for the table at any of them (the review already has this).
- `lethal`: whether there is lethal on board this turn and the attacks that get there, from the engine's own damage numbers.
- `odds`: the chance of drawing or opening a card or combination, from the deck counts (hypergeometric), for deck-building questions.
- `searchCards`: find cards in the full card database by name, archetype or text, for "what else could this deck run". `card` already gives one card's text.
- `rules`: look up a rules topic (missing the timing, damage step, chain order, once per turn against once per chain) in a short reference we write, so it quotes the rule rather than recalling it.
- `ruling`: for a card interaction it's unsure of, ask the engine through `tryLine` rather than assert it.
- `point`: highlight a card or an option on your screen while it explains, as the lesson's prompts already can.
- `offerTakeBack`: offer to rewind to a moment so you can try the better play, using the same rewind as take-back.
- `mark`: note a moment for the review afterwards, so the review starts from what came up in the game.
- `note`: save something to your notes on this deck (a rule of thumb, a card to cut) and read them back next game.
- `suggestDeck`: propose a changed list as a new deck beside the old one, for you to accept or not.
- `botMove`: why the bot did what it just did (the rule that fired, or the trained bot's probabilities and win rate), so Claude can explain the opponent's play instead of guessing.
- `evaluate`: the trained bot's win-rate estimate for the position and its preferred move from your side, where your cards are within its 864. A second opinion Claude can weigh, not an answer.

**Prompt.** `prompts/coach.md` should tell it to look things up before advising: check the deck before saying what can be searched, try the line before promising it works, and say so when it couldn't check. A tip should name the play, the reason, and what to watch for next.

**Order.** Coach seat in bot games and the always-there context first, with `deck`, `options` and `history`. Then `tryLine`, which `lethal`, `ruling` and `offerTakeBack` build on. The rest as they come up.

### Later: rules bot

A free opponent for the decks the trained bot can't play, and a better fallback than the random pick.

- Read `DefaultExecutor.cs` and `LuckyExecutor.cs` and list which heuristics need only the question and the table, and which lean on state WindBot tracks itself (what was summoned this turn, chain history). Port the first kind; decide per item on the second.
- `server/ocg/rulesBot.ts`: same signature as `botResponse`, plus the board state. Anything it has no rule for goes to the random pick.
- First rules, by how silly the random bot looks without them: attack only when it's safe or lethal, and pick the target; don't pass with lethal on board; summon the strongest it can and set the rest; destroy/banish/target the opponent's cards, not its own; pay costs with its weakest cards; chain staples only when they have something to hit; don't activate an effect with no legal use.
- Tests: fixed positions with one right answer (lethal on board, a safe attack, a bad one), and whole games against the random bot from seeds, where it should win most.
- Unknown: how much of `DefaultExecutor` is usable without mirroring WindBot's duel state.

### Later: real WindBot, only if its decks are wanted

A minimal room copied from srvpro2, with WindBot in a container, and each executor's list (`Decks/*.ydk`) imported as a deck of ours marked as WindBot's. One to two weeks. Unknown: Mono's memory use, whether its card database and protocol version match ours, and take-back with a connected player.

## Open decisions

- What the opponents are called in the picker.
- Whether a fallback is silent or leaves a line in the feed.
