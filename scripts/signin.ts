// A new sign-in link for an account, for when every device is lost (or to
// drive the API from a script): npm run signin -- [username]
import { join } from 'node:path'
import { AccountService, diskAccounts } from '../server/accounts'
import { ROOT } from '../server/files'

const accounts = new AccountService(diskAccounts(join(ROOT, 'sessions', 'accounts.json')))
const username = process.argv[2] ?? process.env.DUEL_ADMIN ?? 'olly'
const account = accounts.byUsername(username)
if (!account) {
  console.error(
    `No account ${username}. There are: ${
      accounts
        .list()
        .map((a) => a.username)
        .join(', ') || 'none yet (start the server once)'
    }`,
  )
  process.exit(1)
}
const key = accounts.addKey(account.id)
console.log(`${process.env.PUBLIC_URL ?? 'http://localhost:5180'}/?signin=${key}`)
console.log(`For curl: --cookie duel-key=${key}`)
