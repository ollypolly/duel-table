// @vitest-environment node
import { AccountService, memoryAccounts } from './accounts'
import { createApp } from './app'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deckOwner, removeRepoFile, repoContext, writeRepoFile } from './files'
import { SessionService } from './sessions'
import type { Agent } from './claude/agent'
import { HomeService } from './claude/home'
import { TutorService } from './claude/tutor'
import { memoryPush, PushService } from './push'

const ctx = repoContext()

describe('accounts', () => {
  it('makes the admin once, with a key that signs in', () => {
    const accounts = new AccountService(memoryAccounts())
    const key = accounts.ensureAdmin('olly', 'Olly')!
    expect(accounts.ensureAdmin('olly')).toBeUndefined()
    expect(accounts.byKey(key)).toMatchObject({ username: 'olly', name: 'Olly', admin: true })
    expect(accounts.byKey('nope')).toBeUndefined()
  })

  it('keeps usernames unique and valid, and lets them change', () => {
    const accounts = new AccountService(memoryAccounts())
    const { account, key } = accounts.create({ username: 'rob', name: 'Rob' })
    expect(account.id).toMatch(/^a-[0-9a-f]{6}$/)
    expect(() => accounts.create({ username: 'rob', name: 'Other' })).toThrow('taken')
    expect(() => accounts.create({ username: 'Rob!', name: 'x' })).toThrow('username')
    accounts.update(account.id, { username: 'robert' })
    expect(accounts.byKey(key)).toMatchObject({ id: account.id, username: 'robert' })
    const second = accounts.addKey(account.id)
    expect(accounts.byKey(second)?.id).toBe(account.id)
    expect(accounts.list()[0]).not.toHaveProperty('keys')
  })
})

describe('sign-in codes', () => {
  it('last ten minutes, and stop working for a while after many wrong guesses', () => {
    const accounts = new AccountService(memoryAccounts())
    const key = accounts.ensureAdmin('olly')!
    const code = accounts.codeFor(key, 0)
    for (let i = 0; i < 30; i++) expect(() => accounts.redeem('WRONG1', 1)).toThrow("doesn't work")
    expect(() => accounts.redeem(code, 2)).toThrow('too many')
    const later = 11 * 60_000
    expect(accounts.redeem(accounts.codeFor(key, later), later)).toBe(key)
    expect(() => accounts.redeem(accounts.codeFor(key, later), later + 10 * 60_000 + 1)).toThrow("doesn't work")
  })
})

describe('accounts over the API', () => {
  const setup = () => {
    const accounts = new AccountService(memoryAccounts())
    const adminKey = accounts.ensureAdmin('olly', 'Olly')!
    const agent: Agent = () => ({
      events: (async function* () {
        yield { type: 'done' as const, sessionId: 's', costUsd: 0 }
      })(),
      interrupt: async () => {},
    })
    const sessions = new SessionService(ctx)
    const claude = { account: async () => ({ email: 'olly@example.com', plan: 'max' }) } as never
    const home = new HomeService({ ctx, sessions, agent, system: () => '' })
    const tutor = new TutorService({ ctx, agent, system: () => '' })
    const devices = memoryPush()
    const push = new PushService(devices)
    const app = createApp({ sessions, ctx, accounts, claude, home, tutor, push })
    const call = async (method: string, path: string, body?: unknown, key?: string) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { cookie: `duel-key=${key}` }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      })
      return { status: res.status, json: (await res.json()) as any, cookie: res.headers.get('set-cookie') }
    }
    return { call, adminKey, devices }
  }

  it('reads openly, and only changes things for whoever owns them', async () => {
    const { call, adminKey } = setup()
    expect((await call('GET', '/me')).json).toEqual({ accounts: true })
    expect((await call('POST', '/sessions', { scenario: 'free-table' })).status).toBe(401)

    const made = await call('POST', '/accounts', { username: 'Rob', name: 'Rob' })
    expect(made).toMatchObject({ status: 201, json: { username: 'rob' } })
    const robKey = made.cookie!.match(/duel-key=([^;]+)/)![1]
    expect((await call('GET', '/me', undefined, robKey)).json.me.username).toBe('rob')

    const mine = await call('POST', '/sessions', { scenario: 'free-table' }, adminKey)
    expect(mine.json.owner).toBe((await call('GET', '/me', undefined, adminKey)).json.me.id)
    expect((await call('GET', `/sessions/${mine.json.id}`, undefined, robKey)).status).toBe(200)
    expect((await call('PATCH', `/sessions/${mine.json.id}`, { title: 'Mine now' }, robKey)).status).toBe(403)
    // Anyone can take a copy, which is theirs.
    const fork = await call('POST', `/sessions/${mine.json.id}/fork`, {}, robKey)
    expect(fork.json.owner).toBe(made.json.id)

    const robs = await call('POST', '/sessions', { scenario: 'free-table' }, robKey)
    expect((await call('PATCH', `/sessions/${robs.json.id}`, { title: 'Rob’s' }, robKey)).status).toBe(200)
    expect((await call('PATCH', `/sessions/${robs.json.id}`, { title: 'Admin can' }, adminKey)).status).toBe(200)
  })

  it("keeps the admin's chats, ideas, login and devices to the admin", async () => {
    const { call, adminKey, devices } = setup()
    const rob = await call('POST', '/accounts', { username: 'rob', name: 'Rob' })
    const robKey = rob.cookie!.match(/duel-key=([^;]+)/)![1]
    expect((await call('GET', '/claude', undefined, robKey)).json).toEqual({ available: true })
    expect((await call('GET', '/claude', undefined, adminKey)).json.email).toBe('olly@example.com')

    const chat = (await call('POST', '/home', { text: 'What should I play?' }, adminKey)).json
    const robs = (await call('POST', '/home', { text: 'Hi' }, robKey)).json
    expect((await call('GET', '/home', undefined, robKey)).json.map((t: { id: string }) => t.id)).toEqual([robs.id])
    expect((await call('GET', `/home/${chat.id}`, undefined, robKey)).status).toBe(403)
    expect((await call('DELETE', `/home/${chat.id}`, undefined, robKey)).status).toBe(403)

    await call('POST', '/ideas', { text: 'secret plans' }, adminKey)
    expect((await call('GET', '/ideas', undefined, robKey)).json).toEqual([])
    const idea = (await call('GET', '/ideas', undefined, adminKey)).json[0]
    expect((await call('DELETE', `/ideas/${idea.id}`, undefined, robKey)).status).toBe(403)

    // A lesson's chat is each account's own.
    const lesson = 'armed-ojama-links-vs-super-quant'
    await call('POST', `/scenarios/${lesson}/tutor/chat`, { text: 'Why?', position: 0 }, adminKey)
    expect((await call('GET', `/scenarios/${lesson}/tutor`, undefined, robKey)).json.chat).toEqual([])
    await call('DELETE', `/scenarios/${lesson}/tutor`, undefined, robKey)
    expect((await call('GET', `/scenarios/${lesson}/tutor`, undefined, adminKey)).json.chat[0].text).toBe('Why?')

    const session = (await call('POST', '/sessions', { scenario: 'free-table' }, robKey)).json
    expect((await call('POST', `/sessions/${session.id}/export`, { write: true }, robKey)).status).toBe(403)

    const device = { endpoint: 'https://push.example/olly', keys: { p256dh: 'p', auth: 'a' } }
    await call('POST', '/push', device, adminKey)
    await call('POST', '/push/off', { endpoint: device.endpoint }, robKey)
    expect(devices.load()).toHaveLength(1)
  })

  it('signs in with a key from another device, and leaves admin things to the admin', async () => {
    const { call, adminKey } = setup()
    const rob = await call('POST', '/accounts', { username: 'rob', name: 'Rob' })
    const robKey = rob.cookie!.match(/duel-key=([^;]+)/)![1]
    const { key } = (await call('POST', '/me/keys', undefined, robKey)).json
    expect((await call('POST', '/signin', { key })).json.username).toBe('rob')
    expect((await call('POST', '/signin', { key: 'wrong' })).status).toBe(401)
    // Or its code, typed any old way, once.
    const { code } = (await call('POST', '/me/keys', undefined, robKey)).json
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    const typed = `${code.slice(0, 3).toLowerCase()} - ${code.slice(3)}`
    const signed = await call('POST', '/signin', { code: typed })
    expect(signed.json.username).toBe('rob')
    expect((await call('GET', '/me', undefined, signed.cookie!.match(/duel-key=([^;]+)/)![1])).json.me.username).toBe('rob')
    expect((await call('POST', '/signin', { code })).status).toBe(401)
    expect((await call('POST', `/accounts/${rob.json.id}/keys`, undefined, robKey)).status).toBe(403)
    expect((await call('POST', `/accounts/${rob.json.id}/keys`, undefined, adminKey)).status).toBe(201)
    expect((await call('PATCH', `/accounts/${rob.json.id}`, { username: 'olly' }, robKey)).status).toBe(409)
    expect((await call('DELETE', `/accounts/${rob.json.id}`, undefined, adminKey)).status).toBe(200)
  })
})

describe("friends' decks", () => {
  it('are kept apart by owner, and found, replaced and deleted where they are', () => {
    const root = mkdtempSync(join(tmpdir(), 'decks-'))
    const write = writeRepoFile(root)
    expect(write('decks', { id: 'mine' }, false)).toBe('decks/mine.json')
    expect(write('decks', { id: 'robs' }, false, 'a-123456')).toBe('sessions/decks/a-123456/robs.json')
    // Replacing one keeps it where it is, whoever saves it.
    expect(write('decks', { id: 'robs' }, true)).toBe('sessions/decks/a-123456/robs.json')
    expect(deckOwner(root)('robs')).toBe('a-123456')
    expect(deckOwner(root)('mine')).toBeUndefined()
    expect(removeRepoFile(root)('decks', 'robs')).toBe('sessions/decks/a-123456/robs.json')
  })

  it("can't be changed by anyone else, but the admin can save one for them", async () => {
    const accounts = new AccountService(memoryAccounts())
    const adminKey = accounts.ensureAdmin('olly')!
    const rob = accounts.create({ username: 'rob', name: 'Rob' })
    const saved: [string, string | undefined][] = []
    const deckCtx = () => ({ ...ctx(), decks: { ...ctx().decks, robs: { id: 'robs', name: 'Rob', main: [] } } })
    const app = createApp({
      sessions: new SessionService(deckCtx),
      ctx: deckCtx,
      accounts,
      deckOwner: (id) => (id === 'robs' ? rob.account.id : undefined),
      writeFile: (dir, file, _, owner) => (saved.push([file.id, owner]), `${dir}/${file.id}.json`),
      removeFile: (dir, id) => `${dir}/${id}.json`,
    })
    const call = (method: string, path: string, key: string, body?: unknown) =>
      app.request(`/api${path}`, { method, headers: { cookie: `duel-key=${key}`, 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) })
    const deck = { name: 'Ojamas', cards: [{ name: 'Ojama Yellow', count: 3 }] }
    expect((await call('DELETE', '/decks/chazz-armed-ojama', rob.key)).status).toBe(403)
    expect((await call('DELETE', '/decks/robs', adminKey)).status).toBe(200)
    expect((await call('POST', '/decks', rob.key, { ...deck, id: 'robs', overwrite: true })).status).toBe(201)
    expect((await call('POST', '/decks', rob.key, { ...deck, id: 'new-one' })).status).toBe(201)
    expect((await call('POST', '/decks', rob.key, { ...deck, id: 'for-olly', owner: 'a-000000' })).status).toBe(403)
    expect((await call('POST', '/decks', adminKey, { ...deck, id: 'for-rob', owner: rob.account.id })).status).toBe(201)
    expect((await call('POST', '/decks', adminKey, { ...deck, id: 'olly-deck' })).status).toBe(201)
    expect(saved).toEqual([
      ['robs', rob.account.id],
      ['new-one', rob.account.id],
      ['for-rob', rob.account.id],
      ['olly-deck', undefined],
    ])
    const list = (await (await app.request('/api/decks')).json()) as { id: string; owner?: string }[]
    expect(list.find((d) => d.id === 'robs')?.owner).toBe(rob.account.id)
  })
})
