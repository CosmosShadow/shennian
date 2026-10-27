// @covers open-source/packages/server/src/services/voice-chief-task-router.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreate = vi.fn()
const mockSend = vi.fn()
const mockStop = vi.fn()
const mockInspect = vi.fn()

vi.mock('../services/voice-chief-control.js', () => ({
  createProjectConversation: mockCreate,
  sendMessageToConversation: mockSend,
  stopConversation: mockStop,
  getConversationMessages: mockInspect,
}))

const project = {
  projectId: 'project-shennian',
  displayName: 'shennian',
  summary: '语音功能',
  machineId: 'machine-1',
  machineName: 'Mac',
  machineStatus: 'online' as const,
  recentProgress: ['语音任务路由优化'],
  workDir: '/repo/shennian',
  latestAgentType: 'codex' as const,
  latestModelId: 'gpt-5',
  conversations: [
    {
      conversationId: 'conversation-1',
      title: '语音路由',
      agentType: 'codex' as const,
      modelId: 'gpt-5',
      status: 'active' as const,
      runPhase: 'streaming_text' as const,
      canStop: true,
      lastActivityAt: '2026-07-25T02:00:00Z',
      lastMessagePreview: '正在优化任务路由',
      workDir: '/repo/shennian',
      machineId: 'machine-1',
      machineName: 'Mac',
      machineStatus: 'online' as const,
      agentSessionId: 'agent-1',
      systemPrompt: null,
      bodyRevision: 3,
      daemonInstallationId: 'daemon-1',
    },
    {
      conversationId: 'conversation-2',
      title: '登录检查',
      agentType: 'codex' as const,
      modelId: 'gpt-5',
      status: 'completed' as const,
      runPhase: null,
      canStop: false,
      lastActivityAt: '2026-07-25T01:00:00Z',
      lastMessagePreview: '登录检查已经完成',
      workDir: '/repo/shennian',
      machineId: 'machine-1',
      machineName: 'Mac',
      machineStatus: 'online' as const,
      agentSessionId: 'agent-2',
      systemPrompt: null,
      bodyRevision: 2,
      daemonInstallationId: 'daemon-1',
    },
  ],
}

describe('voice task router V5', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue({
      status: 'created',
      conversationId: 'conversation-new',
      conversationTitle: '新任务',
    })
    mockSend.mockResolvedValue({ status: 'delivered', conversationId: 'conversation-2' })
    mockStop.mockResolvedValue({ status: 'stopped', conversationId: 'conversation-1' })
    mockInspect.mockImplementation(async ({ conversationId }: { conversationId: string }) => ({
      status: 'ok',
      messages:
        conversationId === 'conversation-1'
          ? [
              { id: '1', role: 'user', ts: 1, text: '优化语音任务路由' },
              { id: '2', role: 'agent', ts: 2, text: '正在拆分创建和续接工具' },
            ]
          : [
              { id: '3', role: 'user', ts: 3, text: '检查登录流程' },
              { id: '4', role: 'agent', ts: 4, text: '登录检查已经完成' },
            ],
    }))
  })

  it('lists all tasks with fixed twenty-item page semantics', async () => {
    const { listProjectTasksFromVoice } = await import('../services/voice-chief-task-router.js')
    const result = await listProjectTasksFromVoice({
      userId: 'user-1',
      projects: [project],
      projectRef: 'project-shennian',
      page: 1,
    })
    expect(result).toMatchObject({ status: 'ok', page: 1, hasMore: false })
    expect(result.tasks).toEqual([
      expect.objectContaining({ title: '语音路由', state: 'working' }),
      expect.objectContaining({ title: '登录检查', state: 'completed' }),
    ])
    expect(mockInspect).not.toHaveBeenCalled()
  })

  it('reads a task by public taskRef without focus or mode state', async () => {
    const { inspectTaskFromVoice, listProjectTasksFromVoice } =
      await import('../services/voice-chief-task-router.js')
    const list = await listProjectTasksFromVoice({
      userId: 'user-1',
      projects: [project],
      projectRef: project.projectId,
    })
    const ref = list.tasks?.[1]?.taskRef ?? ''
    const result = await inspectTaskFromVoice({
      userId: 'user-1',
      projects: [project],
      taskRef: ref,
      callId: 'call-read',
    })
    expect(result).toMatchObject({ status: 'ok', action: 'read', task: { title: '登录检查' } })
    expect(mockInspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: 'conversation-2', limit: 8 }),
    )
  })

  it('creates a new task only in the explicitly referenced project', async () => {
    const { createTaskFromVoice } = await import('../services/voice-chief-task-router.js')
    const result = await createTaskFromVoice({
      userId: 'user-1',
      projects: [project],
      projectRef: project.projectId,
      instruction: '新建语音延迟基准任务。',
      chiefConversationId: 'chief-1',
      callId: 'call-1',
      operationId: 'flash-turn-3',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.projectId,
        message: '新建语音延迟基准任务。',
        operationId: 'flash-turn-3',
      }),
    )
    expect(result).toMatchObject({ action: 'created', taskRef: expect.stringMatching(/^task_/) })
  })

  it('continues and stops only the task selected by taskRef', async () => {
    const { continueTaskFromVoice, listProjectTasksFromVoice, stopTaskFromVoice } =
      await import('../services/voice-chief-task-router.js')
    const list = await listProjectTasksFromVoice({
      userId: 'user-1',
      projects: [project],
      projectRef: project.projectId,
    })
    const activeRef = list.tasks?.[0]?.taskRef ?? ''
    const completedRef = list.tasks?.[1]?.taskRef ?? ''
    await continueTaskFromVoice({
      userId: 'user-1',
      projects: [project],
      taskRef: completedRef,
      instruction: '补充最终检查。',
      chiefConversationId: 'chief-1',
      callId: 'call-2',
    })
    await stopTaskFromVoice({ userId: 'user-1', projects: [project], taskRef: activeRef })
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-2', message: '补充最终检查。' }),
    )
    expect(mockStop).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-1' }),
    )
  })

  it('does not infer a task when taskRef is missing or ambiguous', async () => {
    const { continueTaskFromVoice } = await import('../services/voice-chief-task-router.js')
    const result = await continueTaskFromVoice({
      userId: 'user-1',
      projects: [project],
      taskRef: 'missing-task',
      instruction: '继续处理。',
      chiefConversationId: 'chief-1',
      callId: 'call-3',
    })
    expect(result).toMatchObject({ status: 'failed' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('removes internal ids while retaining public refs and spoken summaries', async () => {
    const { sanitizeVoiceTaskResult } = await import('../services/voice-chief-task-router.js')
    expect(
      sanitizeVoiceTaskResult({
        status: 'created',
        projectId: 'secret-project',
        conversationId: 'secret-conversation',
        taskRef: 'task_public',
        message: '已安排',
      }),
    ).toEqual({ status: 'created', taskRef: 'task_public', spokenSummary: '已安排' })
  })
})
