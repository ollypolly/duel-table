# Playing a friend

**Status:** built on the `multiplayer` branch; `duel.olly.live` itself (the certificate, nginx site and DNS below) is still to do. How it should feel to use is `docs/MULTIPLAYER-FLOW.md`, which wins where the two disagree.

## Decisions so far

- **Tailnet only.** The app stays off the public web. Friends get the machine shared with them on Tailscale and open the same `https://…ts.net` URL (see `docs/HOSTING.md`). Making it public would mean doing logins, rate limits and abuse protection properly, which is a much bigger job.
  - **Its own address: `duel.olly.live`, the way `budget.olly.live` works.** Today it's `https://servitor.tail59f26.ts.net:10001`. `budget.olly.live` has a public A record pointing at servitor's tailnet IP (`100.93.150.67`), and the host's nginx has a server block listening only on that IP (`listen 100.93.150.67:443 ssl`, in `/etc/nginx/sites-available/reverse-proxy`) proxying to the app on localhost. Only tailnet devices can reach it. `duel.olly.live` would be the same: an A record, a server block proxying to the live copy on `127.0.0.1:5190` (see Running it) with the WebSocket/SSE headers, and the `.olly.live` host added to Vite's allowed hosts.
    - **The certificate.** A tailnet-only name can't pass Let's Encrypt's HTTP check, so budget's was issued by hand with a DNS challenge (`authenticator = manual` in `/etc/letsencrypt/renewal/budget.olly.live.conf`), which `certbot.timer` can't renew: it expired on 2026-09-17. Fixing it for both names, as part of this work:
      1. **A Netlify token.** `olly.live`'s DNS is on Netlify (the `dns*.p01.nsone.net` nameservers). A personal access token from Netlify (User settings → Applications) goes in the chezmoi data file as `[netlify] token`, templated to `~/.config/netlify/token` (private), like the ngrok token.
      2. **A certbot hook** (`certbot-netlify-dns auth|cleanup`, kept in the dotfiles' `bin/`): `auth` adds the `_acme-challenge.<name>` TXT record through Netlify's API and waits until Netlify's nameservers serve it, `cleanup` deletes it. Certbot 2.1 on the box runs it as root, so it's installed as a root-owned copy (`/etc/letsencrypt/netlify-dns`) rather than run from the home directory.
      3. **Re-issue budget and issue duel** with `certbot certonly --manual --preferred-challenges dns --manual-auth-hook '… auth' --manual-cleanup-hook '… cleanup' --deploy-hook 'systemctl reload nginx'`, once per name. Certbot saves the hooks in each renewal config, so the timer renews both from then on. `certbot renew --dry-run` proves it.
      4. **The `duel.olly.live` site:** its own file in `sites-available` (budget's block is in the shared `reverse-proxy` file), listening on `100.93.150.67`, proxying to the live copy on `127.0.0.1:5190` (see Running it) with the upgrade headers, `proxy_buffering off` and a long `proxy_read_timeout`, since live games are an event stream. Then `nginx -t` and a reload, after the certificate exists.
      5. **The A record** `duel.olly.live → 100.93.150.67`, through the same Netlify API. (`.olly.live` is already in Vite's `allowedHosts`.)
    - **What the friend can reach.** nginx listens on servitor's own tailnet IP, so the friend needs servitor shared with them, which on its own would let them reach everything else listening there (Plex, Portainer). The tailnet policy can limit people a machine is shared with (`autogroup:shared`) to port 443 on it.
    - **The alternative** is a second Tailscale node just for the app, at `https://duel.tail59f26.ts.net`: a `tailscale/tailscale` container that serves the app and is shared on its own, with identity headers for free, but a `.ts.net` name.
  - **Sharing:** admin console → Machines → the machine's menu → Share, which makes an invite link (or sends one by email). The friend signs in to Tailscale with any account it supports (Google, Microsoft, GitHub, Apple and others), installs the app on their phone or laptop, and opens the link. They see only this machine, and it can't reach anything of theirs.
- **Basic accounts: a name and a key in the browser** (see Accounts below). Through nginx there are no Tailscale identity headers, so they're the app's own; Tailscale's `nginx-auth` helper could replace the key with real Tailscale logins later.
- **Claude runs on the owner's login for everyone.** It's one friend sending a few messages, so no API keys, spend limits or other infrastructure for now. Known trade-off: a Claude subscription's terms are for its holder's own use. If more people join, or usage grows, friends' runs move to an API key (see Later).

## How it works

What `docs/MULTIPLAYER-FLOW.md` describes is built: accounts and owners, games against a friend, the table's chat and fun, notifications, rematches, and the live copy. The tests are `server/accounts.test.ts` and `server/friends.test.ts`.

### Accounts

- **An account** is an id (`a-3f9c2e`, what everything is owned by), a unique lowercase username (`olly`, `rob`), a display name and sign-in keys, one per device, kept hashed in `sessions/accounts.json` (`server/accounts.ts`). The browser holds its key in an HttpOnly cookie (`duel-key`, 400 days, renewed on each visit). No passwords.
- **Making one:** a first visit asks for a name and makes it; the join screen does the same as part of joining.
- **Another device:** Settings → "Use on another device" shows a link and a QR code with a new key in it. The admin can make one for anyone who's lost theirs (Settings → Accounts), or on the box: `npm run signin -- [username]`.
- **The admin** is made on the first start (`DUEL_ADMIN`, default `olly`), and its first sign-in link is printed in the server's log. Anything with no `owner` is the admin's, so nothing older needed rewriting.
- **Owners.** Sessions, decks, home chats and ideas get the `owner` of whoever made them. Changing or deleting needs the owner or the admin; the server refuses (403) and the UI hides what you can't do. Reading stays open. Home lists your own tables and the games you're seated in.
- **Decks.** Friends' decks are saved under `sessions/decks/<account id>/` (gitignored); the repo's `decks/` are the admin's. The Decks panel groups them by owner, and the admin can save one for someone else.
- **Turning it off:** `DUEL_ACCOUNTS=off` lets anyone change anything, as before.

### A game against a friend

- **Invites** (`server/invites.ts`, `sessions/invites.json`). New game → A friend makes one with your deck, and a link (`/?join=<code>`). The join screen takes a name the first time, a deck (theirs, or one to borrow), sleeves, "Ask me to respond", and offers notifications. Joining flips a coin for who's p1 (p1 goes first) and makes the game, owned by whoever sent the invite. Pending invites show on Home.
- **Seats.** `duel.seats` holds the account in each seat, `duel.responds` each seat's respond setting. Only the seat being asked can answer; anyone else gets a 409.
- **While it's going,** only the table's own routes work on it, for everyone, the owner and admin included (`OPEN_IN_PLAY`): the events stream, answering, forfeiting, take-backs, settings, the chat and the fun. No exporting, forking or renaming mid-game.
- **Each player sees only their own hidden cards** (`server/redact.ts`). Every response and SSE message for a seated game is rebuilt for its viewer: the other side's hand, Deck, face-down cards and Extra Deck become anonymous cards, and the seed and the rules engine's answers are dropped, so nothing in the network tab rebuilds them. The redacted file is replayed to get the board, and it fails rather than fall back to the real one. Whoever sits in p2 has the sides swapped, so the browser always draws its viewer as p1. Someone with no seat sees neither hand. Once it's over, everything is shown.
  - Known gap: a card that was face-up earlier and is hidden now shows as "a card" in the step labels, and as a hidden card in history.
- **Take-backs** ask the other player (`/game/undo` asks, `/game/takeback` answers). **Presence:** who has the game open, from their event streams, shows as "Rob is away". After a minute of waiting, a **Nudge** sends them a notification.
- **After:** a win screen with applause, a sad one with a trombone, and **Rematch** (`/game/rematch`): it asks the other player, and when they agree a new game starts with the same decks and seats swapped, so whoever went second goes first. It opens on both screens. A Claude review works as for any game.

### The table: chat and fun

- **One group chat** per game (`server/table.ts`, `sessions/table/<id>.json`), sent to each viewer with their view of the game. `@claude` brings Claude in: it's given the table as both players can see it (neither hand) and the chat, and answers everyone. **Hide this message** sends it to Claude alone, which answers you alone and can use your own hand. Claude runs on the owner's login (`sdkQuick`, a single short call).
- **Fun:** sounds on both screens (made with Web Audio in `src/view/funSounds.ts`), an emoji stuck on a card for a few minutes (pick one, then tap the card), and a call-out on a hit of 1500 or more.

### Notifications

- **Per device:** Settings → Notifications, or the join screen's offer. On an iPhone they need the app on the Home Screen first, and the setting says how. Subscriptions are kept per account in `sessions/push.json`; one the browser says is gone is dropped. `public/sw.js` shows them and opens the game on a tap.
- **When:** your move (to whoever's asked next, if it isn't who just moved), someone joined your invite, a rematch or take-back asked for, a mention (`@rob` or `@Rob`) in the chat, a nudge. Not while you have that game open.
- **Keys:** VAPID keys in the chezmoi data file (`[duel_table]`), templated to `~/.config/duel-table/vapid.env`, which `mise run dev` and the live copy read. Without them notifications are off. Push needs HTTPS: the `.ts.net` address or `duel.olly.live`.

### Not built yet

- Watching a game you're not in from the invite link (the server already hides both hands for a spectator), and "Free the seat".
- The admin's "View as" and changing who owns something.
- A cooldown on sounds; voice call-outs, "slam it down", Claude as the commentator; a sound when it becomes your turn.
- Friends' Claude on an API key with a spend limit, and proper accounts (see `PLAN.md`).

## Running it: a live copy and the dev one

Friends play on a live copy that only changes when you deploy; the dev server stays yours to break.

- **The dev copy** stays as it was: `mise run dev`, :5180/:5181, the `.ts.net:10001` address.
- **`mise run deploy`** (`scripts/deploy.sh`): fetches, and the first time makes the worktree `~/dev/duel-table-live` at `origin/main`, links the downloaded card data (`public/cards/`, `data/ocg/`) to the dev copy's, and copies `sessions/` across once, so your games and accounts come with you. Then it checks out `origin/main`, runs `npm ci` and `vite build`, and restarts the live copy in the tmux session `duel-live` (`scripts/live.sh`): `vite preview` on :5190 proxying `/api` to the API on :5191, with `PUBLIC_URL=https://duel.olly.live`. It refuses while a game against a friend is going, unless run as `mise run deploy -- --force`.
- **Claude** uses the same login in both; the trained bot (`:5182`) is shared.
- **Environment:** `PUBLIC_URL` (sign-in links in the log), `DUEL_ADMIN`, `DUEL_ACCOUNTS=off`, `API_PORT`/`WEB_PORT`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (defaults to `PUBLIC_URL`).

## If it moves into Docker

It runs today with `mise run dev` straight on the machine, where the Claude Code login is just the owner's `~/.claude`. In a container the login has to come in from outside, probably one of:

- `claude setup-token`, which makes a long-lived token for the owner's subscription, passed in as `CLAUDE_CODE_OAUTH_TOKEN` (through the chezmoi data file, like any secret);
- or the owner's `~/.claude/.credentials.json` mounted into the container, writable so the login can refresh.

Both need checking against the current Claude Code docs before relying on them. Tailscale identity carries on working as long as `tailscale serve` on the host proxies to the container's port.

## Sources

- [Tailscale Serve: identity headers](https://tailscale.com/kb/1312/serve)
- [Sharing over Tailscale](https://tailscale.com/blog/sharing-over-tailscale)
