// Notifications on this device (web push): whether they can be had here, and
// turning them on and off. See public/sw.js and server/push.ts.
import { api } from './api/client'

export type PushState = 'unsupported' | 'install' | 'unavailable' | 'denied' | 'on' | 'off'

// Why they can't be turned on here.
export const PUSH_NOTE: Partial<Record<PushState, string>> = {
  install: 'On an iPhone, notifications need the app on your Home Screen: tap Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser can’t show notifications.',
  unavailable: 'Notifications aren’t set up on this server yet.',
  denied: 'Notifications are blocked for this site. Allow them in the browser’s settings, then come back.',
}

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const registerWorker = () => {
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {})
}

const subscription = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription()

export async function pushState(): Promise<PushState> {
  // An iPhone only has them for the app on its Home Screen.
  if (ios() && !standalone()) return 'install'
  if (!supported()) return 'unsupported'
  if (!(await api.pushKey()).key) return 'unavailable'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' && (await subscription()) ? 'on' : 'off'
}

// In two halves, so the asking (which must come straight from a tap) can be
// done before there's an account to save it under.
export async function askForPush(): Promise<PushSubscription | undefined> {
  if (!supported()) return undefined
  const permission = Notification.requestPermission() // first, while it's still the tap
  const { key } = await api.pushKey()
  if (!key || (await permission) !== 'granted') return undefined
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}
export const savePush = (sub: PushSubscription) => api.pushOn(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } })

export async function turnOnPush(): Promise<PushState> {
  const sub = await askForPush()
  if (sub) await savePush(sub)
  return pushState()
}

export async function turnOffPush(): Promise<PushState> {
  const sub = await subscription()
  if (sub) {
    await api.pushOff(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
  return pushState()
}
