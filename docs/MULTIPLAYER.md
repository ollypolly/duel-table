# Playing a friend

**Status:** spike, nothing built. The aim is to play a game against a friend soon, with a group chat where both players and Claude talk. Proper accounts can come later.

## Decisions so far

- **Tailnet only.** The app stays off the public web. Friends get the machine shared with them on Tailscale and open the same `https://…ts.net` URL (see `docs/HOSTING.md`). Making it public would mean doing logins, rate limits and abuse protection properly, which is a much bigger job.
  - **Its own address: `duel.olly.live`, the way `budget.olly.live` works.** Today it's `https://servitor.tail59f26.ts.net:10001`. `budget.olly.live` has a public A record pointing at servitor's tailnet IP (`100.93.150.67`), and the host's nginx has a server block listening only on that IP (`listen 100.93.150.67:443 ssl`, in `/etc/nginx/sites-available/reverse-proxy`) proxying to the app on localhost. Only tailnet devices can reach it. `duel.olly.live` would be the same: an A record, a server block proxying to `127.0.0.1:5180` with the WebSocket/SSE headers, and the `.olly.live` host added to Vite's allowed hosts.
    - **The certificate.** A tailnet-only name can't pass Let's Encrypt's HTTP check, so budget's was issued by hand with a DNS challenge (`authenticator = manual` in `/etc/letsencrypt/renewal/budget.olly.live.conf`), which `certbot.timer` can't renew: it expired on 2026-09-17. Fixing it for both names, as part of this work:
      1. **A Netlify token.** `olly.live`'s DNS is on Netlify (the `dns*.p01.nsone.net` nameservers). A personal access token from Netlify (User settings → Applications) goes in the chezmoi data file as `[netlify] token`, templated to `~/.config/netlify/token` (private), like the ngrok token.
      2. **A certbot hook** (`certbot-netlify-dns auth|cleanup`, kept in the dotfiles' `bin/`): `auth` adds the `_acme-challenge.<name>` TXT record through Netlify's API and waits until Netlify's nameservers serve it, `cleanup` deletes it. Certbot 2.1 on the box runs it as root, so it's installed as a root-owned copy (`/etc/letsencrypt/netlify-dns`) rather than run from the home directory.
      3. **Re-issue budget and issue duel** with `certbot certonly --manual --preferred-challenges dns --manual-auth-hook '… auth' --manual-cleanup-hook '… cleanup' --deploy-hook 'systemctl reload nginx'`, once per name. Certbot saves the hooks in each renewal config, so the timer renews both from then on. `certbot renew --dry-run` proves it.
      4. **The `duel.olly.live` site:** its own file in `sites-available` (budget's block is in the shared `reverse-proxy` file), listening on `100.93.150.67`, proxying to `127.0.0.1:5180` with the upgrade headers, `proxy_buffering off` and a long `proxy_read_timeout`, since live games are an event stream. Then `nginx -t` and a reload, after the certificate exists.
      5. **The A record** `duel.olly.live → 100.93.150.67`, through the same Netlify API, and `duel.olly.live` in Vite's `allowedHosts`.
    - **Who's who.** Through nginx there are no Tailscale identity headers. Either Tailscale's `nginx-auth` helper (nginx asks it who the tailnet caller is, and passes the login on as headers), or for one friend simply asking for a name the first time, kept in the browser.
    - **What the friend can reach.** nginx listens on servitor's own tailnet IP, so the friend needs servitor shared with them, which on its own would let them reach everything else listening there (Plex, Portainer). The tailnet policy can limit people a machine is shared with (`autogroup:shared`) to port 443 on it.
    - **The alternative** is a second Tailscale node just for the app, at `https://duel.tail59f26.ts.net`: a `tailscale/tailscale` container that serves the app and is shared on its own, with identity headers for free, but a `.ts.net` name.
  - **Sharing:** admin console → Machines → the machine's menu → Share, which makes an invite link (or sends one by email). The friend signs in to Tailscale with any account it supports (Google, Microsoft, GitHub, Apple and others), installs the app on their phone or laptop, and opens the link. They see only this machine, and it can't reach anything of theirs.
- **Basic accounts: a name and a key in the browser.** A first visit asks for a name and makes an account; the browser keeps its key and sends it with every request. No passwords. Things have owners, and you can only change your own (see Accounts). Going through nginx (above) there are no Tailscale identity headers, so this is the app's own; Tailscale's `nginx-auth` helper could replace the key with real Tailscale logins later.
- **You're the admin.** Your account is made by the backfill (see Accounts) and can change and delete anything.
- **Claude runs on the owner's login for everyone.** It's one friend sending a few messages, so no API keys, spend limits or other infrastructure for now. Known trade-off: a Claude subscription's terms are for its holder's own use. If more people join, or usage grows, friends' runs move to an API key (see Later).

## What already works

- The rules engine runs a game with people answering both sides: `bots: []` on `POST /games` leaves both seats to whoever answers.
- Each session's changes go out to every open browser over its SSE stream, so both players see a move as soon as it's made.
- A game records the name for each side (`players.p1.name`, `players.p2.name`).

## The flow

- **Starting one.** New game gets a third opponent beside the bot and Claude: **A friend**. You pick your deck as now. It makes the game with p2 empty and shows a link (`duel.olly.live/?join=<code>`) to copy or share.
- **Joining: a join screen.** The link opens it rather than the table, built for a phone first since that's where it'll be opened. "Olly wants a duel", who they're playing and with what deck, then what they pick:
  - **Name**, remembered for next time.
  - **Deck**, from the global decks, with the same picker as New game.
  - **Sleeves**, defaulting to what that browser last used (cosmetics are per browser), so they turn up on your screen too.
  - **"Ask me to respond"**: how often the game stops to offer them a chain, as in a bot game, defaulting to the usual.
  
  Join seats them as p2 and the game starts. The first person to join takes the seat; anyone opening the link after that gets a "watch" button instead.
- **Who holds a seat: their account, not an IP.** Joining puts their account on p2, and only requests from that account can answer for it. Tailnet IPs are stable, but they'd tie a seat to one device, so a phone and a laptop would be two different players.
- **Rejoining.** The game is on their home page under On the go, on any device signed in to their account, and opening it puts them back in their seat. You can "Free the seat" from the game's … menu if they need to join again from scratch.
- **Looking around.** They can leave the table, look at decks, lessons and anything else, and come back; the game waits. Their home page shows the game, so getting back is one tap.
- **Decks.** Everyone uses the global decks and can edit them, as now. A game keeps its own copy of each list, so editing a deck mid-game changes nothing in it. Sleeves, deck boxes and playmats are kept per browser, so for the other player to see yours they'd go with the seat when you join.



## Accounts

Basic ones, so things have owners and a friend can only change their own.

- **An account** is a username, a display name and a key (a long random string). They're kept in `sessions/accounts.json` (gitignored), with the key stored hashed. Making one: a first visit with no key in the browser asks for a username and what to call you, and makes it. The join screen does the same, so a friend's first click on your link makes their account and joins in one go.
- **Usernames** are short, lowercase and unique (`olly`, `rob`), and never change; the display name can. Everything is owned by username, so moving to real accounts later (a password, or a Tailscale login through `nginx-auth`) only changes how you prove you're `rob`, not what `rob` owns.
- **Signing in on another device.** Settings → "Use on another device" shows a link (and a QR code for a phone) with the key in it; opening it signs that browser in. Lose every device and the admin can make a new key for the account. No passwords or email.
- **Owners.** Every session (game, lesson, free table, review), deck, Claude chat on the home page and idea gets `owner`: the account that made it. A game against a friend is also changeable by the account in the other seat, for the things a player does (moves, chat, rematch), but only its owner can rename or delete it.
- **What owning means.** Rename, edit, delete and settings check the caller owns the thing or is the admin; the server refuses otherwise, and the UI hides what you can't do. Reading stays open to everyone. Using someone else's deck in a game is fine: the game keeps its own copy.
- **Decks.** Each account has its own: the Decks panel shows yours, with everyone else's under "Other players' decks" to look at, copy, or play with (a game keeps its own copy of the list). The repo's decks are yours. A friend's decks aren't committed: they're saved under `sessions/decks/<username>/` (gitignored), where the repo's stay in `decks/`. A friend who wants to change one of yours makes a copy ("Save as new…" already exists), which is theirs.
- **The admin can act for anyone.** You can do anything to anything, and a few things are just for you:
  - an owner picker when saving a deck, so you can make or import a deck straight into Rob's list, or give him a copy of one of yours;
  - changing who owns something (a deck, a game);
  - an Accounts page in Settings: everyone's username and name, a new sign-in key for someone who's lost theirs, and removing an account;
  - "View as" another account, to see the app as Rob does (his home page, his decks), read-only.
- **The backfill.** One account, you, is made when the server first starts with accounts, named from config. Everything already on disk with no `owner` counts as yours: the server treats a missing owner as the admin, so no files need rewriting, and anything new gets an owner when it's made. Your browsers get your key with the same "Use on another device" link, opened once on each (the first one from a key printed in the server's log at that first start).
- **Claude.** Anyone signed in can use it, on your login (see Decisions). An account's runs are tagged with it, so the costs per account are there if limits are ever wanted.

## What it needs, in build order

### 1. A game against a friend (the first slice)

- **Accounts and owners**, as above, with the backfill.

- **Seats.** A game against a friend keeps, per seat, the account playing it. `POST /games` with `friend: true` leaves p2 open and returns a join code; `POST /games/join/{code}` with a deck takes p2 for the caller's account.
- **Play a friend** in the New game dialog, the join screen, and Free the seat in the game's … menu, as in The flow.
- **Moves locked to your seat.** The game routes (answer, take back, forfeit) check that the caller's account holds the seat being answered for. Spectating needs no seat.
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

## Not thought about yet

- **What a friend can see.** Accounts stop them changing your things, but they can still read everything, since games and decks are read through the same routes. Lists default to your own (Home's On the go and the Games page show yours and games you're in), with an "Everyone's" filter.
- **Spectators see no hidden cards.** A viewer whose account holds no seat gets the public table only.
- **Who goes first.** The engine already settles it from the seed; show it as a coin flip at the start. A rematch swaps it.
- **Chances to respond.** "Ask me to respond" is one setting per game today (`respond` in `server/games.ts`); against a person it's one per seat. Auto-passing also mustn't give away timing, e.g. never pause on a chance you can't use.
- **The dev server.** The app runs as `mise run dev`: saving a server file restarts the API and a page reload follows. Games are saved and survive it, but a game in progress gets a hiccup each time. While a friend is on, either don't work on the app, or run a built copy for them on its own port and keep the dev one for yourself.
- **Your turn.** A sound when it becomes your turn, and web push (already planned) for when the tab is in the background on a phone.
- **Someone leaves.** The game waits indefinitely; an away mark after a minute or two, and forfeit stays available.
- **After the game.** Rematch needs both to agree. A Claude review of the game can see both sides, since it's over.

## Open questions

- None for now.

## Sources

- [Tailscale Serve: identity headers](https://tailscale.com/kb/1312/serve)
- [Sharing over Tailscale](https://tailscale.com/blog/sharing-over-tailscale)
