// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-list-projection.test.ts

import { useCallback, useSyncExternalStore } from 'react'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import {
  desktopAccountActions,
  getDesktopAccountRuntimeState,
  subscribeDesktopAccountRuntimeState,
} from '../desktop-control/useDesktopAccountSync'
import { resolveDesktopMachineInventory } from './desktopMachineListProjection'

/**
 * The single Desktop machine view projection. Main snapshots/events are the
 * only writers of useMachinesStore; the sidebar, list and detail all consume
 * this same account-scoped projection.
 */
export function useDesktopMachineListModel() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const machines = useMachinesStore((state) => state.machines)
  const remoteResolved = useMachinesStore((state) => state.remoteResolved)
  const runtime = useSyncExternalStore(
    subscribeDesktopAccountRuntimeState,
    getDesktopAccountRuntimeState,
    getDesktopAccountRuntimeState,
  )
  const inventory = resolveDesktopMachineInventory({ accountId, machines, remoteResolved, runtime })
  const retry = useCallback(async () => {
    try {
      await desktopAccountActions.reconcile()
    } catch {
      // Keep the authoritative runtime error/notice visible until main publishes a new status.
    }
  }, [])
  return { ...inventory, retry }
}
