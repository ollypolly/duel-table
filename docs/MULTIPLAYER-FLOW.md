# Playing a friend: how it should feel

The experience to build to, for you (the admin, `olly`) and a friend (`rob`). How it's built is in `docs/MULTIPLAYER.md`. Where they disagree, this one wins, and the other gets fixed.

## Once, before the first game

**You**
1. After the update, the server's log prints a sign-in link for your account. Open it on your laptop, and it's signed in. Settings → "Use on another device" shows a QR code: scan it with your phone, and that's signed in too. Everything you already had is yours, untouched.
2. In Tailscale's admin console, share the machine and send Rob the invite.

**Rob**
1. Opens the invite, signs in to Tailscale (Google or similar) and installs the Tailscale app on his phone. Your machine shows up in it. This is the clunkiest step and none of it is the app's; it's a few minutes, once.

## Starting a game

**You:** New game → opponent: **A friend** → your deck → **Create**. You get a link (`duel.olly.live/?join=…`) with a Copy and a Share button, and send it to Rob however you like. Your table opens and says "Waiting for someone to join…".

**Rob:** taps the link and gets a join screen, made for a phone:
- "Olly wants a duel", and your deck.
- First time only: a username (`rob`) and what to call him.
- His deck: his own, or one of yours to borrow.
- Sleeves and "Ask me to respond", already set to sensible defaults, so he can skip them.
- **Join**. That makes his account and seats him in one go, and his phone remembers him from then on.
- If notifications aren't on yet, a one-line offer: "Get told when it's your move?" (on an iPhone, only once the app's on the Home Screen, and it says how).

**Both:** the table opens on both screens with a coin flip for who goes first. Each of you only ever sees your own hand.

## During the game

- **Chat:** one group chat, with each message showing who sent it. `@claude` brings Claude in to answer the table. **Hide this message** sends it to Claude only: nobody else sees it or the reply, so you can ask for advice that uses your own hand.
- **Fun:** a laugh, a sad trombone and the rest, on both screens; emoji stuck on a card; call-outs on big moments.
- **Take-backs** ask the other player first.
- **Waiting:** "Rob is thinking…" when he's been a while, and a nudge button.
- **Away from the table:** Rob can wander off to look at decks or lessons, and the game waits. It's at the top of his home page under On the go, one tap back. On another device he signs in once with a link from Settings, and the game's there too.
- **Notifications:** with the app closed or the phone locked, "Your move against Olly" arrives as a notification, and tapping it opens the game. Also when someone joins your game, offers a rematch, or mentions you in the chat.

## After

- A win screen and a sad one, with **Rematch**, which asks the other player and swaps who goes first.
- Either of you can get a Claude review of it, with both hands shown, since it's over.

## Never

- Seeing the other player's hand or Deck, anywhere, including in the browser's network tab.
- Changing or deleting something you don't own (except the admin).
- Your game being interrupted because Olly is working on the app: you play on the live copy, which only changes when he deploys.
