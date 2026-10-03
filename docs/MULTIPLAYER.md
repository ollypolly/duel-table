# Playing a friend

**Status:** spike, nothing built. The aim is to play a game against a friend soon, with friends able to use Claude within limits the owner sets. Proper accounts can come later.

## Decisions so far

- **Tailnet only.** The app stays off the public web. Friends get the machine shared with them on Tailscale and open the same `https://…ts.net` URL (see `docs/HOSTING.md`). Making it public would mean doing logins, rate limits and abuse protection properly, which is a much bigger job.
  - **Sharing:** admin console → Machines → the machine's menu → Share, which makes an invite link (or sends one by email). The friend signs in to Tailscale with any account it supports (Google, Microsoft, GitHub, Apple and others), installs the app on their phone or laptop, and opens the link. They see only this machine, and it can't reach anything of theirs.
- **Who you are comes from Tailscale.** `tailscale serve` adds identity headers to every request it proxies: `Tailscale-User-Login` (e.g. `alice@example.com`) and `Tailscale-User-Name`. This includes friends who've accepted a share of the machine, so there's no login screen to build. The headers aren't set for tagged devices or Funnel traffic.
- **The owner is the admin.** The owner's Tailscale login, set in config, sees and can do everything: every user's games, deleting, settings.
- **Claude: the owner on their login, friends on the owner's API key.** The owner's Claude runs use the Claude Code login on the machine, as now. A friend's runs use an Anthropic API key of the owner's, paid per use, with limits (below). Not the owner's login: a Claude subscription is for its holder's own use, so a friend's request never runs on it. Friends bringing their own keys waits for proper accounts.

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

### 2. Claude where friends can see it

- Your Claude chat in a game is already sent to everyone watching. Only the seat holder whose login or key runs it should be able to send to it, or a friend is spending your plan.
- **Private chats.** In a game against a friend each player gets their own chat with Claude, sent only to them, for advice ("what should I do here?"). It can know their hidden cards and nobody else's. A table chat everyone sees is optional: if there is one, it only knows what both players can see, since "Send Claude my hidden cards" there would show your hand to your opponent through its answers. Today a game has one Claude seat; this makes it one per player, each with its own conversation and settings, and the SSE stream sends each viewer only their own.
- Reviews of a finished game can see everything, since the game's over.

### 3. Limits on friends' Claude

The point is that a friend can't run up the owner's bill. Each run already reports its cost, so limits can be on money rather than guesses:

- **A daily spend per friend**, e.g. $1, set by the owner. Once it's used up, Claude features are off for them until tomorrow, with a line saying so. The owner can raise it or reset it.
- **One run at a time per friend**, and no Opus for friends (Sonnet or Haiku), set server-side, not just hidden in the UI.
- **Background tries off for friends.** "Can Claude win it?" can run a whole game unattended, so it stays owner-only.
- **A hard cap at Anthropic too.** The API key sits in its own workspace in the Anthropic Console with a monthly spend limit, so a bug in the app's limits can't spend more than that.
- **The key** lives in the chezmoi data file and reaches the server as an environment variable that only friends' runs are given. The Agent SDK takes `env` per run (`server/claude/agent.ts` already sets it): a friend's run passes `ANTHROPIC_API_KEY`, the owner's passes none and falls back to the Claude Code login. So the server process itself must not have `ANTHROPIC_API_KEY` in its environment, or the owner's runs would use it too: read it under another name.
- A friend with Claude off still gets everything that needs no Claude: games against each other or the bots, preset lessons, free play.

### 4. Later: proper accounts

Real sign-up and login in the app, friends' own API keys stored encrypted against their account, and maybe opening it up beyond the tailnet. Not needed to play a friend.

## If it moves into Docker

It runs today with `mise run dev` straight on the machine, where the Claude Code login is just the owner's `~/.claude`. In a container the login has to come in from outside, probably one of:

- `claude setup-token`, which makes a long-lived token for the owner's subscription, passed in as `CLAUDE_CODE_OAUTH_TOKEN` (through the chezmoi data file, like any secret);
- or the owner's `~/.claude/.credentials.json` mounted into the container, writable so the login can refresh.

Both need checking against the current Claude Code docs before relying on them. Tailscale identity carries on working as long as `tailscale serve` on the host proxies to the container's port.

## Open questions

- Decks: shared by everyone, or each user's own with the repo's as a starting set?
- Whether friends can start Claude-run lessons within their daily limit, or only use Claude in games to begin with.
- A friend's first visit with no deck of their own: pick from the repo's decks?
- Mobile: the deck picker and the join link need to work on a phone, since that's where a friend will open it.

## Sources

- [Tailscale Serve: identity headers](https://tailscale.com/kb/1312/serve)
- [Sharing over Tailscale](https://tailscale.com/blog/sharing-over-tailscale)
