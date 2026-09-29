# Duel Table

A local web tool for learning Yu-Gi-Oh! by stepping through scripted games. Each scenario is a list of steps that move cards around a two-player board, with narration explaining what happened and why. You can pause, rewind, fork from any step and play on by hand.

It tracks where cards are, like a real table. It doesn't enforce rules. See [PLAN.md](PLAN.md) for the design.

## Running it

```sh
npm install
npm run fetch-cards   # downloads card data + images from YGOPRODeck (once)
npm run dev
```

Card images go in `public/cards/` and aren't committed. YGOPRODeck asks that images are self-hosted rather than hotlinked, so run `fetch-cards` after cloning.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server. Scenario files hot-reload. |
| `npm test` | Vitest, once |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |
| `npm run fetch-cards` | Rebuild `data/cards.json` from every card named in `decks/` and `scenarios/`, and download missing images |
