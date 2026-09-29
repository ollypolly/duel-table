// The browser's card DB, built from the committed data/cards.json.
import cardsJson from '../../data/cards.json'
import { createCardDb, type CardDbFile } from './cardDb'
import type { CardLookup } from '../engine'

export const cardDb = createCardDb(cardsJson as CardDbFile)
export const cardLookup: CardLookup = (id) => cardDb.byId(id)
