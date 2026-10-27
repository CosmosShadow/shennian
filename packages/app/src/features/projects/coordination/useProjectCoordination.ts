// @arch docs/features/project-coordination.md
// @test src/__tests__/project-coordination-availability.test.ts
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useAuthStore } from '../../../config/auth'
import { projectCoordinationRequest } from './client'
import {
  COORDINATION_REFRESH_MS,
  coordinationEntry,
  coordinationIdentityKey,
  hydrateCoordination,
  needsCoordinationRefresh,
  refreshCoordination,
  rememberCoordination,
  reportCoordinationError,
  subscribeCoordination,
} from './localState'

/**
 * Local-first project coordination state.
 *
 * The last readable snapshot is persisted per account/machine/project and is
 * painted before any network work starts. A read only goes to the Client when
 * that record is missing or stale, when the screen returns to the foreground,
 * or when the user acts. Mutations still go straight to the Client that owns
 * the queue.
 */
export function useProjectCoordination(
  machineId: string,
  workDir: string,
  online = true,
  options: { maxAgeMs?: number; intervalMs?: number } = {},
) {
  const maxAgeMs = options.maxAgeMs ?? COORDINATION_REFRESH_MS
  const intervalMs = options.intervalMs ?? COORDINATION_REFRESH_MS
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const identity = useMemo(
    () => ({ accountId, machineId, workDir }),
    [accountId, machineId, workDir],
  )
  const key = coordinationIdentityKey(identity)
  const subscribe = useCallback(
    (listener: () => void) => subscribeCoordination(key, listener),
    [key],
  )
  const getSnapshot = useCallback(() => coordinationEntry(key), [key])
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const request = useCallback(
    async (input: Record<string, unknown> = {}) => {
      if (!online) throw new Error('coordination_machine_offline')
      if (!machineId || !workDir) throw new Error('coordination_unavailable')
      const read = !input.command || input.command === 'get'
      const startedAt = Date.now()
      try {
        if (read) return await refreshCoordination(identity)
        const next = await projectCoordinationRequest(machineId, workDir, input)
        rememberCoordination(key, next)
        return next
      } catch (error) {
        // A rejected mutation must keep the readable settings and must not be
        // reported as a connection failure. Failed reads do mark the snapshot
        // unavailable until a later read succeeds.
        if (read) reportCoordinationError(key, error, startedAt)
        throw error
      }
    },
    [identity, key, machineId, online, workDir],
  )

  useFocusEffect(
    useCallback(() => {
      let live = true
      let busy = false
      const refresh = async () => {
        if (!live || busy || !machineId || !workDir) return
        // Even while the computer is offline, paint the last local record.
        await hydrateCoordination(key)
        if (!live || !online || !needsCoordinationRefresh(key, Date.now(), maxAgeMs)) return
        busy = true
        try {
          await refreshCoordination(identity)
        } catch {
          // Keep the last readable snapshot and its error marker.
        } finally {
          busy = false
        }
      }

      // Returning to the page paints the local record first. Only a missing or
      // stale record triggers an immediate Client read.
      const initialRefresh = InteractionManager.runAfterInteractions(() => { void refresh() })

      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void refresh()
      }, intervalMs)
      const state = AppState.addEventListener('change', (next) => {
        if (next === 'active') void refresh()
      })
      return () => {
        live = false
        initialRefresh.cancel()
        clearInterval(timer)
        state.remove()
      }
    }, [identity, intervalMs, key, machineId, maxAgeMs, online, workDir]),
  )

  return { state: entry.snapshot, error: entry.error, request }
}
