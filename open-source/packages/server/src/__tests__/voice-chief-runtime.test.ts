// @covers open-source/packages/server/src/services/voice-chief-runtime.ts

import { describe, expect, it, vi } from 'vitest'
import {
  handleVoiceChiefAgentEvent,
  subscribeVoiceChiefManager,
} from '../services/voice-chief-runtime.js'

describe('voice chief manager runtime bridge', () => {
  it('buffers visible Manager text and emits only at terminal state', () => {
    const subscriber = vi.fn()
    const unsubscribe = subscribeVoiceChiefManager('manager-1', subscriber)

    handleVoiceChiefAgentEvent({ state: 'start', sessionId: 'manager-1', runId: 'run-1' })
    handleVoiceChiefAgentEvent({
      state: 'delta',
      sessionId: 'manager-1',
      runId: 'run-1',
      text: '正在',
    })
    handleVoiceChiefAgentEvent({
      state: 'delta',
      sessionId: 'manager-1',
      runId: 'run-1',
      text: '处理',
      thinking: false,
    })
    handleVoiceChiefAgentEvent({
      state: 'delta',
      sessionId: 'manager-1',
      runId: 'run-1',
      text: '内部推理',
      thinking: true,
    })
    expect(subscriber).not.toHaveBeenCalled()

    handleVoiceChiefAgentEvent({ state: 'final', sessionId: 'manager-1', runId: 'run-1' })
    expect(subscriber).toHaveBeenCalledWith({
      managerSessionId: 'manager-1',
      runId: 'run-1',
      text: '正在处理',
    })
    unsubscribe()
  })
})

it('classifies agent replies for voice prioritization and clips long details', async () => {
  const { summarizeVoiceChiefAgentEvent } = await import('../services/voice-chief-runtime.js')
  const question = summarizeVoiceChiefAgentEvent('我已经完成修改，但需要你确认是否现在部署？')
  expect(question).toMatchObject({ kind: 'question', requiresUserResponse: true })
  const resultWithoutCompletionKeyword = summarizeVoiceChiefAgentEvent(
    '已递归扫描工作目录，共发现 26 个文件夹。',
    'final',
  )
  expect(resultWithoutCompletionKeyword).toMatchObject({
    kind: 'completed',
    requiresUserResponse: false,
  })
  const long = summarizeVoiceChiefAgentEvent('扫描结果如下。' + '详细实现说明。'.repeat(300))
  expect(long.kind).toBe('completed')
  expect(long.text.length).toBeLessThanOrEqual(800)
  expect(summarizeVoiceChiefAgentEvent('连接中断', 'aborted').kind).toBe('failed')
})
