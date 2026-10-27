// @covers src/features/chat/utils/presentationAckRetry.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPresentationAckRetry } from '../features/chat/utils/presentationAckRetry'

afterEach(() => {
  vi.useRealTimers()
})

describe('presentation acknowledgement retry', () => {
  it('acknowledges immediately and keeps retrying until the token is cleared', async () => {
    vi.useFakeTimers()
    const acknowledge = vi.fn()

    const stop = startPresentationAckRetry('session-1:9:4', acknowledge, 500)

    expect(acknowledge).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenLastCalledWith('session-1:9:4')

    await vi.advanceTimersByTimeAsync(1_500)
    expect(acknowledge).toHaveBeenCalledTimes(3)

    stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(acknowledge).toHaveBeenCalledTimes(3)
  })

  it('uses a safe minimum interval under an invalidly small configuration', async () => {
    vi.useFakeTimers()
    const acknowledge = vi.fn()

    const stop = startPresentationAckRetry('session-1:9:4', acknowledge, 0, 100)
    await vi.advanceTimersByTimeAsync(99)
    expect(acknowledge).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(acknowledge).toHaveBeenCalledTimes(2)
    stop()
  })
})
