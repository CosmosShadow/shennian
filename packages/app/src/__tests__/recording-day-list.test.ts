// @vitest-environment happy-dom
// @covers src/features/personal-modules/RecordingDayList.tsx
// @covers src/features/personal-modules/recordingNavigation.ts
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transcript } from '../features/personal-modules/types'
const state = vi.hoisted(() => ({
  account: 'alice',
  vibrate: vi.fn(),
  api: vi.fn(),
  local: vi.fn(),
  cache: vi.fn(),
  deleted: vi.fn(),
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Vibration: { vibrate: state.vibrate },
  View: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress, testID }: any) =>
    React.createElement('button', { onClick: onPress, 'data-testid': testID }, children),
}))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign((select: any) => select({ user: { id: state.account } }), {
    getState: () => ({ user: { id: state.account } }),
  }),
}))
vi.mock('../config/api', () => ({ authApi: state.api }))
vi.mock('../features/personal-modules/runtime', () => ({
  moduleStore: async () => ({
    transcripts: state.local,
    cached: state.cache,
    isDayDeleted: state.deleted,
  }),
}))
import { recordingDestination } from '../features/personal-modules/recordingNavigation'
import { RecordingDayList, recordingExcerpt } from '../features/personal-modules/RecordingDayList'
const row = (key: string, day: string, text: string, revision = 1): Transcript => ({
  key,
  day,
  text,
  revision,
  sessionKey: 'unit',
  startAt: `${day}T10:00:00+08:00`,
  endAt: `${day}T10:01:00+08:00`,
  timezone: 'Asia/Shanghai',
  kind: 'transcript',
})
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  state.account = 'alice'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  state.local.mockResolvedValue([])
  state.cache.mockResolvedValue([])
  state.deleted.mockResolvedValue(false)
  state.api.mockResolvedValue({ items: [] })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node)
    await Promise.resolve()
  })
}
describe('daily recording presentation', () => {
  it('uses native pushes with an explicit selected day, not an in-place settings dashboard', () => {
    expect(recordingDestination('day', '2026-10-23')).toEqual({
      pathname: '/(main)/personal-modules',
      params: {
        tab: 'recording',
        recordingView: 'day',
        recordingDay: '2026-10-23',
        __mobileEntry: 'push',
      },
    })
    expect(recordingDestination('settings', '2026-10-23').params.recordingView).toBe('settings')
  })
  it('uses actual latest revisions without duplicating text or mixing days', () => {
    expect(
      recordingExcerpt(
        [
          row('a', '2026-10-23', '旧句'),
          row('a', '2026-10-23', '修订后的句子', 2),
          row('b', '2026-10-22', '其他日期'),
        ],
        '2026-10-23',
      ),
    ).toBe('修订后的句子')
    expect(recordingExcerpt([], '2026-10-23')).toBe('')
  })
  it('shows today and cached history as date rows and opens only the chosen day', async () => {
    const openDay = vi.fn()
    state.cache.mockResolvedValue([row('old', '2026-10-22', '昨天真正保存的记录')])
    await render(
      React.createElement(RecordingDayList, {
        days: ['2026-10-23', '2026-10-22'],
        knownDay: '2026-10-23',
        transcripts: [row('today', '2026-10-23', '今天刚保存的原话')],
        openDay,
      }),
    )
    expect(host.textContent).toContain('今天刚保存的原话')
    expect(host.textContent).toContain('昨天真正保存的记录')
    expect(state.vibrate).not.toHaveBeenCalled()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="recording-day-2026-10-22"]')!.click(),
    )
    expect(state.vibrate).not.toHaveBeenCalled()
    expect(openDay).toHaveBeenCalledWith('2026-10-22')
    expect(state.api).toHaveBeenCalledExactlyOnceWith('/personal-modules/recording/days/2026-10-22')
  })
  it('drops late excerpts from another account', async () => {
    let resolve!: (value: { items: Transcript[] }) => void
    state.api.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const props = {
      days: ['2026-10-22'],
      knownDay: '2026-10-23',
      transcripts: [],
      openDay: vi.fn(),
    }
    await render(React.createElement(RecordingDayList, props))
    state.account = 'bob'
    await render(React.createElement(RecordingDayList, props))
    await act(async () => resolve({ items: [row('a', '2026-10-22', '不得显示的前一账号原文')] }))
    expect(host.textContent).not.toContain('不得显示的前一账号原文')
  })
})

it('updates live recognition in the top date card without duplicating its saved revision', async () => {
  const day = '2026-10-23', openDay = vi.fn()
  const props = { days: [day], knownDay: day, active: true, openDay }
  await render(React.createElement(RecordingDayList, {
    ...props,
    transcripts: [row('previous', day, '上一句。'), row('live', day, '今天')],
    live: { key: 'live', text: '今天去公园' },
  }))
  expect(host.textContent).toContain('上一句。')
  expect(host.textContent!.match(/今天/g)).toHaveLength(1)
  expect(host.textContent).toContain('今天去公园')
  expect(host.textContent).toContain('personal_recording_active')
  await render(React.createElement(RecordingDayList, {
    ...props,
    transcripts: [row('previous', day, '上一句。'), row('live', day, '今天去公园。', 2)],
    live: { key: 'live', text: '今天去公园。' },
  }))
  expect(host.textContent!.match(/今天去公园。/g)).toHaveLength(1)
  await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="recording-day-${day}"]`)!.click())
  expect(openDay).toHaveBeenCalledWith(day)
  await render(React.createElement(RecordingDayList, {
    ...props, active: false,
    transcripts: [row('live', day, '今天去公园。')],
    live: { key: 'live', text: '停止后不得残留的中间结果' },
  }))
  expect(host.textContent).not.toContain('停止后不得残留的中间结果')
  expect(host.textContent).toContain('今天去公园。')
})
