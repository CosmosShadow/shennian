// @covers open-source/packages/server/src/services/voice-chief-control.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetVoiceBodyCache } from '../services/voice-body-cache.js'

const mockListUserSessions = vi.fn()
const mockCreateSessionForUser = vi.fn()
const mockDeleteSessionForUser = vi.fn()
const mockListUserProjects = vi.fn()
const mockSendServerReqToMachine = vi.fn()
const mockRegisterCompletionNotify = vi.fn()
const mockPrisma = {
  machine: { findMany: vi.fn(), findUnique: vi.fn() },
}

function durableSendResponse(
  sessionId: string,
  clientMessageId: string,
  deliveryState: 'queued' | 'executing' = 'executing',
) {
  return {
    type: 'res', id: 'durable-send', ok: true,
    payload: {
      protocolVersion: 2,
      dataEpoch: 2,
      daemonInstallationId: 'daemon-1',
      sessionId, clientMessageId, messageId: clientMessageId, deliveryState,
      bodyRevision: 1, committedAt: '2026-09-02T00:00:00.000Z',
    },
  }
}

vi.mock('../services/sessions.js', () => ({
  listUserSessions: mockListUserSessions,
  createSessionForUser: mockCreateSessionForUser,
  deleteSessionForUser: mockDeleteSessionForUser,
}))
vi.mock('../services/projects.js', () => ({
  listUserProjects: mockListUserProjects,
  normalizeProjectWorkDir: (workDir: string) => workDir.replace(/[\\/]+$/, ''),
}))
vi.mock('../relay/server-requests.js', () => ({
  sendServerReqToMachine: mockSendServerReqToMachine,
}))
vi.mock('../services/voice-task-completion-notify.js', () => ({
  registerVoiceTaskCompletionNotify: mockRegisterCompletionNotify,
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

describe('voice shennian project conversation control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetVoiceBodyCache()
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', online: true }])
    mockPrisma.machine.findUnique.mockResolvedValue({
      online: true,
      daemonInstallationId: 'daemon-1',
    })
    mockDeleteSessionForUser.mockResolvedValue({ alreadyDeleted: false })
    mockSendServerReqToMachine.mockImplementation(async (_machineId, frame) => ({
      type: 'res',
      id: 'voice-window',
      ok: true,
      payload: {
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: frame.params.sessionId,
        callId: frame.params.callId,
        bodyRevision: 3,
        messages: [],
        truncated: false,
      },
    }))
    mockListUserSessions.mockResolvedValue([
      {
        id: 'worker-1',
        machineId: 'machine-1',
        machineName: 'Mac',
        agentType: 'codex',
        agentSessionId: 'native-1',
        modelId: 'gpt-5',
        managerDefaultWorkerAgentType: null,
        managerDefaultWorkerModelId: null,
        status: 'active',
        activity: { runPhase: 'streaming_text', canStop: true },
        workDir: '/repo/shennian',
        title: '语音功能',
        lastMessagePreview: '语音神念开发中',
        bodyRevision: 3,
        visibleMessageCount: 2,
        lastVisibleMessageId: 'a2',
        attentionCount: 2,
        lastAttentionId: 'attention-2',
        lastActivityAt: '2026-07-21T01:00:00Z',
        createdAt: '2026-07-20T01:00:00Z',
        userState: {
          userId: 'user-1',
          sessionId: 'worker-1',
          lastReadAt: '2026-07-20T12:00:00Z',
          lastReadBodyRevision: 1,
          lastReadVisibleMessageCount: 1,
          lastReadVisibleMessageId: 'a1',
          lastReadAttentionCount: 1,
          lastReadAttentionId: 'attention-1',
          manualUnread: false,
          updatedAt: '2026-07-20T12:00:00Z',
        },
        deletedAt: null,
      },
      {
        id: 'manager-1',
        machineId: 'machine-1',
        machineName: 'Mac',
        agentType: 'manager',
        agentSessionId: null,
        modelId: null,
        managerDefaultWorkerAgentType: 'codex',
        managerDefaultWorkerModelId: 'gpt-5',
        status: 'active',
        activity: null,
        workDir: '/repo/shennian',
        title: '项目 Manager',
        lastMessagePreview: '不应进入语音任务列表',
        bodyRevision: 0,
        visibleMessageCount: 0,
        lastVisibleMessageId: null,
        lastActivityAt: '2026-07-21T02:00:00Z',
        deletedAt: null,
      },
    ])
    mockListUserProjects.mockResolvedValue([
      {
        id: 'project-1',
        machineId: 'machine-1',
        machineName: 'Mac',
        machineOnline: true,
        workDir: '/repo/shennian',
        displayName: 'shennian',
        lastActivityAt: '2026-07-21T01:00:00Z',
        createdAt: '2026-07-20T01:00:00Z',
        updatedAt: '2026-07-21T01:00:00Z',
      },
    ])
  })

  it('loads all projects with recent ordinary tasks', async () => {
    const { loadVoiceChiefProjects } = await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    expect(mockListUserSessions).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: 160,
      excludeRoomBound: true,
    })
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      displayName: 'shennian',
      machineStatus: 'online',
      conversations: [expect.objectContaining({ conversationId: 'worker-1', canStop: true })],
    })
    expect(projects[0].conversations).toHaveLength(1)
    expect(projects[0].conversations[0]).toMatchObject({ isUnread: true })
    expect(mockSendServerReqToMachine).not.toHaveBeenCalled()
  })

  it('reuses the same revision window within one phone call without a second body relay', async () => {
    const { getConversationMessages } = await import('../services/voice-chief-control.js')
    const input = {
      userId: 'user-1', conversationId: 'worker-1', limit: 8, callId: 'phone-call-1',
    }

    await expect(getConversationMessages(input)).resolves.toMatchObject({ status: 'ok' })
    await expect(getConversationMessages(input)).resolves.toMatchObject({ status: 'ok' })

    expect(mockSendServerReqToMachine).toHaveBeenCalledTimes(1)
  })

  it('returns an index-only unavailable result while the origin machine is offline', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', online: false }])
    mockPrisma.machine.findUnique.mockResolvedValue({
      online: false,
      daemonInstallationId: 'daemon-1',
    })
    const { getConversationMessages } = await import('../services/voice-chief-control.js')

    await expect(getConversationMessages({
      userId: 'user-1', conversationId: 'worker-1', limit: 8, callId: 'phone-call-offline',
    })).resolves.toMatchObject({
      status: 'failed',
      conversationId: 'worker-1',
      conversationTitle: '语音功能',
      message: expect.stringContaining('离线'),
    })
    expect(mockSendServerReqToMachine).not.toHaveBeenCalled()
  })

  it('uses the Room-excluding session view for direct conversation loads', async () => {
    const { getConversationMessages } = await import('../services/voice-chief-control.js')
    await getConversationMessages({
      userId: 'user-1',
      conversationId: 'worker-1',
      limit: 4,
      callId: 'voice-test',
    })

    expect(mockListUserSessions).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: 200,
      excludeRoomBound: true,
    })
    expect(mockSendServerReqToMachine).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        method: 'voice.session.body.window',
        params: expect.objectContaining({
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-1',
          sessionId: 'worker-1',
          limit: 4,
        }),
      }),
      8_000,
    )
  })

  it('creates a normal conversation and sends the exact text command', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-new',
      userId: 'user-1',
      machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      agentType: 'codex',
      agentSessionId: null,
      modelId: 'gpt-5',
      workDir: '/repo/shennian',
      status: 'active',
      title: '',
      lastActivityAt: new Date('2026-07-21T02:00:00Z'),
    })
    mockSendServerReqToMachine.mockResolvedValue(durableSendResponse(
      'session-new', 'voice-shennian-chief-1-call-1',
    ))
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    const result = await createProjectConversation({
      userId: 'user-1',
      projects,
      projectId: projects[0].projectId,
      message: '按完整产品实现原生实时语音，不使用级联。',
      chiefConversationId: 'chief-1',
      callId: 'call-1',
    })

    expect(result).toMatchObject({ status: 'created', conversationId: 'session-new' })
    expect(mockCreateSessionForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'codex',
        creationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    expect(mockSendServerReqToMachine).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        method: 'chat.enqueue',
        params: expect.objectContaining({
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-1',
          sessionId: 'session-new',
          agentType: 'codex',
          text: '按完整产品实现原生实时语音，不使用级联。',
          queueMessageId: 'voice-shennian-chief-1-call-1',
        }),
      }),
      4_000,
    )
    expect(mockRegisterCompletionNotify).not.toHaveBeenCalled()
  })

  it('uses the explicit project default instead of the most recent conversation', async () => {
    mockListUserProjects.mockResolvedValue([
      {
        id: 'project-1',
        machineId: 'machine-1',
        machineName: 'Mac',
        machineOnline: true,
        workDir: '/repo/shennian',
        displayName: 'shennian',
        defaultAgentType: 'claude',
        defaultModelId: 'claude-opus-4-1',
        lastActivityAt: '2026-07-21T01:00:00Z',
        createdAt: '2026-07-20T01:00:00Z',
        updatedAt: '2026-07-21T01:00:00Z',
      },
    ])
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-default',
      userId: 'user-1',
      machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      machineName: 'Mac',
      agentType: 'claude',
      agentSessionId: null,
      modelId: 'claude-opus-4-1',
      workDir: '/repo/shennian',
      status: 'active',
      title: '',
      lastActivityAt: new Date('2026-07-21T02:00:00Z'),
    })
    mockSendServerReqToMachine.mockResolvedValue(durableSendResponse(
      'session-default', 'voice-shennian-chief-default-call-default',
    ))
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')

    await createProjectConversation({
      userId: 'user-1',
      projects,
      projectId: projects[0].projectId,
      message: '继续执行',
      chiefConversationId: 'chief-default',
      callId: 'call-default',
    })

    expect(mockCreateSessionForUser).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'claude', modelId: 'claude-opus-4-1' }),
    )
  })

  it('queues voice follow-up commands when an existing conversation is busy', async () => {
    mockSendServerReqToMachine.mockResolvedValue({
      type: 'res',
      id: 'res-queued',
      ok: true,
      payload: {
        ...durableSendResponse(
          'worker-1', 'voice-shennian-chief-2-call-2', 'queued',
        ).payload,
        queued: true,
        queueMessageId: 'voice-shennian-chief-2-call-2',
        queue: { sessionId: 'worker-1', busy: true, pending: [] },
      },
    })
    const { sendMessageToConversation } = await import('../services/voice-chief-control.js')
    const result = await sendMessageToConversation({
      userId: 'user-1',
      conversationId: 'worker-1',
      message: '电话挂断后继续把这个修掉。',
      chiefConversationId: 'chief-2',
      callId: 'call-2',
    })

    expect(result).toMatchObject({
      status: 'delivered',
      conversationId: 'worker-1',
      message: expect.stringContaining('待执行队列'),
    })
    expect(mockSendServerReqToMachine).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        method: 'chat.enqueue',
        params: expect.objectContaining({
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-1',
          sessionId: 'worker-1',
          text: '电话挂断后继续把这个修掉。',
          queueMessageId: 'voice-shennian-chief-2-call-2',
        }),
      }),
      4_000,
    )
  })

  it('requires upgraded durable queue methods and never falls back to direct chat.send', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-old-daemon',
      userId: 'user-1',
      machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      agentType: 'codex',
      agentSessionId: null,
      modelId: 'gpt-5',
      workDir: '/repo/shennian',
      status: 'active',
      title: '',
      lastActivityAt: new Date('2026-07-21T02:00:00Z'),
    })
    mockSendServerReqToMachine
      .mockResolvedValueOnce({
        type: 'res',
        id: 'res-1',
        ok: false,
        error: 'Unknown method: chat.enqueue',
      })
      .mockResolvedValueOnce({
        type: 'res', id: 'res-2', ok: false,
        error: 'Unknown method: session.message.status',
      })
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    const result = await createProjectConversation({
      userId: 'user-1',
      projects,
      projectId: projects[0].projectId,
      message: '只允许 durable queue。',
      chiefConversationId: 'chief-old',
      callId: 'call-old',
    })

    expect(result).toMatchObject({
      status: 'failed', conversationId: 'session-old-daemon',
      message: 'Unknown method: session.message.status',
    })
    expect(mockSendServerReqToMachine).toHaveBeenNthCalledWith(
      2,
      'machine-1',
      expect.objectContaining({
        method: 'session.message.status',
        params: expect.objectContaining({
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-1',
          sessionId: 'session-old-daemon',
          clientMessageId: 'voice-shennian-chief-old-call-old',
        }),
      }),
      4_000,
    )
    expect(mockSendServerReqToMachine.mock.calls.some(([, frame]) => frame.method === 'chat.send'))
      .toBe(false)
  })

  it('registers a completion call when the call UI is switched to phone notification', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-call-back',
      userId: 'user-1',
      machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      agentType: 'codex',
      agentSessionId: null,
      modelId: 'gpt-5',
      workDir: '/repo/shennian',
      status: 'active',
      title: '',
      lastActivityAt: new Date('2026-07-21T02:00:00Z'),
    })
    mockSendServerReqToMachine.mockResolvedValue(durableSendResponse(
      'session-call-back', 'voice-shennian-chief-1-call-1',
    ))
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    const result = await createProjectConversation({
      userId: 'user-1',
      projects,
      projectId: projects[0].projectId,
      message: '完成后提醒我。',
      chiefConversationId: 'chief-1',
      callId: 'call-1',
      completionNotifyMode: 'call',
    })

    expect(result).toMatchObject({ status: 'created', conversationId: 'session-call-back' })
    expect(mockRegisterCompletionNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-call-back',
        mode: 'call',
        projectHint: 'shennian',
        sourceConversationId: 'chief-1',
        sourceCallId: 'call-1',
      }),
    )
  })

  it('recovers a lost voice send ACK from daemon status before reporting delivery', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-slow',
      userId: 'user-1',
      machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      agentType: 'codex',
      agentSessionId: null,
      modelId: 'gpt-5',
      workDir: '/repo/shennian',
      status: 'active',
      title: '',
      lastActivityAt: new Date('2026-07-21T02:00:00Z'),
    })
    mockSendServerReqToMachine
      .mockRejectedValueOnce(new Error('Agent response timeout'))
      .mockResolvedValueOnce({
        ...durableSendResponse('session-slow', 'voice-shennian-chief-1-call-1', 'queued'),
        payload: {
          state: 'queued',
          ...durableSendResponse(
            'session-slow', 'voice-shennian-chief-1-call-1', 'queued',
          ).payload,
        },
      })
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    const result = await createProjectConversation({
      userId: 'user-1',
      projects,
      projectId: projects[0].projectId,
      message: '先去跑一下发布检查。',
      chiefConversationId: 'chief-1',
      callId: 'call-1',
    })

    expect(result).toMatchObject({
      status: 'created',
      conversationId: 'session-slow',
      message: expect.stringContaining('新建会话并发送命令'),
    })
    expect(mockSendServerReqToMachine.mock.calls.map(([, frame]) => frame.method)).toEqual([
      'chat.enqueue', 'session.message.status',
    ])
  })

  it('does not report voice delivery when both ACK and status are unavailable', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-unconfirmed', userId: 'user-1', machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      agentType: 'codex', agentSessionId: null, modelId: 'gpt-5',
      workDir: '/repo/shennian', status: 'active', title: '',
      lastActivityAt: new Date('2026-07-21T02:00:00Z'),
    })
    mockSendServerReqToMachine.mockRejectedValue(new Error('Agent response timeout'))
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    const result = await createProjectConversation({
      userId: 'user-1', projects, projectId: projects[0].projectId,
      message: '不能伪造成功。', chiefConversationId: 'chief-unconfirmed',
      callId: 'call-unconfirmed', completionNotifyMode: 'call',
    })

    expect(result).toMatchObject({
      status: 'failed', conversationId: 'session-unconfirmed',
      message: 'Agent response timeout',
    })
    expect(mockRegisterCompletionNotify).not.toHaveBeenCalled()
    expect(mockDeleteSessionForUser).not.toHaveBeenCalled()
  })

  it('reuses one creation and message identity across Flash retries in the same turn', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-idempotent', userId: 'user-1', machineId: 'machine-1',
      daemonInstallationId: 'daemon-1', agentType: 'codex', agentSessionId: null,
      modelId: 'gpt-5', workDir: '/repo/shennian', status: 'active', title: '',
      lastActivityAt: new Date('2026-09-03T06:00:00Z'),
    })
    mockSendServerReqToMachine.mockImplementation(async (_machineId, frame) =>
      durableSendResponse('session-idempotent', frame.params.clientMessageId),
    )
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')
    const input = {
      userId: 'user-1', projects, projectId: projects[0].projectId,
      message: '统计项目代码行数。', chiefConversationId: 'chief-idempotent',
      operationId: 'flash-turn-7',
    }

    await createProjectConversation({ ...input, callId: 'tool-call-1' })
    await createProjectConversation({ ...input, callId: 'tool-call-2' })

    const creationKeys = mockCreateSessionForUser.mock.calls.map(([params]) => params.creationKey)
    const messageIds = mockSendServerReqToMachine.mock.calls.map(([, frame]) =>
      frame.params.clientMessageId,
    )
    expect(new Set(creationKeys).size).toBe(1)
    expect(new Set(messageIds).size).toBe(1)
    expect(messageIds[0]).toBe('voice-shennian-chief-idempotent-flash-turn-7')
  })

  it('removes a new shell after a confirmed pre-dispatch identity rejection', async () => {
    mockCreateSessionForUser.mockResolvedValue({
      id: 'session-rejected', userId: 'user-1', machineId: 'machine-1',
      daemonInstallationId: 'daemon-1', agentType: 'codex', agentSessionId: null,
      modelId: 'gpt-5', workDir: '/repo/shennian', status: 'active', title: '',
      lastActivityAt: new Date('2026-09-03T06:00:00Z'),
    })
    mockSendServerReqToMachine.mockResolvedValue({
      type: 'res', id: 'identity-rejected', ok: false,
      error: 'personal_sync_identity_mismatch',
    })
    const { createProjectConversation, loadVoiceChiefProjects } =
      await import('../services/voice-chief-control.js')
    const projects = await loadVoiceChiefProjects('user-1')

    const result = await createProjectConversation({
      userId: 'user-1', projects, projectId: projects[0].projectId,
      message: '统计项目代码行数。', chiefConversationId: 'chief-rejected',
      callId: 'call-rejected',
    })

    expect(result).toMatchObject({ status: 'failed', message: 'personal_sync_identity_mismatch' })
    expect(mockSendServerReqToMachine).toHaveBeenCalledTimes(1)
    expect(mockDeleteSessionForUser).toHaveBeenCalledWith('session-rejected', 'user-1')
  })

  it('sends stop requests with the authoritative daemon identity', async () => {
    mockSendServerReqToMachine.mockResolvedValue({ type: 'res', id: 'abort', ok: true })
    const { stopConversation } = await import('../services/voice-chief-control.js')

    await expect(stopConversation({
      userId: 'user-1', conversationId: 'worker-1', reason: '用户要求停止',
    })).resolves.toMatchObject({ status: 'stopped' })

    expect(mockSendServerReqToMachine).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        method: 'chat.abort',
        params: expect.objectContaining({
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-1',
          sessionId: 'worker-1',
        }),
      }),
      10_000,
    )
  })

  it('filters tool and system messages when reading conversation messages', async () => {
    mockSendServerReqToMachine.mockResolvedValue({
      type: 'res',
      id: 'voice-window',
      ok: true,
      payload: {
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: 'worker-1',
        callId: 'call-read',
        bodyRevision: 3,
        messages: [
          { id: 'u1', sessionId: 'worker-1', role: 'user', ts: 1, payload: '查一下状态' },
          {
            id: 'tool1',
            sessionId: 'worker-1',
            role: 'agent',
            ts: 2,
            payload: '{"v":1,"type":"tool","name":"shell_command"}',
          },
          {
            id: 'a1',
            sessionId: 'worker-1',
            role: 'agent',
            ts: 3,
            payload: '已经定位到问题',
          },
        ],
        truncated: false,
      },
    })
    const { getConversationMessages } = await import('../services/voice-chief-control.js')
    const result = await getConversationMessages({
      userId: 'user-1',
      conversationId: 'worker-1',
      limit: 10,
      callId: 'call-read',
    })
    expect(result.status).toBe('ok')
    expect(result.messages?.map((message) => message.text)).toEqual([
      '查一下状态',
      '已经定位到问题',
    ])
  })
})
