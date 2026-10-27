// @test src/__tests__/scheduled-tasks-presentation.test.ts
// @arch docs/features/conversation-schedules.md
import type { ConversationSchedule } from '@shennian/wire'

export function scheduleEditTime(task: ConversationSchedule): string {
  if (task.rule.kind !== 'once') return task.timeDescription
  const at = task.rule.at
  // Hermes does not consistently expose longOffset; derive the offset from calendar parts.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: task.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const value = (type: string) => parts.find(part => part.type === type)!.value
  const hour = String(Number(value('hour')) % 24).padStart(2, '0')
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const time = `${hour}:${value('minute')}:${value('second')}`
  const offset = Math.round((Date.parse(`${date}T${time}Z`) - Math.floor(at / 1000) * 1000) / 60000)
  const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
  return `${date} ${time} ${zone}`
}

/** Presentation only: never truncate or rewrite the saved instructions. */
export function schedulePromptPreview(prompt: string): { title: string; excerpt: string } {
  const text = prompt.trim()
  const boundary = /[。！？\n]|[.!?](?=\s|$)/.exec(text)
  if (!boundary || boundary.index === 0) return { title: text, excerpt: '' }
  return { title: text.slice(0, boundary.index).trim(), excerpt: text.slice(boundary.index + 1).trim() }
}
