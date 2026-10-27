// @covers ../relay-manager-lifecycle.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RelayConnectivitySnapshot } from '@shennian/wire'
import type { RelayManager } from '../relay-manager'
import { DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT } from '../relay'
import { getRelayManager, setRelayManager, subscribeRelayConnectivity } from '../relay-manager-lifecycle'

function createManager() {
  const listeners = new Set<(snapshot: RelayConnectivitySnapshot) => void>()
  let snapshot = { ...DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT }
  const manager = {
    getUserConnectivitySnapshot: () => snapshot,
    onUserConnectivityChange(listener: (value: RelayConnectivitySnapshot) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  } as RelayManager
  return {
    manager, listeners,
    emit(phase: RelayConnectivitySnapshot['phase']) {
      snapshot = { ...snapshot, phase }
      for (const listener of listeners) listener(snapshot)
    },
  }
}

afterEach(() => setRelayManager(null))

describe('account connectivity subscription lifecycle', () => {
  it('subscribes before initialization and observes recovery without remounting', () => {
    const listener = vi.fn()
    const stop = subscribeRelayConnectivity(listener)
    expect(listener).toHaveBeenLastCalledWith(null)
    const first = createManager()
    setRelayManager(first.manager)
    expect(getRelayManager()).toBe(first.manager)
    first.emit('connected')
    expect(listener.mock.lastCall?.[0]?.phase).toBe('connected')
    first.emit('recovering')
    expect(listener.mock.lastCall?.[0]?.phase).toBe('recovering')
    first.emit('connected')
    expect(listener.mock.lastCall?.[0]?.phase).toBe('connected')
    stop()
  })

  it('detaches a replaced manager and delivers logout and the next account snapshot', () => {
    const first = createManager()
    const second = createManager()
    setRelayManager(first.manager)
    const listener = vi.fn()
    const stop = subscribeRelayConnectivity(listener)
    setRelayManager(null)
    expect(listener).toHaveBeenLastCalledWith(null)
    expect(first.listeners.size).toBe(0)
    second.emit('connected')
    setRelayManager(second.manager)
    expect(listener.mock.lastCall?.[0]?.phase).toBe('connected')
    listener.mockClear()
    first.emit('offline')
    expect(listener).not.toHaveBeenCalled()
    setRelayManager(second.manager)
    expect(second.listeners.size).toBe(1)
    stop()
    second.emit('recovering')
    expect(listener).not.toHaveBeenCalled()
  })
})
