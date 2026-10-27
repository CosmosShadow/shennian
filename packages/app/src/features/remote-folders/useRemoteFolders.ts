// @arch docs/architecture/remote-folders.md
import { useEffect, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuthStore } from '../../config/auth'
import { createFolderRepository, type RemoteFolder } from './model'
const repository = createFolderRepository(AsyncStorage)
const EMPTY: RemoteFolder[] = []
export function useRemoteFolders() {
  const accountId = useAuthStore(s => s.user?.id ?? '')
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const [snapshot, setSnapshot] = useState({ accountId: '', folders: EMPTY, ready: false, error: false })
  useEffect(() => {
    let active = true
    const load = () => { if (accountId) void repository.read(accountId).then(folders => {
      if (active) setSnapshot({ accountId, folders, ready: true, error: false })
    }).catch(() => {
      if (active) setSnapshot({ accountId, folders: EMPTY, ready: false, error: true })
    }) }
    load()
    const unsubscribe = repository.subscribe(changedId => { if (changedId === accountId) load() })
    return () => { active = false; unsubscribe() }
  }, [accountId, revision])
  const change = useCallback(async (folder: RemoteFolder, remove = false) => {
    if (!accountId) throw new Error('unauthenticated')
    const folders = await repository.change(accountId, folder, remove)
    if (useAuthStore.getState().user?.id === accountId) setSnapshot({ accountId, folders, ready: true, error: false })
  }, [accountId])
  return {
    accountId,
    reload,
    folders: snapshot.accountId === accountId ? snapshot.folders : EMPTY,
    ready: snapshot.accountId === accountId && snapshot.ready,
    error: snapshot.accountId === accountId && snapshot.error,
    change,
  }
}
