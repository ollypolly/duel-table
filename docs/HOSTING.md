# Hosting on your own server

Duel Table stays a personal tool: it runs on one of your machines and you reach it over your tailnet, from a laptop or phone. Nothing is public. This guide is written for Claude Code on that server to follow; the owner will be around for the logins.

## What runs

- `npm run dev`: Vite on :5180 and the API on :5181, both on localhost. Vite proxies `/api` to the API, so :5180 is the only port anything needs.
- `tailscale serve` puts :5180 on the tailnet over HTTPS, at `https://<machine>.<tailnet>.ts.net`. Vite already accepts `.ts.net` hosts (`vite.config.ts`).
- Claude runs through the Agent SDK on the Claude Code login of the user running the server. Lessons and Claude opponents bill to that login's plan.

The dev server is fine here: it's one person's tool, and it reloads prompts and scenarios as they change.

## Steps

1. **Node 24.** Check `node --version`. The repo's `.tool-versions` pins it for asdf or mise; otherwise install Node 24 however the machine installs things.
2. **Clone and install.**
   ```sh
   git clone https://github.com/ollypolly/duel-table.git && cd duel-table
   npm install
   ```
3. **Download the data** (neither is committed):
   ```sh
   npm run fetch-cards   # card data into data/cards.json and images into public/cards/, a few minutes
   npm run fetch-ocg     # the rules engine's scripts and card database into data/ocg/
   ```
4. **Check it builds and passes:** `npm run typecheck && npm test`.
5. **Claude login.** Run `claude` and `/login` as the user that will run the server. On a headless machine the login prints a URL for the owner to open on another device. Check with `claude -p "say hi"`.
6. **Run it so it survives logout and reboot.** Pick what fits the machine, and ask the owner if unsure:
   - With the owner's dotfiles and tmux: `tmux-popup --ensure devserver "mise run dev"` in the project's tmux session (see the owner's global CLAUDE.md). Doesn't survive a reboot on its own.
   - Linux, always on: a systemd user service running `npm run dev` in the repo, with `loginctl enable-linger <user>` so it runs without a login session. It must run as the user with the Claude login. The service doesn't load a shell profile, so put the directory of `which node` on its `PATH` (asdf and mise shims aren't there otherwise).
   - macOS, always on: a launchd agent in `~/Library/LaunchAgents` doing the same.

   Then check `curl -s localhost:5180/api/decks | head -c 200` returns JSON.
7. **Tailscale.** The machine needs to be on the owner's tailnet (`tailscale status`). On Linux, `tailscale serve` needs root unless the user is the operator, so first `sudo tailscale set --operator=$USER`. Then:
   ```sh
   tailscale serve --bg 5180
   tailscale serve status
   ```
   The first time, it may ask the owner to enable HTTPS certificates for the tailnet in the admin console. `tailscale serve --bg` keeps the setting across reboots. `tailscale serve reset` turns it off.
8. **Check from another device.** Open the `https://…ts.net` URL on the owner's phone. Start a lesson (New game → Lesson with Claude) to check Claude works from there. On the phone, Share → Add to Home Screen installs it as an app.

## Bringing games over

Saved games and Claude chats are in `sessions/` (with Claude's side in `sessions/claude/` and `sessions/tutor/`). To carry them over from the laptop, copy that folder into the server's checkout while the server is stopped. Sleeves, deck boxes and playmats are kept in each browser, so they don't carry over.

## Updating

`git pull && npm install`, then restart the server. Run `npm run fetch-cards` again if new decks or scenarios name new cards, and `npm run fetch-ocg` to pick up newer engine scripts.

## Security

The API has no login of its own: anyone who can reach :5180 can play, and spend the Claude plan. Keep it to the tailnet: never `tailscale funnel`, never bind Vite or the API to a public interface.
