// @arch docs/features/published-agent-direct-conversations.md
import { useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'

const EMPTY: Readonly<Record<string, number>> = {}
let snapshot: { accountId: string | null; agents: Readonly<Record<string, number>> } = { accountId: null, agents: EMPTY }
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null
let revision = 0
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function reset(accountId: string | null) {
  if (snapshot.accountId === accountId) return
  revision += 1
  inFlight = null
  snapshot = { accountId, agents: EMPTY }
  listeners.forEach((listener) => listener())
}
export function refreshOwnerDirectUnread() {
  const accountId = useAuthStore.getState().user?.id ?? null
  reset(accountId)
  if (!accountId || inFlight) return inFlight ?? Promise.resolve()
  const request = revision
  const pending = authApi<{ agents: Record<string, number> }>('/agent-direct-conversations/owned-unread')
    .then((result) => {
      if (request !== revision || useAuthStore.getState().user?.id !== accountId) return
      snapshot = { accountId, agents: result.agents }
      listeners.forEach((listener) => listener())
    }).catch(() => {}).finally(() => { if (inFlight === pending) inFlight = null })
  inFlight = pending
  return pending
}
export function useOwnerDirectUnread() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
  useEffect(() => {
    void refreshOwnerDirectUnread()
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refreshOwnerDirectUnread()
    }, 10_000)
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refreshOwnerDirectUnread()
    })
    return () => { clearInterval(timer); subscription.remove() }
  }, [accountId])
  return state.accountId === accountId ? state.agents : EMPTY
}
