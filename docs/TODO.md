# To do by hand

What's left of multiplayer that needs a person, a phone, or a change on servitor. Cross things off by deleting them.

## Set up

- Push the dotfiles commit with the VAPID keys template (`0c56cd1`, on `main` in `~/dev/dotfiles`).
- Merge `multiplayer` into `main`, then `mise run deploy` so the live copy on :5190 has friend games. Until then friends need the dev copy on :5180.
- Point `duel.olly.live` at the live copy (nginx, DNS, cert on servitor). `PUBLIC_URL` already assumes it, and notifications need https.
- Lock Rob to just the duel table on the tailnet. Share only the servitor machine with him rather than inviting him to the tailnet. Swap the allow-all access rule for grants: you to everything, his email to `servitor:5190` only (plus :5180 while `multiplayer` is unmerged). From his side, check Plex, Sonarr and Radarr refuse. Or skip the tailnet and give him `duel.olly.live` instead.

## Test

- **A friend game across two devices.** Invite, join, both hands hidden, take-back, chat, `@claude`, a hidden message to Claude, sounds and stickers, the game-over screens, rematch.
- **Notifications on a real phone.** Only the server side is tested. On iOS, add the app to the home screen first, then turn them on in Settings and check "your move" arrives with the app closed.
- **As Rob.**
  - His deck page shows "Rob's Dark Magician", and none of yours can be edited.
  - A lesson chat with Claude is separate for each of you.
  - Ask Claude on Home works.
- **Rob's deck in play.** 18 of its cards were new to the app, fetched from YGOPRODeck. Check their effects work in the rules engine.
