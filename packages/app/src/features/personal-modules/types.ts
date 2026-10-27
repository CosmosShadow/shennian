// @arch docs/features/personal-modules.md
export type SpeakerSentence = { beginMs: number; endMs: number; speakerId: number | null; text: string }
export type Transcript = {
  key: string
  sessionKey: string
  revision: number
  startAt: string
  endAt: string
  text: string
  timezone: string
  day: string
  kind?: string
  speaker?: 'assistant'
  speakerStatus?: 'done' | 'unavailable'
  speakerSentences?: SpeakerSentence[]
}
export type EnglishItem = {
  word: string
  state: string
  selfUseCount: number
  repeatCount: number
  promptCount: number
  lastUsedAt: string | null
}
export type Reminder = {
  key: string
  revision: number
  state: string
  dueAt: string | null
  payload: {
    content: string
    when: string
    timezone: string
    deliveryError?: boolean
    rules?: import('@shennian/wire').ScheduleRule[]
    rule?: import('@shennian/wire').ScheduleRule | null
  }
}
export type Candidate = {
  key: string
  day?: string
  payload: { content: string; eventTime: string; timezone: string }
}
export type Prompt = { key: string; word: string; text: string; expiresAt: string }
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

export type ListeningPreferences = { mode: 'transcribe' | 'assist'; feedback: 'silent' | 'balanced' | 'active'; agentContext: boolean; trigger?: 'contextual' | 'name' }
export type ListeningAction = { key: string; day?: string; payload: { type: 'reminder_create' | 'reminder_update' | 'reminder_cancel' | 'agent_task'; content: string; sourceText: string; targetContent?: string; targetWhen?: string; eventTime: string | null; expiresAt: string } }
export const defaultListeningPreferences: ListeningPreferences = { mode: 'assist', feedback: 'balanced', agentContext: false, trigger: 'contextual' }
