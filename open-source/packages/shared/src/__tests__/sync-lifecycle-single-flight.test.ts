// @covers ../hooks/useSync.ts

import { describe, expect, it, vi } from 'vitest'
import {
  createLifecycleBoundIndexStore,
  createSingleFlightRecovery,
  resolveNativeRelayLifecycleAction,
} from '../hooks/useSync'

describe('sync lifecycle recovery', () => {
  it('ignores transient inactive state and only suspends in true background', () => {
    expect(resolveNativeRelayLifecycleAction('active')).toBe('resume')
    expect(resolveNativeRelayLifecycleAction('background')).toBe('suspend')
    expect(resolveNativeRelayLifecycleAction('inactive')).toBe('ignore')
    expect(resolveNativeRelayLifecycleAction('unknown')).toBe('ignore')
  })

  it('coalesces concurrent resume and online recovery for one account', async () => {
    let finish: (() => void) | undefined
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const recover = createSingleFlightRecovery(run)

    const resume = recover('app-foreground')
    const online = recover('network-restored')
    expect(resume).toBe(online)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith('app-foreground')

    finish?.()
    await resume
    const later = recover('network-restored')
    expect(run).toHaveBeenCalledTimes(2)
    finish?.()
    await later
  })

  it('rejects delayed store work after an account lifecycle is replaced', async () => {
    let current = true
    const putMachines = vi.fn(async () => undefined)
    const store = createLifecycleBoundIndexStore({ putMachines } as never, () => current)

    await store.putMachines([])
    current = false
    await expect(store.putMachines([])).rejects.toThrow('sync lifecycle expired')
    expect(putMachines).toHaveBeenCalledOnce()
  })
})
