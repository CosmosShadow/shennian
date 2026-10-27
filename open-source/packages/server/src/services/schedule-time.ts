// @arch open-source/docs/server-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import type { ScheduleRule } from '@shennian/wire'

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(zone: string) {
  let value = formatters.get(zone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    if (formatters.size > 100) formatters.clear()
    formatters.set(zone, value)
  }
  return value
}
function parts(at: number, zone: string) {
  return Object.fromEntries(formatter(zone).formatToParts(at).map(p => [p.type, p.value]))
}
function localTime(year: number, month: number, day: number, hour: number, minute: number, zone: string): number | null {
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  const offsets = new Set<number>()
  for (const shift of [-36, 0, 36]) {
    const probe = desired + shift * 3600000
    const p = parts(probe, zone)
    offsets.add(Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - probe)
  }
  const matches = [...offsets].map(offset => desired - offset).filter(at => {
    const p = parts(at, zone)
    return +p.year! === year && +p.month! === month && +p.day! === day && +p.hour! === hour && +p.minute! === minute
  })
  return matches.length ? Math.min(...matches) : null
}
export function nextScheduleTime(rule: ScheduleRule, zone: string, after: number): number | null {
  formatter(zone)
  if (rule.kind === 'once') return rule.at > after ? rule.at : null
  if (rule.kind === 'interval') return rule.anchor + Math.max(0, Math.floor((after - rule.anchor) / rule.everyMs) + 1) * rule.everyMs
  const p = parts(after, zone)
  for (let i = 0; i < 370; i++) {
    const day = new Date(Date.UTC(+p.year!, +p.month! - 1, +p.day! + i))
    if (rule.weekdays && !rule.weekdays.includes(day.getUTCDay())) continue
    if (rule.monthDay && day.getUTCDate() !== rule.monthDay) continue
    const at = localTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), rule.hour, rule.minute, zone)
    if (at !== null && at > after) return at
  }
  return null
}

export function parseScheduleTime(description: string, timezone: string, now: number): ScheduleRule {
  formatter(timezone)
  const text = description.trim().toLowerCase().replace(/\s+/g, '')
  const duration = text.match(/^(?:(每隔?|every)|(?:in))?(\d+(?:\.\d+)?)(分钟|小时|天|minutes?|hours?|days?)(后)?$/)
  if (duration) {
    const unit = duration[3]!
    const ms = Number(duration[2]) * (/分钟|minute/.test(unit) ? 60000 : /小时|hour/.test(unit) ? 3600000 : 86400000)
    if (!Number.isSafeInteger(ms) || ms < 60000 || ms > 366 * 86400000) throw new Error('schedule_interval_out_of_range')
    return duration[1] ? { kind: 'interval', anchor: now + ms, everyMs: ms } : { kind: 'once', at: now + ms }
  }
  const calendar = text.match(/^(每天|工作日|每周[日天一二三四五六]|每月\d{1,2}[日号]|daily|weekdays)(早上|上午|下午|晚上)?(\d{1,2})(?::(\d{2})|点(?:(\d{1,2})分?)?)$/)
  if (calendar) {
    let hour = +calendar[3]!
    const minute = +(calendar[4] ?? calendar[5] ?? 0)
    if (/下午|晚上/.test(calendar[2] ?? '') && hour < 12) hour += 12
    if (hour > 23 || minute > 59) throw new Error('schedule_time_invalid')
    const prefix = calendar[1]!
    const monthDay = prefix.startsWith('每月') ? Number(prefix.match(/\d+/)![0]) : undefined
    if (monthDay !== undefined && (monthDay < 1 || monthDay > 31)) throw new Error('schedule_date_invalid')
    const weekdays = prefix === '工作日' || prefix === 'weekdays' ? [1, 2, 3, 4, 5] : prefix.startsWith('每周') ? ['日一二三四五六'.indexOf(prefix.slice(2).replace('天', '日'))] : undefined
    return { kind: 'calendar', hour, minute, ...(weekdays ? { weekdays } : {}), ...(monthDay ? { monthDay } : {}) }
  }
  const relative = text.match(/^(今天|明天|后天)(早上|上午|下午|晚上)?(\d{1,2})(?::(\d{2})|点(?:(\d{1,2})分?)?)$/)
  if (relative) {
    const p = parts(now, timezone)
    const date = new Date(Date.UTC(+p.year!, +p.month! - 1, +p.day! + ['今天', '明天', '后天'].indexOf(relative[1]!)))
    let hour = +relative[3]!
    if (/下午|晚上/.test(relative[2] ?? '') && hour < 12) hour += 12
    const at = localTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, +(relative[4] ?? relative[5] ?? 0), timezone)
    if (at === null || at <= now) throw new Error('schedule_date_invalid')
    return { kind: 'once', at }
  }
  // Explicit ISO instants are useful for AI-normalized dates without an ambiguous locale.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(z|[+-]\d{2}:\d{2})$/.test(text)) {
    const [year, month, day] = text.slice(0, 10).split('-').map(Number) as [number, number, number]
    const calendarDate = new Date(Date.UTC(year, month - 1, day))
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() + 1 !== month || calendarDate.getUTCDate() !== day) throw new Error('schedule_date_invalid')
    const at = Date.parse(text)
    if (Number.isFinite(at) && at > now) return { kind: 'once', at }
  }
  throw new Error('schedule_time_unsupported: use 每天09:00, 每周一09:00, 每月1日09:00, 每隔24小时, 30分钟后, 明天15:00 or an ISO timestamp')
}
