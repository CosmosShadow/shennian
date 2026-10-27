// @covers open-source/packages/server/src/jobs/voice-task-completion-notify.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const processPendingMock = vi.hoisted(() => vi.fn())

vi.mock('../services/voice-task-completion-notify.js', () => ({
  processPendingVoiceTaskCompletionNotifies: processPendingMock,
}))

import {
  startVoiceTaskCompletionNotifyJob,
  stopVoiceTaskCompletionNotifyJob,
} from '../jobs/voice-task-completion-notify.js'

describe('voice task completion notification job', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    processPendingMock.mockReset().mockResolvedValue({ claimed: 0, sent: 0, retried: 0, terminal: 0 })
  })

  afterEach(async () => {
    await stopVoiceTaskCompletionNotifyJob()
    vi.useRealTimers()
  })

  it('drains immediately, polls, and stops without leaving an active interval', async () => {
    startVoiceTaskCompletionNotifyJob()
    await vi.runAllTicks()
    expect(processPendingMock).toHaveBeenCalledTimes(1)
    expect(processPendingMock).toHaveBeenCalledWith({
      workerId: expect.stringMatching(/^voice-completion-/),
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(processPendingMock).toHaveBeenCalledTimes(2)

    await stopVoiceTaskCompletionNotifyJob()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(processPendingMock).toHaveBeenCalledTimes(2)
  })
})
