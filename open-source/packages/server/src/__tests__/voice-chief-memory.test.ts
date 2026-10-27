// @covers open-source/packages/server/src/services/voice-chief-memory.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  voiceChiefMemory: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

describe('voice chief previous call context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.voiceChiefMemory.findUnique.mockResolvedValue(null)
    mockPrisma.voiceChiefMemory.upsert.mockResolvedValue({})
  })

  it('loads the latest raw call instead of the legacy rolling summary', async () => {
    mockPrisma.voiceChiefMemory.findUnique.mockResolvedValue({
      summary: '旧的长期摘要',
      pendingContext: '[用户] 继续语音优化。',
      updatedAt: new Date('2026-08-28T00:00:00Z'),
    })
    const { appendVoiceChiefPreviousCallInstructions, loadVoiceChiefPreviousCallContext } =
      await import('../services/voice-chief-memory.js')

    const snapshot = await loadVoiceChiefPreviousCallContext('user-1')
    const prompt = appendVoiceChiefPreviousCallInstructions('base prompt', snapshot)

    expect(snapshot.context).toBe('[用户] 继续语音优化。')
    expect(prompt).toContain('<previous_call_context>')
    expect(prompt).toContain('继续语音优化')
    expect(prompt).toContain('不是长期记忆')
    expect(prompt).not.toContain('旧的长期摘要')
  })

  it('reads the legacy summary once when no raw previous call exists', async () => {
    mockPrisma.voiceChiefMemory.findUnique.mockResolvedValue({
      summary: '兼容旧版本的最后摘要',
      pendingContext: '',
      updatedAt: new Date(),
    })
    const { loadVoiceChiefPreviousCallContext } = await import('../services/voice-chief-memory.js')

    await expect(loadVoiceChiefPreviousCallContext('user-1')).resolves.toMatchObject({
      context: '兼容旧版本的最后摘要',
    })
  })

  it('replaces storage with the latest raw call and never calls a model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { saveVoiceChiefPreviousCallContext } = await import('../services/voice-chief-memory.js')

    const result = await saveVoiceChiefPreviousCallContext({
      userId: 'user-1',
      context: '[用户] 下一通电话直接接着这里聊。',
    })

    expect(result.context).toContain('下一通电话直接接着这里聊')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrisma.voiceChiefMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({
          summary: '',
          pendingContext: expect.stringContaining('下一通电话直接接着这里聊'),
          compressedAt: null,
        }),
      }),
    )
  })

  it('keeps only the tail under the pathological safety limit', async () => {
    const { saveVoiceChiefPreviousCallContext, VOICE_CHIEF_PREVIOUS_CALL_CONTEXT_LIMIT_CHARS } =
      await import('../services/voice-chief-memory.js')
    const tail = '最后一句必须保留'

    const result = await saveVoiceChiefPreviousCallContext({
      userId: 'user-1',
      context: `${'旧'.repeat(VOICE_CHIEF_PREVIOUS_CALL_CONTEXT_LIMIT_CHARS + 500)}${tail}`,
    })

    expect(result.context.length).toBeLessThanOrEqual(VOICE_CHIEF_PREVIOUS_CALL_CONTEXT_LIMIT_CHARS)
    expect(result.context).toContain(tail)
  })
})
