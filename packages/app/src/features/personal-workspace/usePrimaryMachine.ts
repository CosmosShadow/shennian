// @arch docs/features/personal-agent-workspace.md
import { useCallback, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getServerUrl } from '../../config/server'
import { useFocusEffect } from 'expo-router'
import { useAuthStore } from '../../config/auth'
import { primaryMachineClient, personalErrorKey, type PrimaryMachine } from './client'
// Cached routing is for displaying local conversation history only. Setup and writes
// still wait for revalidation; other consumers retain their fail-closed behavior.
export function usePrimaryMachine({ cachedDisplay = false }: { cachedDisplay?: boolean } = {}) {
  const accountId = useAuthStore(s => s.user?.id)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ accountId: string | undefined; value?: PrimaryMachine; error?: string; loading: boolean }>({ accountId, loading: true })
  useFocusEffect(useCallback(() => {
    let live = true
    let remoteReceived = false
    const current = () => live && useAuthStore.getState().user?.id === accountId
    const cacheKey = `shennian:primary-machine:v1:${getServerUrl()}:${accountId}`
    if (cachedDisplay && accountId) {
      void AsyncStorage.getItem(cacheKey).then(raw => {
        if (!current() || remoteReceived || !raw) return
        const value = JSON.parse(raw) as PrimaryMachine
        if (!Number.isInteger(value?.revision) || !(value.machine === null || (
          typeof value.machine?.id === 'string' && typeof value.machine.name === 'string'
          && typeof value.machine.online === 'boolean'
        ))) return
        setState(previous => previous.accountId === accountId && !previous.value
          ? { ...previous, value } : previous)
      }).catch(() => { /* Cache is optional; never block Server revalidation. */ })
    }
    // Keep the current account's snapshot while revalidating on focus.
    setState(previous => previous.accountId === accountId
      ? { ...previous, error: undefined, loading: true }
      : { accountId, loading: true })
    void primaryMachineClient.get().then(value => {
      if (!current()) return
      remoteReceived = true
      setState({ accountId, value, loading: false })
      if (accountId) void AsyncStorage.setItem(cacheKey, JSON.stringify(value)).catch(() => {})
    }).catch(error => {
      if (current()) setState(previous => ({
        accountId,
        ...(cachedDisplay && previous.accountId === accountId ? { value: previous.value } : {}),
        error: personalErrorKey(error), loading: false,
      }))
    })
    return () => { live = false }
  }, [accountId, attempt, cachedDisplay]))
  return { record: state.accountId === accountId ? state.value : undefined, error: state.accountId === accountId ? state.error : undefined, loading: state.accountId !== accountId || state.loading, refresh: () => setAttempt(n => n + 1) }
}
