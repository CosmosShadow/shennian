// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-modules.test.ts
import { speakerMetadata } from './speaker-metadata.js'
import { nextScheduleTime, parseScheduleTime } from '../schedule-time.js'
import type { ScheduleRule } from '@shennian/wire'
export type JsonObject = Record<string, unknown>
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_object')
  return value as JsonObject
}
export function text(value: unknown, max = 191): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('invalid_text')
  return value.trim()
}
export function instant(value: unknown): string {
  const raw = text(value, 64)
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ||
    !Number.isFinite(Date.parse(raw))
  )
    throw new Error('invalid_timestamp')
  return new Date(raw).toISOString()
}
export function dayKey(value: string, zone = 'Asia/Shanghai'): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type: string) => p.find((x) => x.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function validDay(value: unknown): string {
  const raw = text(value, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw
  )
    throw new Error('invalid_day')
  return raw
}
export function transcript(input: unknown) {
  const b = object(input),
    startAt = instant(b.startAt),
    endAt = instant(b.endAt)
  if (endAt < startAt || Date.parse(endAt) - Date.parse(startAt) > 360_000)
    throw new Error('invalid_interval')
  if (!Number.isSafeInteger(b.revision) || Number(b.revision) < 1)
    throw new Error('invalid_revision')
  const timezone = typeof b.timezone === 'string' ? text(b.timezone, 100) : 'Asia/Shanghai'
  return {
    key: text(b.key),
    sessionKey: text(b.sessionKey),
    revision: Number(b.revision),
    startAt,
    endAt,
    text: text(b.text, 20000),
    timezone,
    day: dayKey(startAt, timezone),
    ...speakerMetadata(b, Date.parse(endAt) - Date.parse(startAt)),
  }
}
export function reminder(input: unknown, now = Date.now()) {
  const b = object(input),
    timezone = text(b.timezone, 100)
  // Keep `when` a string for published clients; empty means an unscheduled memo.
  // Never turn an invalid nonempty time into a memo or invent a trigger.
  new Intl.DateTimeFormat('en', { timeZone: timezone })
  const when = b.when == null || b.when === '' ? '' : text(b.when, 200)
  const content = text(b.content, 2000)
  if (!when) return { content, when, timezone, rule: null, dueAt: null }
  // Multiple daily clock times still belong to one reminder. Keep the legacy
  // rule for older readers; new workers advance over all derived rules.
  const multi = when
    .replace(/\s+/g, '')
    .match(/^(每天|daily)(\d{1,2}:\d{2}(?:[、,，]\d{1,2}:\d{2})+)$/i)
  const rules = multi
    ? [
        ...new Set(
          multi[2]!.split(/[、,，]/).map((time) =>
            time
              .split(':')
              .map((part) => part.padStart(2, '0'))
              .join(':'),
          ),
        ),
      ].map((time) => parseScheduleTime(`每天${time}`, timezone, now))
    : [parseScheduleTime(when, timezone, now)]
  if (rules.length > 24) throw new Error('invalid_reminder_time')
  rules.sort((a, b) =>
    a.kind === 'calendar' && b.kind === 'calendar'
      ? a.hour * 60 + a.minute - b.hour * 60 - b.minute
      : 0,
  )
  const rule = rules[0]!
  const dueAt = earliestReminder(rules, timezone, now)
  if (dueAt === null) throw new Error('invalid_reminder_time')
  return { content, when, timezone, rule, dueAt, ...(rules.length > 1 ? { rules } : {}) }
}
export function advanceReminder(payload: unknown, now: number): number | null {
  const p = object(payload)
  if (!p.rule) return null
  return earliestReminder(
    Array.isArray(p.rules) && p.rules.length
      ? (p.rules as ScheduleRule[])
      : [p.rule as ScheduleRule],
    String(p.timezone),
    now,
  )
}
export function englishWord(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const w = value.toLowerCase().trim().replace(/\s+/g, ' ')
  return w.length > 0 && w.length <= 100 && /^[a-z][a-z '-]*$/.test(w) ? w : null
}
export function wordInSource(word: string, source: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(source)
}

function earliestReminder(rules: ScheduleRule[], timezone: string, now: number): number | null {
  const times = rules
    .map((rule) => nextScheduleTime(rule, timezone, now))
    .filter((at): at is number => at !== null)
  return times.length ? Math.min(...times) : null
}
