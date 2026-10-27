// @covers src/services/agent-voice-configuration.ts

import { describe, expect, it } from 'vitest'
import {
  AgentVoiceConfigurationError,
  configureAgentDraftFromVoice,
  parseAgentVoiceConfigurationInput,
  sanitizeAgentVoiceConfigurationOutput,
} from '../services/agent-voice-configuration.js'

const draft = {
  displayName: '产品助手',
  description: '整理产品需求',
  systemPrompt: '主动总结讨论。',
}

describe('agent voice configuration', () => {
  it('validates transcript and private text field limits before calling a model', () => {
    expect(() => parseAgentVoiceConfigurationInput({ transcript: '', draft })).toThrow(
      AgentVoiceConfigurationError,
    )
    expect(() =>
      parseAgentVoiceConfigurationInput({
        transcript: '修改一下',
        draft: { ...draft, description: 'x'.repeat(1_001) },
      }),
    ).toThrow('draft.description is invalid')
  })

  it('keeps only whitelisted changed fields and rejects clearing required identity fields', () => {
    expect(
      sanitizeAgentVoiceConfigurationOutput(
        {
          patch: {
            displayName: '小策',
            description: draft.description,
            systemPrompt: '主动总结讨论。涉及开发先给方案。',
            machineId: 'invented',
          },
          summary: ' 已完成   调整 ',
        },
        draft,
      ),
    ).toEqual({
      patch: {
        displayName: '小策',
        systemPrompt: '主动总结讨论。涉及开发先给方案。',
      },
      changedFields: ['displayName', 'systemPrompt'],
      summary: '已完成 调整',
    })

    expect(() =>
      sanitizeAgentVoiceConfigurationOutput({ patch: { displayName: '' }, summary: '清空' }, draft),
    ).toThrow('displayName patch cannot be empty')
  })

  it('calls DeepSeek Flash with JSON output and returns a sanitized incremental patch', async () => {
    let requestBody: Record<string, unknown> | null = null
    const result = await configureAgentDraftFromVoice(
      { transcript: '名字改成小策，开发前先给方案', draft },
      {
        apiKey: 'test-key',
        model: 'deepseek-v4-flash-test',
        fetchImpl: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      patch: {
                        displayName: '小策',
                        systemPrompt: '主动总结讨论。涉及开发先给方案。',
                      },
                      summary: '已修改名称并增加执行边界。',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        },
      },
    )

    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-flash-test',
      enable_thinking: false,
      response_format: { type: 'json_object' },
    })
    expect(result).toEqual({
      transcript: '名字改成小策，开发前先给方案',
      patch: {
        displayName: '小策',
        systemPrompt: '主动总结讨论。涉及开发先给方案。',
      },
      changedFields: ['displayName', 'systemPrompt'],
      summary: '已修改名称并增加执行边界。',
      model: 'deepseek-v4-flash-test',
    })
  })

  it('turns upstream and malformed JSON failures into unavailable errors', async () => {
    await expect(
      configureAgentDraftFromVoice(
        { transcript: '调整', draft },
        {
          apiKey: 'test-key',
          fetchImpl: async () => new Response('bad gateway', { status: 502 }),
        },
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })

    await expect(
      configureAgentDraftFromVoice(
        { transcript: '调整', draft },
        {
          apiKey: 'test-key',
          fetchImpl: async () =>
            new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
        },
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })
})
