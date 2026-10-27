// @covers src/agents/codex-user-question.ts
// @covers src/native-fusion/codex-parser.ts

import { afterEach, describe, expect, it } from 'vitest'
import { buildCodexUserQuestion } from '../agents/codex-user-question.js'
import { parseCodexRolloutChunk } from '../native-fusion/codex-parser.js'
import { cleanupNativeParserTest, writeTempFile } from './native-fusion-parser-harness.js'

const input = {
  questions: [{ title: '选择演示助手', options: ['用户产品资料问答助手', '展示已有智能体'] }],
}

describe('Codex user questions', () => {
  afterEach(cleanupNativeParserTest)

  it('exposes async title and string options instead of hiding them in a tool', () => {
    expect(
      buildCodexUserQuestion('functions.request_user_input_async', JSON.stringify(input)),
    ).toEqual({
      title: 'Codex 等待你回答',
      content: '选择演示助手\n1. 用户产品资料问答助手\n2. 展示已有智能体',
      source: 'codex',
      actionHint: expect.stringContaining('暂不支持远程回答'),
    })
  })

  it('keeps all synchronous questions, labels and descriptions visible', () => {
    expect(
      buildCodexUserQuestion('request_user_input', {
        questions: [
          { question: '选哪个？', options: [{ label: 'A', description: '说明' }] },
          { question: '什么名字？' },
        ],
      })?.content,
    ).toBe('1. 选哪个？\n1. A：说明\n\n2. 什么名字？')
  })

  it('ignores unrelated tools and tolerates malformed question arguments', () => {
    expect(buildCodexUserQuestion('command_execution', input)).toBeNull()
    expect(buildCodexUserQuestion('not_request_user_input', input)).toBeNull()
    for (const value of ['{', null, { questions: [null, 1, { options: [null] }] }]) {
      expect(buildCodexUserQuestion('requestUserInput', value)?.content).toContain('等待你回答')
    }
  })

  it('imports a visible pending card and preserves tool identity across incremental results', () => {
    const rows = [
      { type: 'session_meta', payload: { id: 'thread-question', cwd: '/tmp/question-project' } },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'functions.request_user_input_async',
          call_id: 'question-1',
          arguments: JSON.stringify(input),
        },
      },
    ].map((row) => JSON.stringify({ timestamp: '2026-10-10T10:00:00.000Z', ...row }))
    const firstBytes = rows.join('\n') + '\n'
    const file = writeTempFile(
      'rollout-question.jsonl',
      firstBytes +
        JSON.stringify({
          timestamp: '2026-10-10T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'question-1',
            output: 'answered on computer',
          },
        }) +
        '\n',
    )
    const events = parseCodexRolloutChunk(file, 0).events
    const pending = events.find((event) => JSON.parse(event.payload).type === 'approval_pending')!
    expect(JSON.parse(pending.payload)).toMatchObject({
      type: 'approval_pending',
      content: expect.stringContaining('展示已有智能体'),
    })
    expect(pending.terminal).toBe(false)
    const result = parseCodexRolloutChunk(file, Buffer.byteLength(firstBytes)).events
    expect(result).toHaveLength(1)
    expect(result[0]?.canonicalMessageKey).toBe(events[1]?.canonicalMessageKey)
    expect(result[0]?.canonicalMutation).toBe('upsert')
  })
})
