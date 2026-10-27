// @covers open-source/packages/server/src/services/voice-chief-flash.ts

import { describe, expect, it, vi } from 'vitest'
import {
  buildVoiceChiefFlashInstructions,
  buildVoiceChiefRealtimeFlashInstructions,
  containsUnverifiedMutationClaim,
  DELEGATE_TOOL,
  parseVoiceChiefDelegateArguments,
  VoiceChiefFlashCoordinator,
} from '../services/voice-chief-flash.js'

function jsonResponse(message: Record<string, unknown>) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('voice chief Flash coordinator V5', () => {
  it('describes only the Project/Task delegation model', () => {
    const realtime = buildVoiceChiefRealtimeFlashInstructions('')
    const flash = buildVoiceChiefFlashInstructions('')
    expect(realtime).toContain('delegate')
    expect(realtime).toContain('<opening>')
    expect(realtime).toContain('主动做工作简报')
    expect(realtime).not.toContain('user_context')
    expect(realtime).not.toContain('昵称')
    expect(flash).toContain('你的业务对象是 Project 和 Task')
    expect(flash).toContain('<execution>')
    expect(flash).toContain('<answer_strategy>')
    expect(flash).toContain('REALTIME_INTENT')
    expect(flash).toContain('已有证据足够时直接形成答复')
    expect(flash).toContain('需要项目 Agent 产生新结果时创建或继续任务')
    expect(flash).toContain('已有任务的结论查询使用 read_task')
    expect(DELEGATE_TOOL.parameters.required).toEqual(['intent'])
    expect(realtime).not.toContain('handoff_to_flash')
    expect(realtime).not.toContain('有什么需要我帮忙')
    expect(realtime).toContain('用第一人称简短说明你正在做什么')
    expect(realtime).toContain('不要解释内部执行方式')
    expect(realtime).not.toContain('说明正在后台处理')
    expect(flash).toContain('我还在处理，完成后告诉你')
    expect(flash).not.toContain('准确说明后台是否仍在执行')
    expect(flash).not.toContain('要我现在安排吗')
  })

  it('recognizes mutation success claims that require a successful tool call', () => {
    expect(containsUnverifiedMutationClaim('好的，已安排任务让 Agent 扫描目录。')).toBe(true)
    expect(containsUnverifiedMutationClaim('Agent 正在扫描学习项目。')).toBe(true)
    expect(containsUnverifiedMutationClaim('要我现在安排吗？')).toBe(false)
    expect(containsUnverifiedMutationClaim('学习项目有一个已完成任务。')).toBe(false)
  })

  it('normalizes semantic delegate arguments from Realtime', () => {
    expect(
      parseVoiceChiefDelegateArguments(JSON.stringify({ intent: '  查看 CLI 和 Skill 任务  ' })),
    ).toEqual({ intent: '查看 CLI 和 Skill 任务' })
    expect(parseVoiceChiefDelegateArguments('{broken')).toEqual({ intent: '' })
  })

  it('keeps the fixed workspace snapshot before the continuous history', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ content: '已经确认。' }))
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: '稳定角色',
      workspaceSnapshot: '<workspace_snapshot>固定项目</workspace_snapshot>',
      tools: [],
      executeTool: vi.fn(),
      fetchImpl,
    })
    coordinator.appendPhoneTranscript('user', '看看语音任务。', 'input:1')
    coordinator.appendPhoneTranscript('user', '看看语音任务。', 'input:1')

    await coordinator.handleUserTurn('看看语音任务。', { inputAlreadySynced: true })

    const request = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(request.messages[0].content).toBe(
      '稳定角色\n\n<workspace_snapshot>固定项目</workspace_snapshot>',
    )
    expect(request.messages.filter((item: any) => item.role === 'user')).toHaveLength(1)
  })

  it('adds Realtime intent after the synced phone transcript', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ content: 'CLI 任务正在进行。' }))
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: '稳定角色',
      workspaceSnapshot: '<workspace_snapshot>学习项目：CLI 功能与 Skill 支持</workspace_snapshot>',
      tools: [],
      executeTool: vi.fn(),
      fetchImpl,
    })
    coordinator.appendPhoneTranscript('user', '看一下 client 和 scale。', 'input:1')

    await coordinator.handleUserTurn('看一下 client 和 scale。', {
      inputAlreadySynced: true,
      realtimeIntent: '查看学习项目中 CLI 功能与 Skill 支持任务的进展',
    })

    const request = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(request.messages.at(-1).content).toBe(
      '[REALTIME_INTENT] 查看学习项目中 CLI 功能与 Skill 支持任务的进展',
    )
    expect(request.messages.map((item: any) => item.content)).toContain('看一下 client 和 scale。')
  })

  it('keeps multiple tool results private and returns one final response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          tool_calls: [
            {
              id: 'list-1',
              type: 'function',
              function: { name: 'list_project_tasks', arguments: '{"projectRef":"p1"}' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          tool_calls: [
            {
              id: 'read-1',
              type: 'function',
              function: { name: 'read_task', arguments: '{"taskRef":"t1"}' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ content: '语音任务正在执行。' }))
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok', spokenSummary: '已找到项目任务。' })
      .mockResolvedValueOnce({ status: 'ok', spokenSummary: '已读取语音任务进展。' })
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: 'flash prompt',
      tools: [
        { name: 'list_project_tasks', parameters: { type: 'object' } },
        { name: 'read_task', parameters: { type: 'object' } },
      ],
      executeTool,
      fetchImpl,
    })

    const outcome = await coordinator.handleUserTurn('语音任务怎么样？')

    expect(outcome.toolCalls).toEqual(['list_project_tasks', 'read_task'])
    expect(outcome.response).toBe('语音任务正在执行。')
    expect(executeTool.mock.calls[0]?.[0].operationId).toMatch(/^flash-turn-/)
    expect(executeTool.mock.calls[1]?.[0].operationId).toBe(
      executeTool.mock.calls[0]?.[0].operationId,
    )
    const finalRequest = JSON.parse(fetchImpl.mock.calls[2][1].body as string)
    expect(finalRequest.messages.filter((item: any) => item.role === 'tool')).toHaveLength(2)
    expect(JSON.stringify(finalRequest.messages)).toContain('已找到项目任务。')
    expect(JSON.stringify(finalRequest.messages)).toContain('已读取语音任务进展。')
  })

  it('recovers an unverified arranged claim by requiring the real create tool', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: '好的，已安排 Agent 扫描目录。' }))
      .mockResolvedValueOnce(
        jsonResponse({
          tool_calls: [
            {
              id: 'create-recovery',
              type: 'function',
              function: {
                name: 'create_task',
                arguments: '{"projectRef":"learning","instruction":"扫描目录结构"}',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ content: '已在学习项目新建任务并发送。' }))
    const executeTool = vi.fn().mockResolvedValue({
      status: 'created',
      action: 'created',
      spokenSummary: '已在学习项目新建任务并发送。',
    })
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: 'flash prompt',
      tools: [{ name: 'create_task', parameters: { type: 'object' } }],
      executeTool,
      fetchImpl,
    })

    const outcome = await coordinator.handleUserTurn('安排。', {
      realtimeIntent: '确认新建任务，让 Agent 扫描学习项目目录结构。',
    })

    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'create_task', operationId: expect.any(String) }),
    )
    const recoveryRequest = JSON.parse(fetchImpl.mock.calls[1][1].body as string)
    expect(recoveryRequest.tool_choice).toBe('required')
    expect(outcome.toolCalls).toEqual(['create_task'])
    expect(outcome.background.running).toBe(true)
    expect(outcome.response).toBe('已在学习项目新建任务并发送。')
  })

  it('reports failure instead of accepting a repeated unverified arranged claim', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: '已经安排了。' }))
      .mockResolvedValueOnce(jsonResponse({ content: 'Agent 正在执行。' }))
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: 'flash prompt',
      tools: [{ name: 'create_task', parameters: { type: 'object' } }],
      executeTool: vi.fn(),
      fetchImpl,
    })

    const outcome = await coordinator.handleUserTurn('安排。')

    expect(outcome.status).toBe('failed')
    expect(outcome.response).toContain('还没有实际创建成功')
    expect(outcome.toolCalls).toEqual([])
  })

  it('does not accept or automatically repeat a failed mutation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          tool_calls: [
            {
              id: 'create-failed',
              type: 'function',
              function: {
                name: 'create_task',
                arguments: '{"projectRef":"learning","instruction":"扫描目录结构"}',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ content: '好的，任务已经安排。' }))
    const executeTool = vi.fn().mockResolvedValue({
      status: 'failed',
      message: '机器暂时不可用。',
    })
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: 'flash prompt',
      tools: [{ name: 'create_task', parameters: { type: 'object' } }],
      executeTool,
      fetchImpl,
    })

    const outcome = await coordinator.handleUserTurn('安排。')

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe('failed')
    expect(outcome.response).toContain('没有实际执行成功')
  })

  it('pauses the loop when a tool result requires the user to answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        tool_calls: [
          {
            id: 'read-question',
            type: 'function',
            function: { name: 'read_task', arguments: '{"taskRef":"t1"}' },
          },
        ],
      }),
    )
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: 'flash prompt',
      tools: [{ name: 'read_task', parameters: { type: 'object' } }],
      executeTool: vi.fn().mockResolvedValue({
        status: 'ok',
        needsUserResponse: true,
        spokenSummary: '任务正在等待你确认发布。',
      }),
      fetchImpl,
    })

    const outcome = await coordinator.handleUserTurn('继续看一下。')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe('partial')
    expect(outcome.requiresUserResponse).toBe(true)
    expect(outcome.response).toBe('任务正在等待你确认发布。')
  })

  it('suppresses a late final response after interruption', async () => {
    let resolveTool: ((value: unknown) => void) | undefined
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        tool_calls: [
          {
            id: 'slow-tool',
            type: 'function',
            function: { name: 'read_task', arguments: '{"taskRef":"t1"}' },
          },
        ],
      }),
    )
    const coordinator = new VoiceChiefFlashCoordinator({
      apiKey: 'test-key',
      instructions: 'flash prompt',
      tools: [{ name: 'read_task', parameters: { type: 'object' } }],
      executeTool: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveTool = resolve
          }),
      ),
      fetchImpl,
    })
    const running = coordinator.handleUserTurn('查一下任务。')
    await vi.waitFor(() => expect(resolveTool).toBeTypeOf('function'))
    coordinator.interrupt()
    resolveTool?.({ status: 'ok', spokenSummary: '这条已经过期。' })

    const outcome = await running
    expect(outcome.status).toBe('interrupted')
    expect(outcome.response).toBeUndefined()
  })
})
