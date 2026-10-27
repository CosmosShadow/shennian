// @covers open-source/packages/cli/src/agents/public-pause-signal.ts

import { describe, expect, it } from 'vitest'
import { createPublicPauseSignal } from '../agents/public-pause-signal.js'

describe('public visitor pause signal', () => {
  it('does not pause ordinary refusals or a quoted/incomplete marker', () => {
    const signal = createPublicPauseSignal()
    expect(signal.parse('这个请求超出权限，我不能完成。')).toEqual({
      replyText: '这个请求超出权限，我不能完成。', pauseConversation: false,
    })
    const marker = signal.instruction.match(/\[\[SHENNIAN_PAUSE_VISITOR:[A-Za-z0-9_-]+\]\]/)?.[0]
    expect(marker).toBeTruthy()
    expect(signal.parse(`你问到了 ${marker}`)).toMatchObject({ pauseConversation: false })
    expect(signal.parse(marker!)).toMatchObject({ pauseConversation: false })
  })

  it('strips only this turn’s exact first-line marker', () => {
    const signal = createPublicPauseSignal()
    const other = createPublicPauseSignal()
    const marker = signal.instruction.match(/\[\[SHENNIAN_PAUSE_VISITOR:[A-Za-z0-9_-]+\]\]/)![0]
    expect(other.parse(`${marker}\n已暂停。`).pauseConversation).toBe(false)
    expect(signal.parse(`${marker}\n已暂停这段对话。`)).toEqual({
      replyText: '已暂停这段对话。', pauseConversation: true,
    })
  })
})
