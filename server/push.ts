// Notifications with the app closed (web push): each device that turns them on
// in Settings leaves a subscription here, under its account. Off unless the
// server has VAPID keys (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, from
// `npx web-push generate-vapid-keys`; VAPID_SUBJECT optional).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import webpush from 'web-push'

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } }
type Kept = PushSubscription & { account: string }
export type PushStore = { load(): Kept[]; save(subs: Kept[]): void }
// What a notification says, where tapping it goes, and tag: a later one with
// the same tag replaces it (your move, again).
export type Notice = { title: string; body: string; url: string; tag?: string }
export type Send = (sub: PushSubscription, notice: Notice) => Promise<void>

export const memoryPush = (): PushStore => {
  let kept: Kept[] = []
  return { load: () => kept, save: (s) => void (kept = s) }
}

export const diskPush = (path: string): PushStore => ({
  load: () => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Kept[]) : []),
  save: (subs) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(subs, null, 2) + '\n')
  },
})

// Sending with the VAPID keys; undefined without them.
export const vapidSend = (env = process.env): { key: string; send: Send } | undefined => {
  // The subject is who the push services can contact: a mailto: or the site's https URL (Safari refuses localhost).
  const { VAPID_PUBLIC_KEY: key, VAPID_PRIVATE_KEY: secret, VAPID_SUBJECT: subject = env.PUBLIC_URL ?? 'mailto:admin@localhost' } = env
  if (!key || !secret) return undefined
  const vapidDetails = { subject, publicKey: key, privateKey: secret }
  return {
    key,
    send: (sub, notice) =>
      webpush
        .sendNotification(sub, JSON.stringify(notice), { vapidDetails, TTL: 24 * 60 * 60, urgency: 'high', ...(notice.tag && { topic: notice.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) }) })
        .then(() => {}),
  }
}

export class PushService {
  private store: PushStore
  private sender?: Send
  readonly key?: string
  constructor(store: PushStore = memoryPush(), vapid?: { key: string; send: Send }) {
    this.store = store
    this.key = vapid?.key
    this.sender = vapid?.send
  }

  subscribe(account: string, sub: PushSubscription) {
    this.store.save([...this.store.load().filter((s) => s.endpoint !== sub.endpoint), { account, endpoint: sub.endpoint, keys: sub.keys }])
  }

  unsubscribe(endpoint: string) {
    this.store.save(this.store.load().filter((s) => s.endpoint !== endpoint))
  }

  // To every device of the account's. One that's gone (unsubscribed, or the
  // app removed) is forgotten; any other failure is let go.
  async notify(account: string, notice: Notice) {
    if (!this.sender) return
    const subs = this.store.load().filter((s) => s.account === account)
    await Promise.all(
      subs.map((s) =>
        this.sender!(s, notice).catch((e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) this.unsubscribe(s.endpoint)
        }),
      ),
    )
  }
}
