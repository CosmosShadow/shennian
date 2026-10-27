// @covers src/session/attachment-cleanup-loop.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAttachmentCleanupLoop } from '../session/attachment-cleanup-loop.js'

const turn = () => new Promise<void>(resolve => setImmediate(resolve))
afterEach(() => { vi.useRealTimers() })

describe('attachment cleanup scheduling', () => {
  it('never overlaps slow sweeps and cancels remaining roots when stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let release!: () => void
    const sweep = vi.fn((_root: string, _shouldContinue: () => boolean) =>
      new Promise<void>(resolve => { release = resolve }))
    const stop = startAttachmentCleanupLoop({ getRoots: () => ['unit-one', 'unit-two'],
      onError: vi.fn(), sweep })
    vi.advanceTimersByTime(180_000)
    expect(sweep).toHaveBeenCalledTimes(1)
    stop()
    expect(sweep.mock.calls[0]![1]()).toBe(false)
    release()
    await turn()
    vi.advanceTimersByTime(120_000)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('deduplicates roots and continues after a root fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const onError = vi.fn()
    const failure = new Error('unit disk error')
    const sweep = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const stop = startAttachmentCleanupLoop({ getRoots: () => ['unit-one', 'unit-one', 'unit-two'],
      onError, sweep })
    vi.advanceTimersByTime(60_000)
    await turn()
    await turn()
    expect(sweep.mock.calls.map(call => call[0])).toEqual(['unit-one', 'unit-two'])
    expect(onError).toHaveBeenCalledWith(failure)
    stop()
  })
})
