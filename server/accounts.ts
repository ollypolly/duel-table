// Basic accounts: an id that owns things, a unique username, a display name,
// and sign-in keys (one per device, kept hashed). See docs/MULTIPLAYER.md.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SessionError } from './errors'

export type Account = { id: string; username: string; name: string; admin?: true; keys: string[] }
export type AccountView = Omit<Account, 'keys'>

export type AccountStore = { load(): Account[]; save(accounts: Account[]): void }

export const memoryAccounts = (): AccountStore => {
  let kept: Account[] = []
  return { load: () => kept, save: (a) => void (kept = a) }
}

// Read on every call, so `npm run signin` can add a key while the server runs.
export const diskAccounts = (path: string): AccountStore => ({
  load: () => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Account[]) : []),
  save: (accounts) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(accounts, null, 2) + '\n')
  },
})

// The account a request (and anything it starts, like a Claude run) acts as.
export const acting = new AsyncLocalStorage<string>()

export const USERNAME = /^[a-z0-9_-]{2,20}$/
const hash = (key: string) => createHash('sha256').update(key).digest('base64url')
const view = ({ id, username, name, admin }: Account): AccountView => ({ id, username, name, ...(admin && { admin }) })

// A short code to type in where a sign-in link won't open (an app installed to
// the home screen keeps its own cookies): it stands for a key, once, for ten
// minutes. No 0/O or 1/I, so it reads back off a screen.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LASTS = 10 * 60_000
const WRONG_CODES = 30 // in ten minutes, then codes stop working for a while (someone guessing)

export class AccountService {
  private store: AccountStore
  private codes = new Map<string, { key: string; until: number }>()
  private wrong = { count: 0, since: 0 }
  constructor(store: AccountStore) {
    this.store = store
  }

  // The admin, made on the first start: its first key is returned once, to print.
  ensureAdmin(username: string, name = username[0].toUpperCase() + username.slice(1)): string | undefined {
    if (this.store.load().some((a) => a.admin)) return undefined
    const { key } = this.create({ username, name }, true)
    return key
  }

  get adminId(): string | undefined {
    return this.store.load().find((a) => a.admin)?.id
  }

  list(): AccountView[] {
    return this.store.load().map(view)
  }

  byId(id: string): AccountView | undefined {
    const a = this.store.load().find((a) => a.id === id)
    return a && view(a)
  }

  byUsername(username: string): AccountView | undefined {
    const a = this.store.load().find((a) => a.username === username)
    return a && view(a)
  }

  byKey(key: string | undefined): AccountView | undefined {
    if (!key) return undefined
    const h = hash(key)
    const a = this.store.load().find((a) => a.keys.includes(h))
    return a && view(a)
  }

  create({ username, name }: { username: string; name: string }, admin = false): { account: AccountView; key: string } {
    const all = this.store.load()
    this.checkUsername(username, all)
    let id: string
    do id = `a-${randomBytes(3).toString('hex')}`
    while (all.some((a) => a.id === id))
    const key = newKey()
    const account: Account = { id, username, name: name.trim() || username, ...(admin && { admin: true as const }), keys: [hash(key)] }
    this.store.save([...all, account])
    return { account: view(account), key }
  }

  // Another key for the account, for another device.
  addKey(id: string): string {
    const key = newKey()
    this.change(id, (a) => ({ ...a, keys: [...a.keys, hash(key)] }))
    return key
  }

  codeFor(key: string, now = Date.now()): string {
    let code: string
    do code = Array.from(randomBytes(6), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('')
    while (this.codes.has(code))
    this.codes.set(code, { key, until: now + CODE_LASTS })
    return code
  }

  // The key a code stands for, once (any case, spaces or dashes).
  redeem(typed: string, now = Date.now()): string {
    for (const [c, { until }] of this.codes) if (until < now) this.codes.delete(c)
    if (now - this.wrong.since > CODE_LASTS) this.wrong = { count: 0, since: now }
    if (this.wrong.count >= WRONG_CODES) throw new SessionError(401, 'too many wrong codes: try again in a few minutes')
    const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const found = this.codes.get(code)
    if (!found) {
      this.wrong.count++
      throw new SessionError(401, "that code doesn't work: each works once, for ten minutes")
    }
    this.codes.delete(code)
    return found.key
  }

  update(id: string, { username, name }: { username?: string; name?: string }): AccountView {
    if (username !== undefined) this.checkUsername(username, this.store.load(), id)
    return this.change(id, (a) => ({ ...a, ...(username !== undefined && { username }), ...(name?.trim() && { name: name.trim() }) }))
  }

  remove(id: string) {
    const all = this.store.load()
    const a = all.find((a) => a.id === id)
    if (!a) throw new SessionError(404, `no account ${id}`)
    if (a.admin) throw new SessionError(409, "the admin can't be removed")
    this.store.save(all.filter((a) => a.id !== id))
  }

  private change(id: string, fn: (a: Account) => Account): AccountView {
    const all = this.store.load()
    const i = all.findIndex((a) => a.id === id)
    if (i < 0) throw new SessionError(404, `no account ${id}`)
    all[i] = fn(all[i])
    this.store.save(all)
    return view(all[i])
  }

  private checkUsername(username: string, all: Account[], self?: string) {
    if (!USERNAME.test(username)) throw new SessionError(400, 'a username is 2 to 20 lowercase letters, numbers, - or _')
    if (all.some((a) => a.username === username && a.id !== self)) throw new SessionError(409, `${username} is taken`)
  }
}

const newKey = () => randomBytes(24).toString('base64url')
