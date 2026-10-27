// @covers src/services/session-title-generator.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type SessionTitleGenerateParams,
} from '@shennian/wire'

const { mockPrisma, mockBroadcast } = vi.hoisted(() => ({
  mockPrisma: {
    nianSession: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  mockBroadcast: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/sessions.js', () => ({ broadcastSessionUpdate: mockBroadcast }))

import { generateSessionTitleFromSeed } from '../services/session-title-generator.js'

const baseParams: SessionTitleGenerateParams = {
  protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
  dataEpoch: SESSION_SYNC_DATA_EPOCH,
  daemonInstallationId: 'installation-1',
  sessionId: 'session-1',
  requestId: 'request-1',
  titleSeed: '排查手机同步缺消息',
  baseTitleRevision: 1,
  eligibility: 'grace_elapsed',
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1', machineId: 'machine-1', userId: 'user-1', agentType: 'codex',
    status: 'active', createdAt: new Date('2026-09-02T00:00:00.000Z'),
    titleSource: 'first_user_fallback', titleRevision: 1, titleLockedByUser: false,
    dataEpoch: SESSION_SYNC_DATA_EPOCH, deletedAt: null,
    machine: { daemonInstallationId: 'installation-1' }, ...overrides,
  }
}

function llm(title = '手机同步缺失排查') {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: title } }] }),
  })) as unknown as typeof fetch
}

describe('ephemeral title seed generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.nianSession.findUnique.mockResolvedValue(session())
    mockPrisma.nianSession.updateMany.mockResolvedValue({ count: 1 })
  })

  it('generates from only the bounded seed and CAS writes explicit authority', async () => {
    const fetchImpl = llm()
    const result = await generateSessionTitleFromSeed('machine-1', 'user-1', baseParams, {
      apiKey: 'test-key', fetchImpl, now: new Date('2026-09-02T00:03:00.000Z'),
    })

    expect(result).toEqual({
      generated: true,
      title: '手机同步缺失排查',
      titleSource: 'shennian_generated',
      titleRevision: 2,
      titleOriginEventId: 'shennian-generated:request-1',
    })
    expect(mockPrisma.nianSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'session-1', machineId: 'machine-1', userId: 'user-1',
        titleSource: 'first_user_fallback', titleRevision: 1, titleLockedByUser: false,
      }),
      data: expect.objectContaining({
        titleSource: 'shennian_generated', titleRevision: 2, titleLockedByUser: false,
      }),
    })
    const requestBody = JSON.parse(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body))
    expect(requestBody.model).toBe('deepseek-v4.1-flash-1017')
    expect(requestBody.enable_thinking).toBe(false)
    expect(JSON.stringify(requestBody)).toContain(baseParams.titleSeed)
    expect(JSON.stringify(requestBody)).not.toContain('transcript')
    expect(mockBroadcast).toHaveBeenCalledWith('machine-1', 'user-1', expect.objectContaining({
      titleSource: 'shennian_generated', titleRevision: 2,
    }))
  })

  it('never calls the generator when a native or manual title already won', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue(session({
      titleSource: 'agent_native', titleRevision: 2,
    }))
    const fetchImpl = llm()
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', baseParams, {
      apiKey: 'test-key', fetchImpl, now: new Date('2026-09-02T00:03:00.000Z'),
    })).resolves.toEqual({ generated: false, reason: 'superseded' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(mockPrisma.nianSession.updateMany).not.toHaveBeenCalled()
  })

  it('enforces eligibility instead of trusting the daemon reason', async () => {
    const fetchImpl = llm()
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', {
      ...baseParams, eligibility: 'agent_native_unavailable',
    }, {
      apiKey: 'test-key', fetchImpl, now: new Date('2026-09-02T00:00:10.000Z'),
    })).resolves.toEqual({ generated: false, reason: 'superseded' })
    expect(fetchImpl).not.toHaveBeenCalled()

    mockPrisma.nianSession.findUnique.mockResolvedValue(session({ agentType: 'claude' }))
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', {
      ...baseParams, requestId: 'request-2', eligibility: 'agent_native_unavailable',
    }, {
      apiKey: 'test-key', fetchImpl, now: new Date('2026-09-02T00:00:10.000Z'),
    })).resolves.toMatchObject({ generated: true, titleSource: 'shennian_generated' })
  })

  it.each([
    JSON.stringify({ v: 1, type: 'tool_result', content: 'secret' }),
    '<system>secret context</system>',
    `data:image/png;base64,${'A'.repeat(120)}`,
  ])('rejects an unsafe seed without querying the session: %s', async (titleSeed) => {
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', {
      ...baseParams, titleSeed,
    }, { apiKey: 'test-key', fetchImpl: llm() })).rejects.toThrow('unsafe titleSeed')
    expect(mockPrisma.nianSession.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a title seed from a different daemon installation', async () => {
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', {
      ...baseParams,
      daemonInstallationId: 'other-installation',
    }, { apiKey: 'test-key', fetchImpl: llm() })).rejects.toMatchObject({
      rejection: { code: 'invalid_identity', retryable: false },
    })
  })

  it('keeps fallback when the generator is unavailable or the CAS loses', async () => {
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', baseParams, {
      apiKey: '', now: new Date('2026-09-02T00:03:00.000Z'),
    })).resolves.toEqual({ generated: false, reason: 'generator_unavailable' })
    mockPrisma.nianSession.updateMany.mockResolvedValue({ count: 0 })
    await expect(generateSessionTitleFromSeed('machine-1', 'user-1', {
      ...baseParams, requestId: 'request-lost-cas',
    }, {
      apiKey: 'test-key', fetchImpl: llm(), now: new Date('2026-09-02T00:03:00.000Z'),
    })).resolves.toEqual({ generated: false, reason: 'superseded' })
    expect(mockBroadcast).not.toHaveBeenCalled()
  })
})
