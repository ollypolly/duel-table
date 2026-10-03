// Invites to a game against a friend: a code to send, a deck, and once
// someone has joined, the game. See docs/MULTIPLAYER-FLOW.md.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Respond } from '../src/api/game'
import type { Player } from '../src/engine'
import type { ScenarioFile } from '../src/scenarios/schema'
import { SessionError } from './errors'

export type Invite = { code: string; owner: string; deck: string; respond?: Respond; createdAt: number; session?: string }
export type InviteStore = { load(): Invite[]; save(invites: Invite[]): void }

export const memoryInvites = (): InviteStore => {
  let kept: Invite[] = []
  return { load: () => kept, save: (i) => void (kept = i) }
}

export const diskInvites = (path: string): InviteStore => ({
  load: () => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Invite[]) : []),
  save: (invites) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(invites, null, 2) + '\n')
  },
})

export class InviteService {
  private store: InviteStore
  constructor(store: InviteStore = memoryInvites()) {
    this.store = store
  }

  create(owner: string, deck: string, respond?: Respond): Invite {
    const invite: Invite = { code: randomBytes(6).toString('base64url'), owner, deck, ...(respond && { respond }), createdAt: Date.now() }
    this.store.save([...this.store.load(), invite])
    return invite
  }

  get(code: string): Invite {
    return this.store.load().find((i) => i.code === code) ?? fail(404, 'that invite has gone (it may have been cancelled)')
  }

  joined(code: string, session: string) {
    this.store.save(this.store.load().map((i) => (i.code === code ? { ...i, session } : i)))
  }

  remove(code: string) {
    this.store.save(this.store.load().filter((i) => i.code !== code))
  }
}

const fail = (status: 404, message: string): never => {
  throw new SessionError(status, message)
}

// Seats in a game between two accounts --------------------------------------

type Duel = NonNullable<ScenarioFile['duel']>

export const seatOf = (duel: Duel | undefined, account: string | undefined): Player | undefined =>
  account && duel?.seats ? (['p1', 'p2'] as const).find((p) => duel.seats![p] === account) : undefined

// A game between two accounts that isn't over: what each player is sent is
// redacted, and only the table's own routes are open.
export const inPlay = (duel: Duel | undefined) => !!duel?.seats && !duel.winner && !duel.forfeit

// While one is in play, the routes on it that anyone (its owner and the admin
// included) can use: everything else could show a hidden card.
export const OPEN_IN_PLAY = /^(\/(events|game\/(answer|forfeit|undo|takeback|settings)|table\/.*))?$/
