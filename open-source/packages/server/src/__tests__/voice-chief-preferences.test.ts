// @covers open-source/packages/server/src/services/voice-chief-preferences.ts
// @covers open-source/packages/server/src/routes/voice-chief-incoming.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const { mockPrisma, mockEnqueueIncomingCall } = vi.hoisted(() => ({
  mockPrisma: {
    device: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockEnqueueIncomingCall: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { userId: 'user-1', deviceId: 'device-1' }
    return null
  }),
}))
vi.mock('../services/voice-incoming-call-intent.js', () => ({
  enqueueVoiceIncomingCallIntent: mockEnqueueIncomingCall,
}))

describe('voice chief preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.VOICE_CHIEF_VOICE
    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'device-1',
      userId: 'user-1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockEnqueueIncomingCall.mockResolvedValue({ callId: 'call-queued', status: 'queued' })
  })

  it('persists an incoming-call intent and returns before external push delivery', async () => {
    const { voiceChiefIncomingRoutes } = await import('../routes/voice-chief-incoming.js')
    const app = Fastify()
    await app.register(voiceChiefIncomingRoutes, { prefix: '/voice-chief' })
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/voice-chief/incoming-calls',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        reason: '任务完成',
        initialPrompt: '先报告结果',
        projectHint: 'shennian',
        targetPlatform: 'ios',
      },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ callId: 'call-queued', status: 'queued' })
    expect(mockEnqueueIncomingCall).toHaveBeenCalledWith({
      userId: 'user-1',
      reason: '任务完成',
      initialPrompt: '先报告结果',
      projectHint: 'shennian',
      targetPlatform: 'ios',
    })
    await app.close()
  })

  it('returns the saved AI phone voice and visible choices', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: '李辰',
      voiceChiefVoice: 'longanlufeng',
    })
    const { voiceChiefIncomingRoutes } = await import('../routes/voice-chief-incoming.js')
    const app = Fastify()
    await app.register(voiceChiefIncomingRoutes, { prefix: '/voice-chief' })
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/voice-chief/preferences',
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { voiceChiefVoice: true },
    })
    expect(res.json()).toMatchObject({
      voice: 'longanlufeng',
      options: expect.arrayContaining([
        { id: 'longanqian', labelKey: 'voice_chief_voice_warm_female' },
        { id: 'longanlingxin', labelKey: 'voice_chief_voice_clear_female', default: true },
        { id: 'longanlufeng', labelKey: 'voice_chief_voice_steady_male' },
      ]),
    })
    await app.close()
  })

  it('updates the selected AI phone voice and rejects unsupported voices', async () => {
    mockPrisma.user.update.mockResolvedValue({ voiceChiefVoice: 'longanxiaoxin' })
    const { voiceChiefIncomingRoutes } = await import('../routes/voice-chief-incoming.js')
    const app = Fastify()
    await app.register(voiceChiefIncomingRoutes, { prefix: '/voice-chief' })
    await app.ready()

    const ok = await app.inject({
      method: 'PATCH',
      url: '/voice-chief/preferences',
      headers: { authorization: 'Bearer valid-token' },
      payload: { voice: 'longanxiaoxin' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ voice: 'longanxiaoxin' })
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: { voiceChiefVoice: 'longanxiaoxin' },
    }))

    const bad = await app.inject({
      method: 'PATCH',
      url: '/voice-chief/preferences',
      headers: { authorization: 'Bearer valid-token' },
      payload: { voice: 'not-a-voice' },
    })
    expect(bad.statusCode).toBe(400)
    await app.close()
  })

  it('uses clear female as the built-in default voice', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: '',
      voiceChiefVoice: null,
    })
    const { getVoiceChiefPreferences, loadVoiceChiefUserPreferences } = await import('../services/voice-chief-preferences.js')

    await expect(loadVoiceChiefUserPreferences('user-1')).resolves.toMatchObject({
      voice: 'longanlingxin',
    })
    await expect(getVoiceChiefPreferences('user-1')).resolves.toMatchObject({
      voice: 'longanlingxin',
      options: expect.arrayContaining([
        { id: 'longanlingxin', labelKey: 'voice_chief_voice_clear_female', default: true },
      ]),
    })
  })

  it('falls back to the server default voice when the user has not chosen one', async () => {
    process.env.VOICE_CHIEF_VOICE = 'longanlingxin'
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: '',
      voiceChiefVoice: null,
    })
    const { loadVoiceChiefUserPreferences } = await import('../services/voice-chief-preferences.js')

    await expect(loadVoiceChiefUserPreferences('user-1')).resolves.toMatchObject({
      voice: 'longanlingxin',
    })
  })
})
