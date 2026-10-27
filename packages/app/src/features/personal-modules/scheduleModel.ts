// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-schedule.test.ts
import { localDay, type Reminder } from './types'
export type ScheduleDisplay = {
  mode: 'todo' | 'calendar'
  range: 'all' | 'today'
}
export const defaultScheduleDisplay: ScheduleDisplay = {
  mode: 'todo',
  range: 'all',
}
export function readScheduleDisplay(raw: string | null): ScheduleDisplay {
  try {
    const value = JSON.parse(raw ?? '{}')
    return {
      mode: value.mode === 'calendar' ? 'calendar' : 'todo',
      range: value.range === 'today' ? 'today' : 'all',
    }
  } catch {
    return defaultScheduleDisplay
  }
}
export function reminderDate(item: Reminder): Date | null {
  const time =
    item.dueAt ?? (item.payload.rule?.kind === 'once' ? item.payload.rule.at : item.payload.when)
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? null : date
}
export function scheduleRows(
  items: Reminder[],
  display: ScheduleDisplay,
  selectedDay: string,
  today = localDay(),
): Reminder[] {
  return items
    .filter((item) => item.state !== 'deleted')
    .filter((item) => {
      const date = reminderDate(item)
      return display.mode === 'calendar'
        ? !!date && localDay(date) === (display.range === 'today' ? today : selectedDay)
        : display.range !== 'today' || (!!date && localDay(date) === today)
    })
    .sort(
      (a, b) =>
        Number(a.state === 'completed') - Number(b.state === 'completed') ||
        (reminderDate(a)?.getTime() ?? Infinity) - (reminderDate(b)?.getTime() ?? Infinity) ||
        a.key.localeCompare(b.key),
    )
}
export function monthCells(month: Date): (string | null)[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return [
    ...Array.from({ length: (start.getDay() + 6) % 7 }, () => null),
    ...Array.from({ length: count }, (_, day) =>
      localDay(new Date(month.getFullYear(), month.getMonth(), day + 1, 12)),
    ),
  ]
}

/** Older Agent-created rows may carry an ISO range in the title. Display it
 * as metadata without rewriting the stored content or losing the end time. */
export function schedulePresentation(
  item: Reminder,
  language: string,
  now = new Date(),
): { title: string; time: string; recurrence?: string } {
  const iso = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})`
  const range = item.payload.content.match(
    new RegExp(String.raw`\s*[（(](${iso})\s*(?:至|到|–|—|~)\s*(${iso})[）)]\s*$`),
  )
  const format = (date: Date, timeOnly = false) =>
    timeOnly
      ? date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })
      : scheduleDateLabel(date, language, now)
  if (range && item.payload.content.slice(0, range.index).trim()) {
    const start = new Date(range[1]!),
      end = new Date(range[2]!)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return {
        title: item.payload.content.slice(0, range.index).trim(),
        time: `${format(start)} – ${format(end, localDay(start) === localDay(end))}`,
      }
    }
  }
  const date = reminderDate(item)
  return {
    title: item.payload.content,
    time: `${item.state === 'active' && item.payload.rule && item.payload.rule.kind !== 'once' && date ? (language.startsWith('zh') ? '下次提醒：' : 'Next reminder: ') : ''}${date ? format(date) : item.payload.rule && item.payload.rule.kind !== 'once' ? '' : item.payload.when}`,
    ...(item.payload.rule && item.payload.rule.kind !== 'once'
      ? { recurrence: item.payload.when }
      : {}),
  }
}

/** Calendar-day arithmetic (rather than 24-hour intervals) remains stable over DST. */
export function scheduleDateLabel(date: Date, language: string, now = new Date()): string {
  const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
  const delta = dayNumber(date) - dayNumber(now)
  const zh = language.startsWith('zh')
  const relative = zh ? ['今天', '明天', '后天'] : ['Today', 'Tomorrow', 'Day after tomorrow']
  const weekStart = dayNumber(now) - ((now.getDay() + 6) % 7)
  const weekday = zh
    ? `周${'日一二三四五六'[date.getDay()]}`
    : date.toLocaleDateString(language, { weekday: 'long' })
  const label =
    delta >= 0 && delta <= 2
      ? relative[delta]
      : delta > 0 && dayNumber(date) < weekStart + 7
        ? weekday
        : delta > 0 && dayNumber(date) < weekStart + 14
          ? `${zh ? '下' : 'Next '}${weekday}`
          : date.toLocaleDateString(language, {
              ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
              month: 'short',
              day: 'numeric',
            })
  return `${label} ${date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

export type ScheduleGroup = { item: Reminder; members: Reminder[] }
/** Group only identical daily reminders, never unrelated same-title meetings.
 * Originals stay addressable for revision-safe edits; no historical data migration. */
export function groupScheduleRows(rows: Reminder[]): ScheduleGroup[] {
  const groups: ScheduleGroup[] = []
  const daily = new Map<string, ScheduleGroup>()
  for (const item of rows) {
    const rules = item.payload.rules ?? (item.payload.rule ? [item.payload.rule] : [])
    const isDaily =
      rules.length > 0 &&
      rules.every((rule) => rule.kind === 'calendar' && !rule.weekdays && !rule.monthDay)
    const key = JSON.stringify([item.payload.content, item.payload.timezone, item.state])
    const existing = isDaily ? daily.get(key) : undefined
    if (existing) existing.members.push(item)
    else {
      const group = { item, members: [item] }
      groups.push(group)
      if (isDaily) daily.set(key, group)
    }
  }
  return groups
}

export function groupRecurrence(members: Reminder[], language: string): string | undefined {
  const rules: NonNullable<Reminder['payload']['rules']> = []
  for (const item of members) {
    rules.push(...(item.payload.rules ?? (item.payload.rule ? [item.payload.rule] : [])))
  }
  if (
    !rules.length ||
    !rules.every((rule) => rule.kind === 'calendar' && !rule.weekdays && !rule.monthDay)
  )
    return undefined
  const times = [
    ...new Set(
      rules.map((rule) =>
        rule.kind === 'calendar'
          ? `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`
          : '',
      ),
    ),
  ].sort()
  return `${language.startsWith('zh') ? '每天 ' : 'Daily '}${times.join('、')}`
}

/** Filter a logical item by its next visible slot without hiding its other times. */
export function scheduleGroups(
  items: Reminder[],
  display: ScheduleDisplay,
  selectedDay: string,
  today = localDay(),
): ScheduleGroup[] {
  const result: ScheduleGroup[] = []
  for (const group of groupScheduleRows(scheduleRows(items, defaultScheduleDisplay, selectedDay, today))) {
    const visible = scheduleRows(group.members, display, selectedDay, today)
    if (visible.length) result.push({ ...group, item: visible[0]! })
  }
  return result
}
