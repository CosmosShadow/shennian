// @covers packages/app/src/features/steward/contextualSteward.ts
import { describe, expect, it } from 'vitest'
import { stewardVisibleUserText, withStewardContext } from '../features/steward/contextualSteward'

describe('steward visible user text', () => {
  const context = { page: 'personal modules', route: 'personal-modules', details: { tab: 'reminders' } }
  it.each(['明天早上8点提醒我起床。', '每天早上8点提醒我起床。', '第一行\n\n第二行  ', '🙂 **提醒我**'])('preserves the exact request: %s', text => {
    const stored = withStewardContext(text, context)
    expect(stewardVisibleUserText(stored)).toBe(text)
    expect(stored).toContain(JSON.stringify(context))
  })
  it.each(['', '普通消息\n\n保持格式', '[App page context]', '[/App page context]'])('leaves ordinary text alone: %s', text => {
    expect(stewardVisibleUserText(text)).toBe(text)
  })
  it('does not strip incomplete, malformed, quoted or non-context suffixes', () => {
    const stored = withStewardContext('提醒我', context)
    for (const content of [
      stored.slice(0, -1), stored + '\n这是正文', stored.replace(JSON.stringify(context), 'not json'),
      stored.replace(JSON.stringify(context), 'null'), stored.replace(JSON.stringify(context), '{"route":"x"}'),
      stored.replace(JSON.stringify(context), '{"page":"x","route":"x","details":[]}'),
      stored.replace(JSON.stringify(context), '{"page":"x","route":"x","details":{"x":1}}'),
    ]) expect(stewardVisibleUserText(content)).toBe(content)
  })
  it('only removes the final suffix, leaving context examples within the user request', () => {
    const request = withStewardContext('例子', context) + '\n解释上面的格式'
    expect(stewardVisibleUserText(withStewardContext(request, context))).toBe(request)
  })
})
