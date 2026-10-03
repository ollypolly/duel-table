// Who's signed in, and everyone's accounts, for owners' names and for hiding
// what you can't change. Without accounts on the server, anyone changes anything.
import { create } from 'zustand'
import { api, ApiError } from '../api/client'
import type { Account } from '../api/accounts'

type AccountState = {
  loaded: boolean
  on: boolean // the server has accounts
  me?: Account
  everyone: Account[]
  load: () => Promise<void>
  setMe: (me?: Account) => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  loaded: false,
  on: false,
  everyone: [],
  load: async () => {
    const [{ accounts, me }, everyone] = await Promise.all([api.me(), api.accounts().catch(() => [])])
    set({ loaded: true, on: accounts, me, everyone })
  },
  setMe: (me) => {
    set({ me })
    void get().load()
  },
}))

// Whether the signed-in account can change something with this owner
// (missing: the admin's).
export const canChange = (owner: string | undefined, { on, me, everyone }: Pick<AccountState, 'on' | 'me' | 'everyone'> = useAccountStore.getState()) =>
  !on || !!me?.admin || (!!me && (owner ?? everyone.find((a) => a.admin)?.id) === me.id)

export const useCanChange = () => {
  const s = useAccountStore()
  return (owner?: string) => canChange(owner, s)
}

// Whether something is the signed-in account's own (anything, without accounts).
export const useMine = () => {
  const { on, me, everyone } = useAccountStore()
  const admin = everyone.find((a) => a.admin)?.id
  return (owner?: string) => !on || (!!me && (owner ?? admin) === me.id)
}

// ?signin=<key> (a link from another device, or the server's log) signs this
// browser in, then leaves the address.
export async function signInFromUrl() {
  const url = new URL(window.location.href)
  const key = url.searchParams.get('signin')
  if (key) {
    url.searchParams.delete('signin')
    window.history.replaceState(null, '', url)
    await api.signIn({ key }).catch(() => window.alert("That sign-in link doesn't work any more. Ask for a new one."))
  }
  await useAccountStore.getState().load()
}

export const accountError = (e: unknown) => (e instanceof ApiError ? e.body.error : undefined) ?? 'That didn’t work. Try again?'
