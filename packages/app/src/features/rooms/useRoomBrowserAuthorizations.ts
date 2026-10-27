// @arch docs/features/network-rooms/scoped-browser-access.md
// @test src/__tests__/room-browser-access-ui.test.ts
import { useCallback, useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { subscribeRoomEvents } from './roomEvents'

export type BrowserAuthorization = { id: string; roomId: string; expiresAt: string }

// Ephemeral user-private metadata, not a room message or account sync field.
// One batch on focus/reconnect/change, no per-row network calls or polling.
export function useRoomBrowserAuthorizations() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const [snapshot, setSnapshot] = useState<{ accountId: string; sessions: BrowserAuthorization[] } | null>(null)
  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web' || !accountId) return
    let active = true
    let revision = 0
    const load = async () => {
      if (AppState.currentState !== 'active') return
      const ticket = ++revision
      try {
        const result = await authApi<{ sessions: BrowserAuthorization[] }>('/room-browser/authorizations')
        if (active && ticket === revision) setSnapshot({ accountId, sessions: result.sessions })
      } catch { /* Keep only previously confirmed, unexpired grants; never invent an online state. */ }
    }
    void load()
    const unsubscribe = subscribeRoomEvents((event) => {
      if (event.event === 'room.updated' || event.event === 'room.sync.request' || event.event === 'room.membership.updated') void load()
    })
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void load() })
    return () => { active = false; unsubscribe(); subscription.remove() }
  }, [accountId]))
  useEffect(() => {
    if (!snapshot) return
    const remaining = snapshot.sessions.map((session) => Date.parse(session.expiresAt) - Date.now()).filter((ms) => ms > 0)
    if (!remaining.length) return
    const timer = setTimeout(() => setSnapshot((current) => current && ({ ...current,
      sessions: current.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now()),
    })), Math.min(...remaining) + 20)
    return () => clearTimeout(timer)
  }, [snapshot])
  return snapshot?.accountId === accountId
    ? snapshot.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now()) : []
}
