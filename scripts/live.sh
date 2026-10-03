#!/usr/bin/env bash
# Runs the live copy (see scripts/deploy.sh): the built site on :5190, with
# /api proxied to the API on :5191. VAPID keys for notifications come from
# ~/.config/duel-table/vapid.env (templated from the chezmoi data file).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f "$HOME/.config/duel-table/vapid.env" ]; then
  set -a
  . "$HOME/.config/duel-table/vapid.env"
  set +a
fi
export API_PORT=5191 WEB_PORT=5190
export PUBLIC_URL=${PUBLIC_URL:-https://duel.olly.live}
export YGO_AGENT_URL=${YGO_AGENT_URL:-http://localhost:5182}
exec npx concurrently -k -n web,api -c blue,green "vite preview" "tsx server/index.ts"
