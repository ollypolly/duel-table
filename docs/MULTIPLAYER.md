# Playing a friend

**Status:** spike, nothing built. The aim is to play a game against a friend soon, with a group chat where both players and Claude talk. Proper accounts can come later.

## Decisions so far

- **Tailnet only.** The app stays off the public web. Friends get the machine shared with them on Tailscale and open the same `https://…ts.net` URL (see `docs/HOSTING.md`). Making it public would mean doing logins, rate limits and abuse protection properly, which is a much bigger job.
  - **Its own address.** Today it's `https://servitor.tail59f26.ts.net:10001`. Better: a second Tailscale node just for the app, named `duel`, at `https://duel.tail59f26.ts.net`. It runs as a `tailscale/tailscale` container on the host network in userspace mode, with its own state and a serve config proxying 443 to `127.0.0.1:5180`, and joins with an auth key from the admin console. Friends get only that node shared with them, not `servitor` with Plex, Portainer and the rest, and its `tailscale serve` adds the identity headers. Optional on top: the tailnet's DNS name can be swapped once for one of Tailscale's offered names (e.g. `something-something.ts.net`) in place of `tail59f26`, but that changes every machine's address, the other services' too. A Tailscale Service (`svc:duel`) also gives a name, but needs a tagged host and grants, and may not reach people a machine is shared with.
  - **Sharing:** admin console → Machines → the `duel` machine's menu → Share, which makes an invite link (or sends one by email). The friend signs in to Tailscale with any account it supports (Google, Microsoft, GitHub, Apple and others), installs the app on their phone or laptop, and opens the link. They see only this machine, and it can't reach anything of theirs.
- **Who you are comes from Tailscale.** `tailscale serve` adds identity headers to every request it proxies: `Tailscale-User-Login` (e.g. `alice@example.com`) and `Tailscale-User-Name`. This includes friends who've accepted a share of the machine, so there's no login screen to build. The headers aren't set for tagged devices or Funnel traffic.
- **The owner is the admin.** The owner's Tailscale login, set in config, sees and can do everything: every user's games, deleting, settings.
- **Claude runs on the owner's login for everyone.** It's one friend sending a few messages, so no API keys, spend limits or other infrastructure for now. Known trade-off: a Claude subscription's terms are for its holder's own use. If more people join, or usage grows, friends' runs move to an API key (see Later).

## What already works

- The rules engine runs a game with people answering both sides: `bots: []` on `POST /games` leaves both seats to whoever answers.
- Each session's changes go out to every open browser over its SSE stream, so both players see a move as soon as it's made.
- A game records the name for each side (`players.p1.name`, `players.p2.name`).

## What it needs, in build order

### 1. A game against a friend (the first slice)

- **Identity.** A small middleware reads `Tailscale-User-Login` and `Tailscale-User-Name` into the request. Locally (no headers) it's the owner, so development carries on as now. Only trust the headers on a request that came through `tailscale serve`, i.e. to the localhost-bound Vite or API. The nginx reverse proxy for `*.olly.live` must never forward to this app, or anyone could send the headers themselves.
- **Owners.** Each session gets `owner` and, for a game against a friend, the login playing each seat. `GET /sessions` lists only what you're in (the admin sees everything).
- **Play a friend.** In the New game dialog: pick your deck, get a link. Whoever opens it picks their deck and is seated as p2. Their Tailscale name goes on the seat.
- **Moves locked to your seat.** The game routes (answer, take back, forfeit) check that the request's user holds the seat being answered for. Spectating needs no seat.
- **Each player sees only their own hidden cards.** This is the important one. Today every browser is sent the whole game, including the other player's hand and the order of both Decks, and the board just doesn't draw them. A friend could read your hand from the network tab. The state sent over SSE has to be redacted per viewer: your hand and Set cards as they are, the other side's as face-down placeholders, both Decks as counts. The SSE stream becomes one per viewer rather than one per session. The step log (`duel.responses`, the narration) leaks the same way and needs the same treatment: a step's text can name a card the other player hasn't seen.
- **Take-backs need agreement.** In a game against a friend, Take back asks the other player first.
- **Someone drops out.** The game waits; their seat shows as away. A turn timer can come later.

### 2. Chat: one group chat, with @claude and hidden messages

- **One chat at the table.** Both players (and anyone watching) talk in it. Messages show who sent them, by Tailscale name.
- **Claude answers when it's called.** A message with `@claude` in it goes to Claude, along with what's been said since it last spoke, and it's told who said what. Anything else is just players talking, and costs nothing. The input's placeholder gives the hint ("Message the table, @claude to ask Claude"), and typing `@` offers it.
- **Hide this message.** A toggle by the input sends a message only to Claude: the other player doesn't see it, or Claude's reply to it. A hidden `@claude` can know your own hidden cards ("what should I play here?"); nothing hidden ever reaches the other player. A hidden message and its reply show to you with a "only you" mark.
- **What Claude knows.** For a message everyone sees, only what's public, since everyone reads its answer and it would otherwise give a hand away. For a hidden one, the public table plus the sender's own hand and Set cards. Today a game's Claude keeps one conversation that knows one side's cards; this needs each answer built from what that message's audience may see, and Claude told plainly what's private ("only Alex sees this, don't mention it in the open chat"). Its memory of one player's hidden messages mustn't come out in a later open answer: simplest is a separate conversation per player for hidden messages, and one for the open chat.
- **Sending.** The SSE stream sends each viewer the open messages plus their own hidden ones.
- Reviews of a finished game can see everything, since the game's over.

### 3. Fun at the table

The things you'd do across a real table, so it feels like playing a mate and not a form. All of it goes out over the session's stream like any other change, so both screens show it at once. The board already has sound effects for summons, attacks, damage and so on (`src/view/sounds.ts`, Kenney sounds in `public/sounds/`); these are the social ones on top.

- **Reactions.** A small tray by the chat with quick ones: a laugh, "nice", "no way", "hurry up", a drum roll, a sad trombone. Each plays a short sound on both screens and floats up over the sender's side of the board. A cooldown so it can't be spammed into noise.
- **Call-outs on big moments.** Optional voice lines on the moments the anime would shout: "I activate my trap card!", a summon of a boss monster, a hand trap stopping a combo, "it's time to duel" at the start. A setting turns them off.
- **React on a card.** Long-press (or right-click) any card on the table to stick an emoji on it for a few seconds: 😂 on an Ojama, 💀 on the monster that just got negated.
- **Slam it down.** A heavier landing, with a little screen shake and a thud, for a card played with a hold instead of a tap. For when it's earned.
- **Claude as the commentator.** `@claude` can be asked to commentate, and the group chat's Claude can be told to hype big moments in a line, like an announcer, without being asked each time. Off by default, since it costs a call per moment.
- **Thinking.** "Alex is thinking…" while the other player has a question open and hasn't answered for a while, and a nudge button that plays a tap sound on their screen.
- **The result.** A proper win screen for the winner and a sad one for the loser, with a rematch button right there.

Sounds come from a free pack (Kenney's, as now, or similar) or a few short clips recorded for fun; voice lines need checking for licensing rather than lifting from the anime.

### Later

- Friends' Claude on an API key instead of the owner's login, with a daily spend per friend (each run already reports its cost) and a hard monthly cap in the Anthropic Console. The Agent SDK takes `env` per run, so a friend's run can be given `ANTHROPIC_API_KEY` while the owner's falls back to the Claude Code login.
- Proper accounts: real sign-up and login, friends' own API keys stored encrypted against their account, maybe opening it up beyond the tailnet.

## If it moves into Docker

It runs today with `mise run dev` straight on the machine, where the Claude Code login is just the owner's `~/.claude`. In a container the login has to come in from outside, probably one of:

- `claude setup-token`, which makes a long-lived token for the owner's subscription, passed in as `CLAUDE_CODE_OAUTH_TOKEN` (through the chezmoi data file, like any secret);
- or the owner's `~/.claude/.credentials.json` mounted into the container, writable so the login can refresh.

Both need checking against the current Claude Code docs before relying on them. Tailscale identity carries on working as long as `tailscale serve` on the host proxies to the container's port.

## Open questions

- Decks: shared by everyone, or each user's own with the repo's as a starting set?
- A friend's first visit with no deck of their own: pick from the repo's decks?
- Mobile: the deck picker and the join link need to work on a phone, since that's where a friend will open it.

## Sources

- [Tailscale Serve: identity headers](https://tailscale.com/kb/1312/serve)
- [Sharing over Tailscale](https://tailscale.com/blog/sharing-over-tailscale)
