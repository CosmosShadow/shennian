// @covers open-source/packages/server/src/services/voice-incoming-call-intent.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { intent, createVoiceIncomingCallMock } = vi.hoisted(() => ({
  intent: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  createVoiceIncomingCallMock: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: { voiceIncomingCallIntent: intent } }))
vi.mock('../services/voice-incoming-call.js', () => ({
  createVoiceIncomingCall: createVoiceIncomingCallMock,
}))

describe('voice incoming call intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    intent.upsert.mockResolvedValue({})
    intent.findMany.mockResolvedValue([])
    intent.updateMany.mockResolvedValue({ count: 1 })
    createVoiceIncomingCallMock.mockResolvedValue({
      callId: 'call-1', status: 'ringing', platform: 'ios',
    })
  })

  it('idempotently persists a stable call id without resetting delivery state', async () => {
    const { enqueueVoiceIncomingCallIntent } = await import('../services/voice-incoming-call-intent.js')
    await expect(enqueueVoiceIncomingCallIntent({
      userId: 'user-1',
      callId: 'call-1',
      reason: ' 任务完成 ',
      initialPrompt: ' 报告结果 ',
    })).resolves.toEqual({ callId: 'call-1', status: 'queued' })

    expect(intent.upsert).toHaveBeenCalledWith({
      where: { userId_callId: { userId: 'user-1', callId: 'call-1' } },
      create: expect.objectContaining({
        userId: 'user-1', callId: 'call-1', reason: '任务完成', initialPrompt: '报告结果',
      }),
      update: {
        reason: '任务完成', initialPrompt: '报告结果', projectHint: null, targetPlatform: null,
      },
    })
    expect(intent.upsert.mock.calls[0][0].update).not.toHaveProperty('status')
  })

  it('loads authoritative context only through the user and call id composite key', async () => {
    intent.findUnique.mockResolvedValue({
      callId: 'call-1', reason: '完成', initialPrompt: '播报', projectHint: '项目',
    })
    const { loadVoiceIncomingCallIntentContext } = await import('../services/voice-incoming-call-intent.js')
    await expect(loadVoiceIncomingCallIntentContext('user-1', 'call-1')).resolves.toMatchObject({
      callId: 'call-1', reason: '完成',
    })
    expect(intent.findUnique).toHaveBeenCalledWith({
      where: { userId_callId: { userId: 'user-1', callId: 'call-1' } },
      select: { callId: true, reason: true, initialPrompt: true, projectHint: true },
    })
  })

  it('leases one intent and sends the external push from the Worker drain', async () => {
    intent.findMany.mockResolvedValue([{
      id: 'intent-1',
      userId: 'user-1',
      callId: 'call-1',
      reason: '完成',
      initialPrompt: '播报',
      projectHint: '项目',
      targetPlatform: 'ios',
      attempts: 0,
    }])
    const { processPendingVoiceIncomingCallIntents } = await import('../services/voice-incoming-call-intent.js')
    await expect(processPendingVoiceIncomingCallIntents({ workerId: 'worker-1' })).resolves.toEqual({
      claimed: 1, sent: 1, retried: 0, terminal: 0,
    })

    expect(intent.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'intent-1', OR: expect.any(Array) },
      data: { status: 'processing', attempts: { increment: 1 }, workerId: 'worker-1' },
    })
    expect(createVoiceIncomingCallMock).toHaveBeenCalledWith({
      userId: 'user-1', callId: 'call-1', reason: '完成', initialPrompt: '播报',
      projectHint: '项目', targetPlatform: 'ios',
    })
    expect(intent.updateMany.mock.calls[1][0]).toMatchObject({
      where: { id: 'intent-1', status: 'processing', workerId: 'worker-1' },
      data: { status: 'sent', leaseUntil: null, workerId: null, errorMessage: null },
    })
  })

  it('requeues a failed delivery with its existing stable call id', async () => {
    intent.findMany.mockResolvedValue([{
      id: 'intent-1', userId: 'user-1', callId: 'call-stable', reason: null,
      initialPrompt: null, projectHint: null, targetPlatform: null, attempts: 0,
    }])
    createVoiceIncomingCallMock.mockResolvedValue({
      callId: 'call-stable', status: 'failed', message: 'temporary failure',
    })
    const { processPendingVoiceIncomingCallIntents } = await import('../services/voice-incoming-call-intent.js')
    await expect(processPendingVoiceIncomingCallIntents({ workerId: 'worker-2' })).resolves.toMatchObject({
      claimed: 1, retried: 1,
    })
    expect(createVoiceIncomingCallMock).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-stable' }))
    expect(intent.updateMany.mock.calls[1][0]).toMatchObject({
      data: { status: 'pending', errorMessage: 'temporary failure' },
    })
  })
})
