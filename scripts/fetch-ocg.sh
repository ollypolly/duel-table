#!/usr/bin/env bash
# Downloads what the YGOPro rules core needs into data/ocg/: the card scripts
# (Fluorohydride/ygopro-scripts, GPL-2.0), and the English card database and
# prompt strings (mycard/ygopro-database). Re-run to update.
set -euo pipefail
dir="${OCG_DATA_DIR:-data/ocg}"
mkdir -p "$dir"
if [ -d "$dir/scripts/.git" ]; then
  git -C "$dir/scripts" pull -q --depth 1
else
  git clone -q --depth 1 https://github.com/Fluorohydride/ygopro-scripts.git "$dir/scripts"
fi
for f in cards.cdb strings.conf; do
  curl -fsSL -o "$dir/$f" "https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/en-US/$f"
done
echo "scripts $(git -C "$dir/scripts" rev-parse --short HEAD), $(ls "$dir/scripts" | wc -l | tr -d ' ') files; cards.cdb $(du -h "$dir/cards.cdb" | cut -f1)"
