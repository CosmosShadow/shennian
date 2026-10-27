// @covers open-source/packages/server/src/jobs/voice-incoming-call-intent.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const processPendingMock = vi.hoisted(() => vi.fn())

vi.mock('../services/voice-incoming-call-intent.js', () => ({
  processPendingVoiceIncomingCallIntents: processPendingMock,
}))

import {
  startVoiceIncomingCallIntentJob,
  stopVoiceIncomingCallIntentJob,
} from '../jobs/voice-incoming-call-intent.js'

describe('voice incoming call intent job', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    processPendingMock.mockReset().mockResolvedValue({ claimed: 0, sent: 0, retried: 0, terminal: 0 })
  })

  afterEach(async () => {
    await stopVoiceIncomingCallIntentJob()
    vi.useRealTimers()
  })

  it('drains immediately, polls, and stops without leaving an active interval', async () => {
    startVoiceIncomingCallIntentJob()
    await vi.runAllTicks()
    expect(processPendingMock).toHaveBeenCalledTimes(1)
    expect(processPendingMock).toHaveBeenCalledWith({
      workerId: expect.stringMatching(/^voice-call-/),
    })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(processPendingMock).toHaveBeenCalledTimes(2)

    await stopVoiceIncomingCallIntentJob()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(processPendingMock).toHaveBeenCalledTimes(2)
  })
})
