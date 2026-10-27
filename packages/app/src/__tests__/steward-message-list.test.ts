// @covers packages/app/src/features/steward/stewardMessageRows.ts
// @covers packages/app/src/features/steward/components/StewardMessageList.tsx
// @covers packages/app/src/features/steward/components/StewardMessageRow.tsx

import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shennian/shared'
import { buildInvertedStewardMessageRows, buildStewardMessageRows } from '../features/steward/stewardMessageRows'

function msg(id: string, ts: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'agent', ts, content: `text-${id}`, ...extra }
}

describe('buildStewardMessageRows', () => {
  it('always separates the first message and any gap over five minutes', () => {
    const rows = buildStewardMessageRows([
      msg('a', 0),
      msg('b', 60_000), // 1 minute later: no separator
      msg('c', 60_000 + 6 * 60_000), // 6 minutes later: separator
    ])
    expect(rows.map((row) => row.showTimeSeparator)).toEqual([true, false, true])
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c'])
  })

  it('keeps one row per kept message — never folds several into a summary', () => {
    const rows = buildStewardMessageRows([
      msg('user-1', 0, { role: 'user' }),
      msg('approval-1', 100, { content: '', approval: { v: 1, type: 'approval_pending', title: '确认', content: '' } }),
      msg('say-1', 200, { steward: 'say' }),
    ])
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.message.id)).toBe(true)
  })

  it('starts an inverted list at the newest message without moving its time separator', () => {
    const rows = buildInvertedStewardMessageRows([
      msg('old', 0),
      msg('middle', 60_000),
      msg('new', 7 * 60_000),
    ])
    expect(rows.map((row) => row.key)).toEqual(['new', 'middle', 'old'])
    expect(rows.map((row) => row.showTimeSeparator)).toEqual([true, false, true])
  })
})

// @covers packages/app/src/features/steward/components/StewardMessageList.tsx
import type { ReactElement } from 'react'
import type { FlatListProps } from 'react-native'
import { StewardMessageList } from '../features/steward/components/StewardMessageList'
import type { StewardMessageRowItem } from '../features/steward/stewardMessageRows'

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useImperativeHandle: vi.fn(),
}))
vi.mock('react-native', () => ({
  FlatList: 'FlatList', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
}))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { bg: '#fff' } }) }))
vi.mock('../components/chat/TimeSeparator', () => ({ TimeSeparator: 'TimeSeparator' }))
vi.mock('../features/steward/components/StewardMessageRow', () => ({ StewardMessageRow: 'StewardMessageRow' }))
vi.mock('../features/steward/components/TypingIndicator', () => ({ TypingIndicator: 'TypingIndicator' }))

const messages: ChatMessage[] = [
  { id: 'old', role: 'user', ts: 1, content: 'old' },
  { id: 'new', role: 'agent', ts: 2, content: 'new', steward: 'say' },
]
const render = (ready: boolean, items = messages) => (
  StewardMessageList as unknown as {
    render: (props: unknown, ref: null) => ReactElement<FlatListProps<StewardMessageRowItem>>
  }
).render({ messages: items, stewardName: 'Steward', runPhase: 'idle', isTyping: false, ready }, null)

describe('steward initial history presentation', () => {
  it('does not mount a scroll-preserving list with a loading introduction or a previous session snapshot', () => {
    const intro: ChatMessage = { id: 'steward-intro', role: 'agent', ts: 0, content: 'Hello' }
    for (const pending of [[], [intro], messages]) {
      expect(render(false, pending).type).not.toBe('FlatList')
    }
  })

  it('mounts the first ready snapshot at the inverted origin, with the newest message first', () => {
    render(false, [])
    const list = render(true)
    expect(list.type).toBe('FlatList')
    expect(list.props.inverted).toBe(true)
    expect(Array.from(list.props.data ?? [], (row) => row.key)).toEqual(['new', 'old'])
    expect(list.props.onContentSizeChange).toBeUndefined()
    expect(list.props.maintainVisibleContentPosition?.minIndexForVisible).toBe(0)
  })

  it('keeps a ready empty conversation introduction visible', () => {
    const intro: ChatMessage = { id: 'steward-intro', role: 'agent', ts: 0, content: 'Hello' }
    expect(render(true, [intro]).props.data?.[0].key).toBe('steward-intro')
  })
})
