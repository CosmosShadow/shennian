// @arch docs/features/desktop-page-state-matrix.md#machine-list-closure
// @test src/__tests__/machine-list-state.test.ts

import type { Machine } from '@shennian/wire'

export type MachineListFailure = 'offline' | 'forbidden' | 'error'

export type MachineListSurfaceState =
  | 'initial-loading'
  | 'ready'
  | 'empty'
  | 'refreshing'
  | 'offline'
  | 'forbidden'
  | 'error'

export function classifyMachineListFailure(
  error: unknown,
  connectivity: 'connected' | 'disconnected',
): MachineListFailure {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0
  if (status === 401 || status === 403) return 'forbidden'
  if (connectivity === 'disconnected') return 'offline'
  return 'error'
}

export function resolveMachineListSurfaceState(input: {
  machineCount: number
  loading: boolean
  remoteResolved: boolean
  refreshing: boolean
  failure: MachineListFailure | null
}): MachineListSurfaceState {
  if (input.failure === 'forbidden') return 'forbidden'
  if (input.machineCount > 0) {
    if (input.refreshing) return 'refreshing'
    if (input.failure === 'offline') return 'offline'
    if (input.failure === 'error') return 'error'
    return 'ready'
  }
  if (input.failure === 'offline') return 'offline'
  if (input.failure === 'error') return 'error'
  if (input.loading || !input.remoteResolved) return 'initial-loading'
  return 'empty'
}

export async function refreshMachineList(input: {
  request: () => Promise<{ machines?: Machine[] }>
  connectivity: 'connected' | 'disconnected'
  replaceMachines: (machines: Machine[]) => void
  markRemoteResolved: () => void
  isCurrent?: () => boolean
}): Promise<MachineListFailure | null> {
  try {
    const response = await input.request()
    if (input.isCurrent && !input.isCurrent()) return null
    input.replaceMachines(response.machines ?? [])
    input.markRemoteResolved()
    return null
  } catch (error) {
    if (input.isCurrent && !input.isCurrent()) return null
    const failure = classifyMachineListFailure(error, input.connectivity)
    if (failure === 'forbidden') {
      // Cached machine identities belong to the previous authority snapshot.
      // Never leave them visible after the server explicitly rejects access.
      input.replaceMachines([])
      input.markRemoteResolved()
    }
    return failure
  }
}
