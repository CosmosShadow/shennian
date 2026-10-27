// @covers open-source/packages/server/src/routes/voice-chief-ws-helpers.ts

import { describe, expect, it } from 'vitest'
import {
  appendIncomingCallInstructions,
  buildVoiceChiefCallOpeningUserText,
  buildVoiceChiefCurrentDatetimeContext,
} from '../routes/voice-chief-ws-helpers.js'

describe('voice chief opening context', () => {
  it('opens with a proactive brief without injecting a user nickname', () => {
    const opening = buildVoiceChiefCallOpeningUserText(
      { type: 'start' },
      {
        previousCallContext: '上次用户让 Agent 扫描学习项目目录。',
        attentionSnapshot: '<attention_snapshot>目录扫描已有结果。</attention_snapshot>',
      },
    )

    expect(opening).not.toContain('<user_context>')
    expect(opening).not.toContain('李晨')
    expect(opening).toContain('<previous_call_context>')
    expect(opening).toContain('<attention_snapshot>')
    expect(opening).toContain('主动做工作简报')
    expect(opening).not.toContain('想安排什么')
    expect(opening).not.toContain('继续上次的事情')
  })

  it('uses a short greeting when there is no work context', () => {
    const opening = buildVoiceChiefCallOpeningUserText(
      { type: 'start', timeZone: 'Asia/Shanghai' },
      {
        currentDatetimeContext: buildVoiceChiefCurrentDatetimeContext(
          'Asia/Shanghai',
          new Date('2026-09-03T10:31:00.000Z'),
        ),
      },
    )

    expect(opening).toContain('一句自然、简短的问候')
    expect(opening).toContain('自然停下来')
    expect(opening).toContain('当前时间：2026-09-03 18:31:00')
    expect(opening).toContain('时区：Asia/Shanghai')
  })

  it('falls back to the domestic time zone and keeps time on reconnect', () => {
    const currentDatetimeContext = buildVoiceChiefCurrentDatetimeContext(
      'invalid/time-zone',
      new Date('2026-09-03T10:31:00.000Z'),
    )
    const opening = buildVoiceChiefCallOpeningUserText(
      { type: 'start', reconnectAttempt: 1 },
      { currentDatetimeContext },
    )

    expect(currentDatetimeContext).toContain('当前时间：2026-09-03 18:31:00')
    expect(currentDatetimeContext).toContain('时区：Asia/Shanghai')
    expect(opening).toContain('网络断线后已重新接通')
    expect(opening.endsWith('</current_datetime>')).toBe(true)
  })

  it('keeps incoming call facts in the opening context instead of the system prompt', () => {
    const frame = {
      type: 'start' as const,
      incomingCallId: 'private-call-id',
      reason: '任务完成',
      initialPrompt: '汇报最新结果',
    }
    const instructions = appendIncomingCallInstructions('SYSTEM', frame)
    const opening = buildVoiceChiefCallOpeningUserText(frame)

    expect(instructions).toContain('<incoming_call>')
    expect(instructions).not.toContain('private-call-id')
    expect(instructions).not.toContain('任务完成')
    expect(opening).toContain('<incoming_call_context>')
    expect(opening).toContain('来电事项：任务完成')
    expect(opening).toContain('处理目标：汇报最新结果')
    expect(opening).not.toContain('private-call-id')
  })
})
