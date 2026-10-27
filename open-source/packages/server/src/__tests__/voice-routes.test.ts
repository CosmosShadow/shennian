// @covers open-source/packages/server/src/routes/voice.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    device: {
      findUnique: vi.fn(),
    },
    nianSession: {
      findUnique: vi.fn(),
    },
    machineGrant: {
      findFirst: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { userId: 'user1', deviceId: 'dev1' }
    return null
  }),
  verifyMachineToken: vi.fn(() => null),
  signToken: vi.fn(),
  signRefreshToken: vi.fn(),
}))

import { voiceRoutes } from '../routes/voice.js'

describe('Voice routes', () => {
  let app: FastifyInstance
  const fetchMock = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env.DASHSCOPE_API_KEY = 'test-key'

    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'dev1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })

    app = Fastify()
    await app.register(voiceRoutes, { prefix: '/voice' })
    await app.ready()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await app.close()
  })

  it('accepts the authenticated private Shennian speech draft scope without a project session', async () => {
    const res = await app.inject({
      method: 'POST', url: '/voice/finalize-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: { sessionId: 'shennian:user1', transcript: '帮我找设计 AI', cleanup: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().draft).toBe('帮我找设计 AI')
    expect(mockPrisma.nianSession.findUnique).not.toHaveBeenCalled()
  })

  it('does not accept another account’s Shennian speech draft scope', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/voice/finalize-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: { sessionId: 'shennian:other-user', transcript: 'hello', cleanup: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('creates a voice draft from audio and computes intent server-side', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })
    mockPrisma.message.findMany.mockResolvedValue([
      { role: 'agent', payload: '先确认一下引用方式。' },
      { role: 'user', payload: '把兔兔下面的语音输入做掉。' },
    ])
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"transcript":"把麦克风做成常驻按钮","draft":"先做语音输入，然后把麦克风做成常驻按钮。"}',
            },
          },
        ],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/draft',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        currentDraft: '先做语音输入',
        audioBase64: 'ZmFrZS1hdWRpbw==',
        audioMimeType: 'audio/webm',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    // draft 以 currentDraft 为前缀 → 服务端判为 append
    expect(body.intent).toBe('append')
    expect(body.draft).toContain('常驻按钮')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"type":"input_audio"'),
      }),
    )
    const draftBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '')
    expect(draftBody).toContain('data:audio/webm;base64,ZmFrZS1hdWRpbw==')
    // 新 prompt：强制 JSON 模式、不再塞术语记忆清单
    expect(draftBody).toContain('"response_format":{"type":"json_object"}')
    expect(draftBody).not.toContain('用户术语记忆')
  })

  it('refines an ASR transcript without loading a personal dictionary', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"transcript":"把 Codex 的语音输入改成实时 ASR"}',
            },
          },
        ],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/refine-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        currentDraft: '先看看语音输入',
        transcript: '把科戴克斯的语音输入改成实时 asr',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.transcript).toContain('Codex')
    expect(body.draft).toBe('先看看语音输入\n把 Codex 的语音输入改成实时 ASR')

    const refineCall = fetchMock.mock.calls[0]?.[1]
    expect(refineCall?.body).not.toContain('"type":"input_audio"')
    const refineBody = String(refineCall?.body ?? '')
    // 新 prompt 只做停止后的整段语音清理；老的"忽略/更正"规则已移除
    expect(refineBody).toContain('语音文本清理器')
    expect(refineBody).not.toContain('忽略/更正')
    expect(refineBody).not.toContain('用户术语记忆')
    expect(refineBody).not.toContain('最近对话')
    expect(refineBody).not.toContain('currentDraft')
    expect(refineBody).toContain('把科戴克斯的语音输入改成实时 asr')
    expect(refineBody).toContain('"response_format":{"type":"json_object"}')
  })

  it('finalizes live ASR transcript without calling the model', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/finalize-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        currentDraft: '先看看语音输入',
        transcript: '把 codex 改成长按说话',
        cleanup: false,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.transcript).toBe('把 codex 改成长按说话')
    expect(body.draft).toBe('先看看语音输入\n把 codex 改成长按说话')
    expect(body.intent).toBe('append')
    expect(body.model).toBe('direct-transcript')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cleans up live ASR transcript on finalize by default', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"transcript":"把 Codex 改成长按说话，不要改发送逻辑。"}',
            },
          },
        ],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/finalize-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        currentDraft: '先看看语音输入',
        transcript: '把 codex 改成长按说话，不对不要改发送逻辑',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.transcript).toContain('不要改发送逻辑')
    expect(body.draft).toContain('先看看语音输入')
    expect(body.model).toBe('deepseek-v4.1-flash-1017')
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '')
    expect(requestBody).toContain('语音文本清理器')
    expect(requestBody).toContain('否定词如果表达的是用户真实要求，必须保留')
    expect(requestBody).not.toContain('最近对话')
    expect(requestBody).not.toContain('参考文档')
  })

  it('refines a final ASR segment with the lightweight text model', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"transcript":"OpenAI 的 Codex 很快"}',
            },
          },
        ],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/refine-segment',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        transcript: 'open ai 的 codex 很快',
        currentTranscript: '前一句已经确认',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      transcript: 'OpenAI 的 Codex 很快',
      model: 'deepseek-v4.1-flash-1017',
    })
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? '')).toContain('ASR 片段纠错助手')
  })

  it('does not include recent conversation in voice cleanup prompt', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"transcript":"只保留最新一轮"}',
            },
          },
        ],
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/refine-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        currentDraft: '',
        transcript: '只保留最新一轮',
      },
    })

    expect(res.statusCode).toBe(200)
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '')
    const requestJson = JSON.parse(requestBody) as { messages: Array<{ content: string }> }
    const prompt = requestJson.messages[0]?.content ?? ''
    expect(prompt).toContain('只输出 JSON：{"transcript":"..."}')
    expect(prompt).not.toContain('最近对话')
    expect(prompt).not.toContain('currentDraft')
    expect(prompt).not.toContain('参考文档')
  })

  it('falls back to the raw transcript when refine-text upstream fails', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 's1',
      machineId: 'm1',
      userId: 'user1',
      deletedAt: null,
      machine: { userId: 'user1' },
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/voice/refine-text',
      headers: { authorization: 'Bearer valid-token' },
      payload: {
        sessionId: 's1',
        currentDraft: '',
        transcript: '你好你叫什么名字',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.transcript).toBe('你好你叫什么名字')
    expect(body.draft).toBe('你好你叫什么名字')
    expect(body.intent).toBe('new')
    expect(body.model).toContain(':fallback')
  })


})
