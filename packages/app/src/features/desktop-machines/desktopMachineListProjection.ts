// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-list-projection.test.ts

import type { Machine } from '@shennian/wire'
import type { DesktopAccountRuntimeState } from '../desktop-control/desktopAccountRuntime'
import type { MachineListSurfaceState } from '../machines/services/machineListState'

export type DesktopMachineInventory = {
  machines: Machine[]
  surface: MachineListSurfaceState
}

export function resolveDesktopMachineInventory(input: {
  accountId: string | null
  machines: Machine[]
  remoteResolved: boolean
  runtime: DesktopAccountRuntimeState
}): DesktopMachineInventory {
  const { runtime } = input
  if (!input.accountId) return { machines: [], surface: 'forbidden' }
  if (runtime.accountId !== input.accountId) return { machines: [], surface: 'initial-loading' }
  const forbiddenError = runtime.error?.code === 'AUTH_REQUIRED' || runtime.error?.code === 'FORBIDDEN'
  const blockedReason = runtime.status?.phase === 'blocked'
    ? runtime.status.connectivity?.reason
    : null
  const forbiddenStatus = runtime.status?.phase === 'signed-out'
    || blockedReason === 'auth_required'
    || blockedReason === 'permission_revoked'

  if (forbiddenError || forbiddenStatus) return { machines: [], surface: 'forbidden' }
  if (!runtime.bootstrapped) {
    return {
      machines: input.machines,
      surface: runtime.error ? 'error' : 'initial-loading',
    }
  }
  if (runtime.error || runtime.status?.phase === 'blocked') {
    return { machines: input.machines, surface: 'error' }
  }
  if (runtime.status?.phase === 'offline') {
    return { machines: input.machines, surface: 'offline' }
  }
  if (input.machines.length) return { machines: input.machines, surface: 'ready' }
  return {
    machines: [],
    surface: input.remoteResolved || runtime.status?.remoteResolved ? 'empty' : 'initial-loading',
  }
}
