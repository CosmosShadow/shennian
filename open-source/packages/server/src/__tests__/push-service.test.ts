// @covers open-source/packages/server/src/services/push.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  devicePushRegistrationUpsertMock,
  devicePushRegistrationDeleteManyMock,
  devicePushRegistrationFindManyMock,
  deviceUpdateMock,
  deviceFindManyMock,
  requestLogCreateMock,
} = vi.hoisted(() => ({
  devicePushRegistrationUpsertMock: vi.fn(),
  devicePushRegistrationDeleteManyMock: vi.fn(),
  devicePushRegistrationFindManyMock: vi.fn(),
  deviceUpdateMock: vi.fn(),
  deviceFindManyMock: vi.fn(),
  requestLogCreateMock: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    devicePushRegistration: {
      upsert: devicePushRegistrationUpsertMock,
      deleteMany: devicePushRegistrationDeleteManyMock,
      findMany: devicePushRegistrationFindManyMock,
    },
    device: {
      update: deviceUpdateMock,
      findMany: deviceFindManyMock,
    },
    requestLog: {
      create: requestLogCreateMock,
    },
  },
}))

import { registerPushToken, sendPushNotification, unregisterPushToken } from '../services/push.js'

describe('push service compatibility fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SERVER_DB_LOG_ENABLED', '1')
    devicePushRegistrationFindManyMock.mockResolvedValue([])
    deviceFindManyMock.mockResolvedValue([])
    deviceUpdateMock.mockResolvedValue({})
    requestLogCreateMock.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ status: 'ok' }] }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not query recipients, register tokens or contact providers with push disabled', async () => {
    vi.stubEnv('SHENNIAN_PUSH_MODE', 'off')
    await registerPushToken({ userId: 'u1', deviceId: 'd1', provider: 'expo', platform: 'ios', pushToken: 'unit-token' })
    await sendPushNotification('u1', 'title', 'body')
    expect(devicePushRegistrationUpsertMock).not.toHaveBeenCalled()
    expect(deviceUpdateMock).not.toHaveBeenCalled()
    expect(deviceFindManyMock).not.toHaveBeenCalled()
    expect(devicePushRegistrationFindManyMock).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    await expect(sendPushNotification('u1', 'title', 'body', {}, { requireDelivery: true })).rejects.toThrow('push_disabled')
  })

  it('falls back to the legacy device.pushToken field when the registration table is missing', async () => {
    devicePushRegistrationUpsertMock.mockRejectedValue({
      code: 'P2021',
      meta: { modelName: 'DevicePushRegistration' },
    })

    await registerPushToken({
      userId: 'u1',
      deviceId: 'd1',
      provider: 'expo',
      platform: 'ios',
      pushToken: 'ExponentPushToken[test]',
    })

    expect(deviceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { pushToken: 'ExponentPushToken[test]' },
    })
  })

  it('clears the legacy device.pushToken field even when the registration table is missing', async () => {
    devicePushRegistrationDeleteManyMock.mockRejectedValue({
      code: 'P2021',
      meta: { modelName: 'DevicePushRegistration' },
    })

    await unregisterPushToken({
      deviceId: 'd1',
      provider: 'expo',
    })

    expect(deviceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { pushToken: null },
    })
  })

  it('stores APNs VoIP tokens only in provider registrations', async () => {
    await registerPushToken({
      userId: 'u1',
      deviceId: 'd1',
      provider: 'apns-voip',
      platform: 'ios',
      pushToken: 'voip-token',
    })

    expect(devicePushRegistrationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: 'apns-voip', token: 'voip-token' }),
        update: expect.objectContaining({ token: 'voip-token' }),
      }),
    )
    expect(deviceUpdateMock).not.toHaveBeenCalled()
  })

  it('sends task completion pushes only to mobile registrations when requested', async () => {
    devicePushRegistrationFindManyMock.mockResolvedValue([
      {
        deviceId: 'ios-device',
        platform: 'ios',
        provider: 'expo',
        token: 'ExponentPushToken[ios]',
      },
      {
        deviceId: 'web-device',
        platform: 'web',
        provider: 'web',
        token: '{"endpoint":"https://example.com"}',
      },
    ])

    await sendPushNotification(
      'u1',
      '任务标题',
      '最终消息摘要',
      { sessionId: 's1', runId: 'r1', recipientUserId: 'wrong-caller-recipient' },
      { audience: 'mobile', traceId: 'trace-1', badge: 3 },
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"badge":3'),
      }),
    )
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(payload.data).toEqual({ sessionId: 's1', runId: 'r1', recipientUserId: 'u1' })
    expect(requestLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'trace-1',
          path: 'push.send',
        }),
      }),
    )
  })

  it('deduplicates mobile registrations that share the same provider token', async () => {
    devicePushRegistrationFindManyMock.mockResolvedValue([
      {
        deviceId: 'old-ios-device',
        platform: 'ios',
        provider: 'expo',
        token: 'ExponentPushToken[same]',
        device: { lastActiveAt: new Date('2026-05-06T07:39:54.598Z') },
      },
      {
        deviceId: 'new-ios-device',
        platform: 'ios',
        provider: 'expo',
        token: 'ExponentPushToken[same]',
        device: { lastActiveAt: new Date('2026-05-07T04:44:06.887Z') },
      },
    ])

    await sendPushNotification(
      'u1',
      '任务标题',
      '最终消息摘要',
      { sessionId: 's1', runId: 'r1' },
      { audience: 'mobile', traceId: 'trace-dup', badge: 3 },
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(requestLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'trace-dup',
          path: 'push.send',
          metadata: expect.objectContaining({
            targetCount: 1,
            targets: [
              {
                deviceId: 'new-ios-device',
                provider: 'expo',
                platform: 'ios',
              },
            ],
          }),
        }),
      }),
    )
  })
})
