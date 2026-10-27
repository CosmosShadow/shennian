// @covers open-source/packages/server/src/services/voice-chief-v5.ts

import { describe, expect, it } from 'vitest'
import {
  buildVoiceChiefV5AttentionSnapshot,
  buildVoiceChiefV5FinalResult,
  buildVoiceChiefV5WorkspaceSnapshot,
  VOICE_SHENNIAN_V5_TASK_TOOLS,
} from '../services/voice-chief-v5.js'

describe('Voice Shennian V5 model surface', () => {
  it('exposes only the five Project/Task tools in a stable order', () => {
    expect(VOICE_SHENNIAN_V5_TASK_TOOLS.map((tool) => tool.name)).toEqual([
      'list_project_tasks',
      'read_task',
      'create_task',
      'continue_task',
      'stop_task',
    ])
    expect(VOICE_SHENNIAN_V5_TASK_TOOLS[0]?.parameters).toMatchObject({
      required: ['projectRef'],
    })
    expect(VOICE_SHENNIAN_V5_TASK_TOOLS[4]?.parameters).toEqual({
      type: 'object',
      properties: { taskRef: { type: 'string', description: '目标任务引用。' } },
      required: ['taskRef'],
      additionalProperties: false,
    })
  })

  it('builds one compact snapshot with all projects and the latest twenty tasks', () => {
    const conversations = Array.from({ length: 24 }, (_, index) => ({
      conversationId: `conversation-${index}`,
      title: `任务 ${index}`,
      agentType: 'codex' as const,
      modelId: null,
      status: index === 0 ? ('completed' as const) : ('active' as const),
      runPhase: index === 0 ? null : ('thinking' as const),
      canStop: index !== 0,
      lastActivityAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
      lastMessagePreview: `任务 ${index} 的最新结论`,
      workDir: '/repo/shennian',
      machineId: 'machine-1',
      machineName: 'Mac',
      machineStatus: 'online' as const,
      agentSessionId: null,
      systemPrompt: null,
    }))
    const snapshot = buildVoiceChiefV5WorkspaceSnapshot([
      {
        projectId: 'project-1',
        displayName: '神念',
        summary: '',
        machineId: 'machine-1',
        machineName: 'Mac',
        machineStatus: 'online',
        recentProgress: [],
        workDir: '/repo/shennian',
        latestAgentType: 'codex',
        latestModelId: null,
        conversations,
      },
    ])

    expect(snapshot).toContain('project_count: 1')
    expect(snapshot).toContain('task_count: 24')
    expect(snapshot).toContain('projectRef: project-1; name: 神念')
    expect(snapshot).toContain('workDirLabel: shennian')
    expect(snapshot.match(/ {2}- taskRef:/g)).toHaveLength(20)
    expect(snapshot).toContain('title: 任务 23')
    expect(snapshot).toContain('summary: 任务 23 的最新结论')
    expect(snapshot).not.toContain('title: 任务 0')
  })

  it('returns one complete delegate receipt for Realtime', () => {
    expect(
      buildVoiceChiefV5FinalResult({
        status: 'partial',
        response: '需要你确认发布环境。',
        requiresUserResponse: true,
        activities: [{ type: 'inspect', status: 'succeeded', description: '已读取任务。' }],
        background: { running: false },
        speech: { shouldSpeak: true, priority: 'important' },
        toolCalls: ['read_task'],
      }),
    ).toEqual({
      status: 'partial',
      message: '需要你确认发布环境。',
      requiresUserResponse: true,
      backgroundRunning: false,
    })
  })

  it('builds a deterministic opening snapshot from unread and active tasks', () => {
    const baseConversation = {
      agentType: 'codex' as const,
      modelId: null,
      canStop: false,
      lastMessagePreview: '最近进展',
      workDir: '/repo/shennian',
      machineId: 'machine-1',
      machineName: 'Mac',
      machineStatus: 'online' as const,
      agentSessionId: null,
      systemPrompt: null,
    }
    const result = buildVoiceChiefV5AttentionSnapshot([
      {
        projectId: 'project-1',
        displayName: '神念',
        summary: '',
        machineId: 'machine-1',
        machineName: 'Mac',
        machineStatus: 'online',
        recentProgress: [],
        workDir: '/repo/shennian',
        latestAgentType: 'codex',
        latestModelId: null,
        conversations: [
          {
            ...baseConversation,
            conversationId: 'waiting-task',
            title: '等待发布确认',
            status: 'active',
            runPhase: 'waiting_user_input',
            isUnread: false,
            lastActivityAt: '2026-08-29T08:00:00.000Z',
          },
          {
            ...baseConversation,
            conversationId: 'completed-task',
            title: '字幕修复',
            status: 'completed',
            runPhase: null,
            isUnread: true,
            lastActivityAt: '2026-08-29T09:00:00.000Z',
          },
          {
            ...baseConversation,
            conversationId: 'old-read-task',
            title: '已经读过的旧任务',
            status: 'completed',
            runPhase: null,
            isUnread: false,
            lastActivityAt: '2026-08-29T10:00:00.000Z',
          },
        ],
      },
    ])

    expect(result.items.map((item) => item.title)).toEqual(['等待发布确认', '字幕修复'])
    expect(result.context).toContain('<attention_snapshot>')
    expect(result.context).toContain('state=waiting_user; unread=false')
    expect(result.context).toContain('title=字幕修复; state=completed; unread=true')
    expect(result.context).not.toContain('已经读过的旧任务')
  })
})
