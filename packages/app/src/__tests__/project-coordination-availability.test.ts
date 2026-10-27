// @vitest-environment happy-dom
// @covers packages/app/src/features/projects/coordination/useProjectCoordination.ts
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('expo-router', () => ({ useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) }))
vi.mock('../features/projects/coordination/client', () => ({ projectCoordinationRequest: vi.fn() }))
const interactions = vi.hoisted(() => ({ defer: false, pending: [] as Array<() => void>, cancel: vi.fn() }))
vi.mock('react-native', () => ({ InteractionManager: { runAfterInteractions: (fn: () => void) => { if (interactions.defer) interactions.pending.push(fn); else fn(); return { cancel: interactions.cancel } } }, AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }))
vi.mock('../config/auth', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: 'qa' } }) }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}), getAllKeys: vi.fn(async () => []), multiRemove: vi.fn(async () => {}) } }))
import { projectCoordinationRequest } from '../features/projects/coordination/client'
import {
  coordinationIdentityKey,
  rememberCoordination,
} from '../features/projects/coordination/localState'
import { useProjectCoordination } from '../features/projects/coordination/useProjectCoordination'

it('retains the readable settings after a rejected mutation, while reporting failed reads', async () => {
  const snapshot = { enabled: false, tasks: [] } as never
  const call = vi.mocked(projectCoordinationRequest).mockResolvedValue(snapshot)
  let view: ReturnType<typeof useProjectCoordination>
  function Probe() { view = useProjectCoordination('machine-qa', '/project-qa'); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(React.createElement(Probe)))
    expect(view!.state).toBe(snapshot)
    call.mockRejectedValueOnce(new Error('coordination_wait_for_active_tasks'))
    await act(async () => {
      await expect(view!.request({ command: 'configure', patch: { enabled: true } })).rejects.toThrow('coordination_wait_for_active_tasks')
    })
    expect(view!.state).toBe(snapshot)
    expect(view!.error).toBe('')
    call.mockRejectedValueOnce(new Error('coordination_machine_offline'))
    await act(async () => { await expect(view!.request({ command: 'get' })).rejects.toThrow('coordination_machine_offline') })
    expect(view!.error).toBe('coordination_machine_offline')
  } finally { await act(async () => root.unmount()) }
})

it('paints a fresh local record without probing the machine again', async () => {
  const snapshot = { enabled: true, paused: false, tasks: [], messages: [], revision: 7 } as never
  const key = coordinationIdentityKey({ accountId: 'qa', machineId: 'machine-cached', workDir: '/project-cached' })
  rememberCoordination(key, snapshot)
  const call = vi.mocked(projectCoordinationRequest).mockClear()
  let view: ReturnType<typeof useProjectCoordination>
  function Probe() { view = useProjectCoordination('machine-cached', '/project-cached'); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(React.createElement(Probe)))
    expect(view!.state).toBe(snapshot)
    expect(view!.error).toBe('')
    expect(call).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})


it('defers the first machine read until the card settles and cancels on leave', async () => {
  interactions.defer = true
  interactions.cancel.mockClear()
  const call = vi.mocked(projectCoordinationRequest).mockClear().mockResolvedValue({ enabled: false, tasks: [] } as never)
  function Probe() { useProjectCoordination('deferred-machine', '/deferred'); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(React.createElement(Probe)))
    expect(call).not.toHaveBeenCalled()
    await act(async () => interactions.pending.shift()!())
    expect(call).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    expect(interactions.cancel).toHaveBeenCalledTimes(1)
    interactions.defer = false
    interactions.pending = []
  }
})
