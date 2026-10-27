// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/home-entry-previews.test.ts
import type { Reminder, Transcript } from '../personal-modules/types'
import { reminderDate } from '../personal-modules/scheduleModel'
import { diaryPresentation } from '../personal-workspace/diaryPresentation'
import type { DiaryEntry } from '../personal-workspace/diarySync'
import { folderName, type RemoteFolder } from '../remote-folders/model'
export type HomePreview = { text: string; at?: string }
const line = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 240)

export function scheduleHomePreview(items: Reminder[]): HomePreview | null {
  const next = items.filter(item => item.state === 'active')
    .sort((a, b) => (reminderDate(a)?.getTime() ?? Infinity) - (reminderDate(b)?.getTime() ?? Infinity))[0]
  return next ? { text: line(next.payload.content), at: reminderDate(next)?.toISOString() } : null
}
export function recordingHomePreview(item: Transcript | null): HomePreview | null {
  return item ? { text: line(item.text), at: item.startAt } : null
}
export function diaryHomePreview(entries: DiaryEntry[]): HomePreview | null {
  const latest = [...entries].sort((a, b) => (b.date ?? b.path).localeCompare(a.date ?? a.path))[0]
  if (!latest) return null
  const entry = diaryPresentation(latest)
  return { text: line(entry.summary || entry.heading || entry.date), at: entry.date || undefined }
}
export function folderHomePreview(folders: RemoteFolder[], machineName: (id: string) => string | undefined): HomePreview | null {
  const latest = folders[folders.length - 1]
  if (!latest) return null
  return { text: [machineName(latest.machineId), folderName(latest.path)].filter(Boolean).join(' · ') }
}
export function homePreviewTime(iso: string | undefined, language: string): string {
  if (!iso) return ''
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const date = new Date(dateOnly ? `${iso}T12:00:00` : iso)
  if (!Number.isFinite(date.getTime())) return ''
  const now = new Date()
  return date.toLocaleDateString(language, { month: 'numeric', day: 'numeric' }) + (!dateOnly && date.toDateString() === now.toDateString()
    ? ` ${date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })}` : '')
}
