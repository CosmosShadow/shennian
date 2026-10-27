// @covers src/lib/badge-sync-scheduler.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBadgeSyncScheduler } from '../lib/badge-sync-scheduler'

afterEach(() => {
  vi.useRealTimers()
})

describe('badge sync scheduler', () => {
  it('debounces rapid requests into one scan', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => 3)
    const scheduler = createBadgeSyncScheduler(run)

    scheduler.schedule(150)
    scheduler.schedule(150)
    scheduler.schedule(150)

    await vi.advanceTimersByTimeAsync(149)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('allows only one inflight scan and collapses pressure into one trailing scan', async () => {
    vi.useFakeTimers()
    let finishFirst: ((value: number) => void) | undefined
    const run = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValue(5)
    const scheduler = createBadgeSyncScheduler(run)

    const first = scheduler.runNow()
    scheduler.schedule(150)
    scheduler.schedule(20)
    scheduler.schedule(80)

    expect(run).toHaveBeenCalledTimes(1)
    finishFirst?.(4)
    await first
    await vi.advanceTimersByTimeAsync(19)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
