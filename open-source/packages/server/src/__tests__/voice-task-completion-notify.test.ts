// @covers open-source/packages/server/src/services/voice-task-completion-notify.ts
// @covers open-source/packages/server/src/jobs/voice-task-completion-notify.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  createCall: vi.fn(),
  writeLog: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    voiceTaskCompletionNotify: {
      create: mocks.create,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}))
vi.mock('../services/voice-incoming-call-intent.js', () => ({ enqueueVoiceIncomingCallIntent: mocks.createCall }))
vi.mock('../services/log.js', () => ({ writeLog: mocks.writeLog }))

import {
  processPendingVoiceTaskCompletionNotifies,
  registerVoiceTaskCompletionNotify,
} from '../services/voice-task-completion-notify.js'

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notify-1',
    userId: 'user-1',
    sessionId: 'session-1',
    reason: null,
    initialPrompt: null,
    projectHint: 'shennian',
    callId: null,
    attempts: 0,
    session: {
      status: 'completed',
      title: '发布任务',
      lastMessagePreview: '发布完成',
      bodyRevision: 7,
      lastAttentionId: 'terminal:run-7',
    },
    ...overrides,
  }
}

describe('voice task completion notification worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ id: 'notify-1' })
    mocks.findMany.mockResolvedValue([])
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.createCall.mockResolvedValue({ callId: 'call_completion_notify-1', status: 'queued' })
    mocks.writeLog.mockResolvedValue(undefined)
  })

  it('only persists an explicit completion-call request', async () => {
    await registerVoiceTaskCompletionNotify({ userId: 'user-1', sessionId: 'session-1', mode: 'message' })
    expect(mocks.create).not.toHaveBeenCalled()

    await registerVoiceTaskCompletionNotify({
      userId: 'user-1',
      sessionId: 'session-1',
      mode: 'call',
      reason: '  任务完成  ',
    })
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'pending', mode: 'call' }),
      data: { status: 'superseded' },
    }))
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: '任务完成', availableAt: expect.any(Date) }),
    })
  })

  it('discovers only due requests whose authoritative session is terminal', async () => {
    await processPendingVoiceTaskCompletionNotifies({ workerId: 'worker-a' })

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        mode: 'call',
        OR: expect.arrayContaining([
          expect.objectContaining({ status: 'pending' }),
          expect.objectContaining({ status: 'processing' }),
        ]),
        session: expect.objectContaining({
          status: { in: ['completed', 'failed'] },
          deletedAt: null,
          agentIdentityId: null,
        }),
      }),
    }))
    expect(mocks.createCall).not.toHaveBeenCalled()
  })

  it('leases a due row and sends it with a stable call id', async () => {
    mocks.findMany.mockResolvedValue([candidate()])

    await expect(processPendingVoiceTaskCompletionNotifies({ workerId: 'worker-a' })).resolves.toEqual({
      claimed: 1, sent: 1, retried: 0, terminal: 0,
    })

    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: 'notify-1',
        session: { status: { in: ['completed', 'failed'] }, deletedAt: null },
      }),
      data: expect.objectContaining({
        status: 'processing',
        attempts: { increment: 1 },
        workerId: 'worker-a',
        callId: 'call_completion_notify-1',
        completedRunId: 'terminal:run-7',
        leaseUntil: expect.any(Date),
      }),
    }))
    expect(mocks.createCall).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      callId: 'call_completion_notify-1',
      reason: '发布任务 已完成',
      initialPrompt: expect.stringContaining('发布完成'),
    }))
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'notify-1', status: 'processing', workerId: 'worker-a' },
      data: expect.objectContaining({ status: 'sent', leaseUntil: null, workerId: null }),
    }))
  })

  it('reclaims an expired lease and reuses the persisted call id', async () => {
    mocks.findMany.mockResolvedValue([candidate({
      callId: 'call_completion_existing',
      attempts: 1,
    })])

    await processPendingVoiceTaskCompletionNotifies({ workerId: 'worker-b' })

    expect(mocks.createCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call_completion_existing' }))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([expect.objectContaining({ status: 'processing' })]),
      }),
    }))
  })

  it('backs off transient delivery failure and reaches a terminal state after five attempts', async () => {
    mocks.findMany.mockResolvedValue([candidate()])
    mocks.createCall.mockRejectedValue(new Error('intent insert failed'))

    await expect(processPendingVoiceTaskCompletionNotifies({ workerId: 'worker-a' })).resolves.toEqual({
      claimed: 1, sent: 0, retried: 1, terminal: 0,
    })
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending', availableAt: expect.any(Date), errorMessage: 'intent insert failed' }),
    }))

    vi.clearAllMocks()
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findMany.mockResolvedValue([candidate({ attempts: 4 })])
    mocks.createCall.mockRejectedValue(new Error('provider down'))

    await expect(processPendingVoiceTaskCompletionNotifies({ workerId: 'worker-a' })).resolves.toEqual({
      claimed: 1, sent: 0, retried: 0, terminal: 1,
    })
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', leaseUntil: null, errorMessage: 'provider down' }),
    }))
  })

  it('does not deliver when another worker wins the claim', async () => {
    mocks.findMany.mockResolvedValue([candidate()])
    mocks.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(processPendingVoiceTaskCompletionNotifies({ workerId: 'worker-loser' })).resolves.toEqual({
      claimed: 0, sent: 0, retried: 0, terminal: 0,
    })
    expect(mocks.createCall).not.toHaveBeenCalled()
  })
})
