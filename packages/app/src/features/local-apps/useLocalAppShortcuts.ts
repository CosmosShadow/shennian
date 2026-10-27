// @arch docs/architecture/local-apps.md
import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuthStore } from '../../config/auth'
import { createAppShortcutRepository, type LocalAppShortcut } from './shortcuts'
const repository = createAppShortcutRepository(AsyncStorage)
const EMPTY: LocalAppShortcut[] = []
export function useLocalAppShortcuts() {
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  const [snapshot, setSnapshot] = useState({ accountId: '', entries: EMPTY })
  useEffect(() => {
    let active = true
    const load = () => {
      if (accountId)
        void repository
          .read(accountId)
          .then((entries) => {
            if (active) setSnapshot({ accountId, entries })
          })
          .catch(() => {})
    }
    load()
    const unsubscribe = repository.subscribe((id) => {
      if (id === accountId) load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [accountId])
  const change = useCallback(
    async (entry: LocalAppShortcut, remove = false) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId)
        throw new Error('unauthenticated')
      await repository.change(accountId, entry, remove)
    },
    [accountId],
  )
  return { shortcuts: snapshot.accountId === accountId ? snapshot.entries : EMPTY, change }
}
