#!/usr/bin/env bash
# Deploy the live copy (docs/MULTIPLAYER.md, Running it): a worktree at
# origin/main in ~/dev/duel-table-live, built, and restarted in its own tmux
# session (duel-live). Friends play there; this copy stays the dev one.
#   mise run deploy            fetch, check out origin/main, build, restart
#   mise run deploy -- --force even with a game against a friend going
set -euo pipefail

DEV=$(cd "$(dirname "$0")/.." && pwd)
LIVE=${DUEL_LIVE:-$HOME/dev/duel-table-live}
TMUX_SESSION=duel-live
API=http://127.0.0.1:5191/api
force=${1:-}

git -C "$DEV" fetch origin

if [ ! -d "$LIVE" ]; then
  echo "Making the live worktree in $LIVE"
  git -C "$DEV" worktree add --detach "$LIVE" origin/main
  # The downloaded card data is big and the same for both: linked, not copied.
  ln -s "$DEV/public/cards" "$LIVE/public/cards"
  ln -s "$DEV/data/ocg" "$LIVE/data/ocg"
  # Your games and accounts come across once; from here on each copy has its own.
  cp -a "$DEV/sessions" "$LIVE/sessions"
fi

# A deploy restarts the live API: not in the middle of someone's game.
if [ "$force" != "--force" ] && curl -sf "$API/sessions" -o /tmp/duel-live-sessions.json 2>/dev/null; then
  going=$(node -e 'const s = require("/tmp/duel-live-sessions.json"); console.log(s.filter((x) => x.seats && !x.winner).map((x) => x.title).join(", "))')
  if [ -n "$going" ]; then
    echo "A game against a friend is going ($going). Deploy between games, or: mise run deploy -- --force" >&2
    exit 1
  fi
fi

git -C "$LIVE" checkout --detach origin/main
(cd "$LIVE" && npm ci --no-audit --no-fund && npx vite build)

tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
tmux new-session -d -s "$TMUX_SESSION" -c "$LIVE" "$LIVE/scripts/live.sh"
echo "Live copy at $(git -C "$LIVE" rev-parse --short HEAD), on :5190 (tmux attach -t $TMUX_SESSION)"
