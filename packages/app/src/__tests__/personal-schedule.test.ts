// @covers packages/app/src/features/personal-modules/scheduleModel.ts
import { describe, expect, it, vi } from 'vitest'
import {
  defaultScheduleDisplay,
  monthCells,
  readScheduleDisplay,
  reminderDate,
  scheduleRows,
  schedulePresentation,
  scheduleDateLabel,
  groupScheduleRows,
  scheduleGroups,
  groupRecurrence,
} from '../features/personal-modules/scheduleModel'
import type { Reminder } from '../features/personal-modules/types'
const item = (key: string, day: string, state = 'active'): Reminder => ({
  key,
  revision: 1,
  state,
  dueAt: `${day}T09:00:00`,
  payload: { content: key, when: `${day}T09:00:00`, timezone: 'Asia/Shanghai' },
})
describe('personal calendar display', () => {
  it('defaults to a multi-day to-do list and recovers invalid preferences', () => {
    expect(readScheduleDisplay(null)).toEqual({ mode: 'todo', range: 'all' })
    expect(readScheduleDisplay('{')).toEqual(defaultScheduleDisplay)
    expect(readScheduleDisplay('null')).toEqual(defaultScheduleDisplay)
    expect(readScheduleDisplay('{"mode":"calendar","range":"today","completed":true}')).toEqual({
      mode: 'calendar',
      range: 'today',
    })
  })
  it('ignores legacy hide-completed preferences without losing view or range', () => {
    const display = readScheduleDisplay('{"mode":"calendar","range":"today","completed":false}')
    expect(display).toEqual({ mode: 'calendar', range: 'today' })
    expect(
      scheduleRows(
        [item('done', '2026-10-23', 'completed'), item('deleted', '2026-10-23', 'deleted')],
        display,
        '2026-10-23',
        '2026-10-23',
      ).map((row) => row.key),
    ).toEqual(['done'])
  })
  it('sorts active rows first, keeps completed items and hides only deleted items', () => {
    const rows = [
      item('tomorrow', '2026-10-24'),
      item('deleted', '2026-10-21', 'deleted'),
      item('done', '2026-10-22', 'completed'),
      item('today', '2026-10-23'),
      item('overdue', '2026-10-22'),
    ]
    expect(scheduleRows(rows, defaultScheduleDisplay, '2026-10-23').map((i) => i.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'done',
    ])
    expect(
      scheduleRows(
        rows,
        { ...defaultScheduleDisplay, range: 'today' },
        'ignored',
        '2026-10-23',
      ).map((i) => i.key),
    ).toEqual(['today'])
  })
  it('selects the chosen date in calendar mode and preserves the original date of completed one-offs', () => {
    const completed = item('done', '2026-10-22', 'completed')
    completed.dueAt = null
    completed.payload.when = '30分钟后'
    completed.payload.rule = { kind: 'once', at: new Date('2026-10-22T09:00:00').getTime() }
    expect(reminderDate(completed)?.getDate()).toBe(22)
    expect(
      scheduleRows(
        [completed, item('today', '2026-10-23')],
        { mode: 'calendar', range: 'all' },
        '2026-10-22',
      ).map((i) => i.key),
    ).toEqual(['done'])
  })
  it('moves a legacy ISO range out of the title while preserving the end time and stored data', () => {
    const row = item('meeting', '2026-10-26')
    row.payload.content = '腾讯会议（2026-10-26T11:00:00+08:00 至 2026-10-26T12:00:00+08:00）'
    const presentation = schedulePresentation(row, 'zh-CN')
    expect(presentation.title).toBe('腾讯会议')
    expect(presentation.time).toContain(' – ')
    expect(presentation.time).not.toContain('2026-10-26T')
    expect(row.payload.content).toContain('2026-10-26T')
    row.payload.content = 'Review (phase 2)'
    expect(schedulePresentation(row, 'en').title).toBe('Review (phase 2)')
  })
  it('keeps unscheduled memos in the all-days to-do list without a time or fabricated calendar day', () => {
    const memo: Reminder = {
      key: 'memo',
      revision: 1,
      state: 'active',
      dueAt: null,
      payload: { content: '充值阿里云', when: '', timezone: 'Asia/Shanghai', rule: null },
    }
    expect(reminderDate(memo)).toBeNull()
    expect(schedulePresentation(memo, 'zh-CN')).toEqual({ title: '充值阿里云', time: '' })
    expect(scheduleRows([memo], defaultScheduleDisplay, '2026-10-24')).toEqual([memo])
    expect(
      scheduleRows([memo], { ...defaultScheduleDisplay, mode: 'calendar' }, '2026-10-24'),
    ).toEqual([])
    expect(
      scheduleRows([memo], { ...defaultScheduleDisplay, range: 'today' }, '2026-10-24'),
    ).toEqual([])
  })
  it('aligns month grids to Monday, including leap February and year boundaries', () => {
    const october = monthCells(new Date(2026, 9, 1))
    expect(october.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(october.at(-1)).toBe('2026-10-31')
    expect(monthCells(new Date(2028, 1, 1)).filter(Boolean)).toHaveLength(29)
    expect(monthCells(new Date(2026, 12, 1)).filter(Boolean)[0]).toBe('2027-01-01')
  })
})

// @covers packages/app/src/features/personal-modules/createCloudReminder.ts
import {
  createCloudReminder,
  type PendingReminder,
} from '../features/personal-modules/createCloudReminder'
describe('cloud reminder creation', () => {
  it('reuses the parsed time and creation key after uncertain delivery', async () => {
    const pending: PendingReminder = {
      key: 'stable-id',
      text: 'in 30 minutes call',
      timezone: 'Asia/Shanghai',
    }
    const parsed = {
      content: 'call',
      when: '2099-01-01T09:00:00+08:00',
      timezone: pending.timezone,
    }
    const request = vi
      .fn()
      .mockResolvedValueOnce(parsed)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ key: pending.key })
    await expect(createCloudReminder(pending, request, () => true)).rejects.toThrow('network')
    await expect(createCloudReminder(pending, request, () => true)).resolves.toEqual({
      key: pending.key,
    })
    expect(request.mock.calls.map((c) => c[0])).toEqual([
      '/personal-modules/reminders/preview',
      '/personal-modules/reminders/stable-id',
      '/personal-modules/reminders/stable-id',
    ])
    expect(request.mock.calls[1][1].body).toBe(request.mock.calls[2][1].body)
  })
  it('creates an unscheduled cloud memo using the same preview and stable ID flow', async () => {
    const pending: PendingReminder = { key: 'memo', text: '充值阿里云', timezone: 'Asia/Shanghai' }
    const request = vi
      .fn()
      .mockResolvedValueOnce({ content: '充值阿里云', when: '', timezone: pending.timezone })
      .mockResolvedValueOnce({ key: 'memo' })
    await expect(createCloudReminder(pending, request, () => true)).resolves.toEqual({
      key: 'memo',
    })
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({
      content: '充值阿里云',
      when: '',
      timezone: pending.timezone,
    })
  })
  it('does not write after parsing fails or the account changes', async () => {
    const pending: PendingReminder = { key: 'id', text: 'call', timezone: 'Asia/Shanghai' }
    const request = vi.fn().mockRejectedValueOnce(new Error('need_time')).mockResolvedValueOnce({})
    await expect(createCloudReminder(pending, request, () => true)).rejects.toThrow('need_time')
    await expect(createCloudReminder(pending, request, () => false)).rejects.toThrow(
      'account_changed',
    )
    expect(request.mock.calls.every((c) => c[0].endsWith('/preview'))).toBe(true)
  })
})

describe('one item with multiple daily reminders', () => {
  const daily = (key: string, hour: number): Reminder => ({
    ...item(key, '2026-10-25'),
    dueAt: new Date(2026, 9, 25, hour).toISOString(),
    payload: { content: '吃药', timezone: 'Asia/Shanghai', when: `每天${hour}:00`, rule: { kind: 'calendar', hour, minute: 0 } },
  })
  it('groups historical daily rows at the earliest occurrence without altering source data', () => {
    const source = [daily('evening', 18), daily('morning', 9), daily('noon', 12)]
    const snapshot = JSON.stringify(source)
    const groups = groupScheduleRows(scheduleRows(source, defaultScheduleDisplay, '2026-10-25'))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.item.key).toBe('morning')
    expect(groups[0]!.members).toHaveLength(3)
    expect(groupRecurrence(groups[0]!.members, 'zh')).toBe('每天 09:00、12:00、18:00')
    expect(groupRecurrence(groups[0]!.members, 'en')).toBe('Daily 09:00、12:00、18:00')
    expect(schedulePresentation(groups[0]!.item, 'zh', new Date(2026, 9, 25)).time).toBe('下次提醒：今天 09:00')
    expect(JSON.stringify(source)).toBe(snapshot)
  })
  it('retains all daily slots when today/calendar filtering hides another slot until tomorrow', () => {
    const morning = daily('morning', 9)
    morning.dueAt = new Date(2026, 9, 26, 9).toISOString()
    const noon = daily('noon', 12)
    for (const mode of ['todo', 'calendar'] as const) {
      const groups = scheduleGroups([morning, noon], { mode, range: 'today' }, '2026-10-25', '2026-10-25')
      expect(groups).toHaveLength(1)
      expect(groups[0]!.members).toHaveLength(2)
      expect(groups[0]!.item.key).toBe('noon')
      expect(groupRecurrence(groups[0]!.members, 'zh')).toBe('每天 09:00、12:00')
    }
  })
  it('does not merge one-offs, different titles, zones, states or weekly rules', () => {
    const first = daily('first', 9)
    const variants: Reminder[] = [
      item('one-off', '2026-10-25'),
      { ...daily('title', 12), payload: { ...first.payload, content: '另一种药' } },
      { ...daily('zone', 12), payload: { ...first.payload, timezone: 'UTC' } },
      { ...daily('completed', 12), state: 'completed' },
      { ...daily('weekly', 12), payload: { ...first.payload, rule: { kind: 'calendar', hour: 9, minute: 0, weekdays: [1] } } },
    ]
    expect(groupScheduleRows([first, ...variants])).toHaveLength(6)
  })
  it('summarizes a persisted multi-time reminder in one row and keeps all slots', () => {
    const row = daily('multi', 9)
    row.payload.rules = [row.payload.rule!, { kind: 'calendar', hour: 12, minute: 30 }, { kind: 'calendar', hour: 18, minute: 30 }]
    expect(groupScheduleRows([row])).toHaveLength(1)
    expect(groupRecurrence([row], 'zh')).toBe('每天 09:00、12:30、18:30')
  })
  it('uses actual Monday-based weeks, relative days, and explicit years outside the current year', () => {
    const now = new Date(2026, 9, 21, 23, 59) // Wednesday
    const label = (day: number) => scheduleDateLabel(new Date(2026, 9, day, 9), 'zh-CN', now)
    expect(label(21)).toBe('今天 09:00')
    expect(label(22)).toBe('明天 09:00')
    expect(label(23)).toBe('后天 09:00')
    expect(label(24)).toBe('周六 09:00')
    expect(label(26)).toBe('下周一 09:00')
    expect(label(27)).toBe('下周二 09:00')
    expect(label(28)).toBe('下周三 09:00')
    expect(label(19)).toContain('10月19日')
    expect(label(31)).toBe('下周六 09:00')
    expect(scheduleDateLabel(new Date(2027, 0, 15, 9), 'zh-CN', now)).toContain('2027')
    expect(scheduleDateLabel(new Date(2026, 9, 22, 9), 'en', now)).toBe('Tomorrow 09:00')
    expect(scheduleDateLabel(new Date(2027, 0, 1, 9), 'zh', new Date(2026, 11, 31))).toBe('明天 09:00')
  })
})
