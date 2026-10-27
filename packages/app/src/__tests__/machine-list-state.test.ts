/**
 * @covers src/features/machines/services/machineListState.ts
 */

import { describe, expect, it, vi } from 'vitest'
import type { Machine } from '@shennian/wire'
import {
  classifyMachineListFailure,
  refreshMachineList,
  resolveMachineListSurfaceState,
} from '../features/machines/services/machineListState'

const machine = { id: 'machine-1', name: 'Mac', online: true } as Machine

describe('machine list state', () => {
  it('keeps the shell and cached rows visible during local refresh', () => {
    expect(
      resolveMachineListSurfaceState({
        machineCount: 1,
        loading: true,
        remoteResolved: true,
        refreshing: true,
        failure: null,
      }),
    ).toBe('refreshing')
  })

  it('does not turn cached offline data into an empty state', () => {
    expect(
      resolveMachineListSurfaceState({
        machineCount: 1,
        loading: false,
        remoteResolved: true,
        refreshing: false,
        failure: 'offline',
      }),
    ).toBe('offline')
    expect(
      resolveMachineListSurfaceState({
        machineCount: 0,
        loading: false,
        remoteResolved: false,
        refreshing: false,
        failure: 'offline',
      }),
    ).toBe('offline')
  })

  it('classifies explicit authority failures before connectivity hints', () => {
    expect(classifyMachineListFailure({ status: 403 }, 'connected')).toBe('forbidden')
    expect(classifyMachineListFailure({ status: 401 }, 'disconnected')).toBe('forbidden')
    expect(classifyMachineListFailure(new Error('socket'), 'disconnected')).toBe('offline')
    expect(classifyMachineListFailure(new Error('server'), 'connected')).toBe('error')
  })

  it('clears stale identities when authority is revoked', async () => {
    const replaceMachines = vi.fn()
    const markRemoteResolved = vi.fn()

    await expect(
      refreshMachineList({
        request: async () => {
          throw { status: 403 }
        },
        connectivity: 'connected',
        replaceMachines,
        markRemoteResolved,
      }),
    ).resolves.toBe('forbidden')
    expect(replaceMachines).toHaveBeenCalledOnce()
    expect(replaceMachines).toHaveBeenCalledWith([])
    expect(markRemoteResolved).toHaveBeenCalledOnce()
  })

  it('preserves cached rows after a recoverable failure and replaces them on retry', async () => {
    const replaceMachines = vi.fn()
    const markRemoteResolved = vi.fn()
    const request = vi
      .fn<() => Promise<{ machines?: Machine[] }>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ machines: [machine] })
    const input = {
      request,
      connectivity: 'connected' as const,
      replaceMachines,
      markRemoteResolved,
    }

    await expect(refreshMachineList(input)).resolves.toBe('error')
    expect(replaceMachines).not.toHaveBeenCalled()
    expect(markRemoteResolved).not.toHaveBeenCalled()

    await expect(refreshMachineList(input)).resolves.toBeNull()
    expect(replaceMachines).toHaveBeenCalledWith([machine])
    expect(markRemoteResolved).toHaveBeenCalledOnce()
  })

  it('ignores a late request after a newer generation has taken ownership', async () => {
    let resolveOld: ((value: { machines: Machine[] }) => void) | undefined
    const oldRequest = new Promise<{ machines: Machine[] }>((resolve) => {
      resolveOld = resolve
    })
    let generation = 1
    const replaceMachines = vi.fn()
    const markRemoteResolved = vi.fn()
    const oldRefresh = refreshMachineList({
      request: () => oldRequest,
      connectivity: 'connected',
      replaceMachines,
      markRemoteResolved,
      isCurrent: () => generation === 1,
    })

    generation = 2
    await refreshMachineList({
      request: async () => ({ machines: [machine] }),
      connectivity: 'connected',
      replaceMachines,
      markRemoteResolved,
      isCurrent: () => generation === 2,
    })
    resolveOld?.({ machines: [{ ...machine, id: 'stale' }] })
    await oldRefresh

    expect(replaceMachines).toHaveBeenCalledOnce()
    expect(replaceMachines).toHaveBeenCalledWith([machine])
    expect(markRemoteResolved).toHaveBeenCalledOnce()
  })
})
