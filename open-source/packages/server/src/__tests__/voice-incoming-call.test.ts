// @covers open-source/packages/server/src/services/voice-incoming-call.ts
// @covers open-source/packages/server/src/services/apns-voip.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findManyMock,
  requestLogCreateMock,
  sendApnsVoipPushMock,
  isApnsVoipConfiguredMock,
  sendJPushMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  requestLogCreateMock: vi.fn(),
  sendApnsVoipPushMock: vi.fn(),
  isApnsVoipConfiguredMock: vi.fn(),
  sendJPushMock: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    devicePushRegistration: {
      findMany: findManyMock,
    },
    requestLog: {
      create: requestLogCreateMock,
    },
  },
}))

vi.mock('../services/apns-voip.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apns-voip.js')>()),
  isApnsVoipConfigured: isApnsVoipConfiguredMock,
  sendApnsVoipPush: sendApnsVoipPushMock,
}))

vi.mock('../services/push.js', () => ({
  sendJPushCustomMessageToRegistrationId: sendJPushMock,
}))

describe('voice incoming call', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.clearAllMocks()
    isApnsVoipConfiguredMock.mockReturnValue(true)
    sendApnsVoipPushMock.mockResolvedValue(undefined)
    sendJPushMock.mockResolvedValue(undefined)
    requestLogCreateMock.mockResolvedValue({})
  })

  it('reports unavailable instead of ringing when system push is disabled', async () => {
    vi.stubEnv('SHENNIAN_PUSH_MODE', 'off')
    const { createVoiceIncomingCall } = await import('../services/voice-incoming-call.js')
    const result = await createVoiceIncomingCall({ userId: 'user-1', targetPlatform: 'android' })
    expect(result.status).toBe('unavailable')
    expect(findManyMock).not.toHaveBeenCalled()
    expect(sendJPushMock).not.toHaveBeenCalled()
    expect(sendApnsVoipPushMock).not.toHaveBeenCalled()
  })

  it('sends an iOS APNs VoIP push to the latest active device token', async () => {
    findManyMock.mockResolvedValue([
      {
        deviceId: 'old-device',
        token: 'old-token',
        updatedAt: new Date('2026-07-22T01:00:00.000Z'),
        device: { lastActiveAt: new Date('2026-07-22T01:00:00.000Z') },
      },
      {
        deviceId: 'new-device',
        token: 'new-token',
        updatedAt: new Date('2026-07-22T02:00:00.000Z'),
        device: { lastActiveAt: new Date('2026-07-22T03:00:00.000Z') },
      },
    ])

    const { createVoiceIncomingCall } = await import('../services/voice-incoming-call.js')
    const result = await createVoiceIncomingCall({
      userId: 'user-1',
      callId: 'call_completion_notify-1',
      reason: '任务有进展',
      initialPrompt: '接通后先说明进展。',
      projectHint: 'shennian',
    })

    expect(result).toMatchObject({
      callId: 'call_completion_notify-1',
      status: 'ringing',
      platform: 'ios',
    })
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', provider: 'apns-voip', platform: 'ios' },
    }))
    expect(sendApnsVoipPushMock).toHaveBeenCalledWith(expect.objectContaining({
      token: 'new-token',
      payload: expect.objectContaining({
        call_id: 'call_completion_notify-1',
        caller_name: '神念',
        reason: '任务有进展',
        initial_prompt: '接通后先说明进展。',
        project_hint: 'shennian',
      }),
    }))
  })

  it('returns unavailable when no explicit iOS VoIP token is registered', async () => {
    findManyMock.mockResolvedValue([])

    const { createVoiceIncomingCall } = await import('../services/voice-incoming-call.js')
    const result = await createVoiceIncomingCall({ userId: 'user-1', targetPlatform: 'ios' })

    expect(result).toMatchObject({ status: 'unavailable', platform: 'ios' })
    expect(sendApnsVoipPushMock).not.toHaveBeenCalled()
  })

  it('sends an Android JPush incoming call custom message to the latest active device token', async () => {
    findManyMock.mockResolvedValue([
      {
        deviceId: 'old-android',
        token: 'old-registration-id',
        updatedAt: new Date('2026-07-22T01:00:00.000Z'),
        device: { lastActiveAt: new Date('2026-07-22T01:00:00.000Z') },
      },
      {
        deviceId: 'new-android',
        token: 'new-registration-id',
        updatedAt: new Date('2026-07-22T02:00:00.000Z'),
        device: { lastActiveAt: new Date('2026-07-22T03:00:00.000Z') },
      },
    ])

    const { createVoiceIncomingCall } = await import('../services/voice-incoming-call.js')
    const result = await createVoiceIncomingCall({
      userId: 'user-1',
      targetPlatform: 'android',
      reason: '任务完成了',
      initialPrompt: '接通后告诉用户任务已完成。',
      projectHint: 'shennian',
    })

    expect(result).toMatchObject({ status: 'ringing', platform: 'android' })
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', provider: 'jpush', platform: 'android' },
    }))
    expect(sendJPushMock).toHaveBeenCalledWith(expect.objectContaining({
      registrationId: 'new-registration-id',
      platform: 'android',
      title: '神念来电',
      content: '神念来电：任务完成了',
      data: expect.objectContaining({
        shennian_type: 'voice_incoming_call',
        reason: '任务完成了',
        initialPrompt: '接通后告诉用户任务已完成。',
        projectHint: 'shennian',
      }),
    }))
  })
})
