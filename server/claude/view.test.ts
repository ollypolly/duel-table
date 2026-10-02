import { repoContext } from '../files'
import { searchCards } from './view'

const { db } = repoContext()()

describe('searchCards', () => {
  it("lists printed cards the app hasn't downloaded beside the ones it has", async () => {
    const yellow = db.byName('Ojama Yellow')!
    const red = { ...yellow, id: 1, name: 'Ojama Red', desc: 'When this card is Normal Summoned…' }
    const found = await searchCards(db, 'ojama', async () => [yellow, red])
    expect(found).toMatch(/^Among the cards this app has downloaded, \d+ match/)
    expect(found).toContain('- Ojama Yellow (')
    // What it already has isn't listed twice.
    expect(found).toContain('Other printed cards with that in their name (real cards, not downloaded here yet), 1 match:\n- Ojama Red (')
    expect(await searchCards(db, 'ojama', async () => [yellow])).toContain('No other printed card has that in its name.')
    expect(await searchCards(db, 'zzzzqq', async () => [])).toBe('Nothing matches "zzzzqq".')
  })
})
