// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/steward-inspiration.test.ts

/** Flat product-first starters, covering every mobile feature without adding UI categories. */
export const stewardInspirationCatalog = [
  { id: 'group', icon: '👥', feature: 'rooms', guide: 'rooms' },
  { id: 'agent', icon: '🤖', feature: 'agents', guide: 'agents' },
  { id: 'computer', icon: '💻', feature: 'computers', guide: 'computers' },
  { id: 'folder_shortcut', icon: '📌', feature: 'folders', guide: 'folders' },
  { id: 'ai_schedule', icon: '⏰', feature: 'scheduledTasks', guide: 'schedules' },
  { id: 'notification', icon: '🔔', feature: 'schedules', guide: 'reminders' },
  { id: 'homework', icon: '📚', feature: 'agents', guide: 'overview' },
  { id: 'review', icon: '☀️', feature: 'diary', guide: 'diary-memory' },
  { id: 'schedule', icon: '📅', feature: 'schedules', guide: 'reminders' },
  { id: 'files', icon: '📂', feature: 'folders', guide: 'folders' },
  { id: 'memory', icon: '📝', feature: 'diary', guide: 'diary-memory' },
  { id: 'recurring', icon: '🔁', feature: 'schedules', guide: 'reminders' },
  { id: 'manage_task', icon: '⏸️', feature: 'schedules', guide: 'reminders' },
  { id: 'project', icon: '🗂️', feature: 'projects', guide: 'projects' },
  { id: 'project_chat', icon: '💬', feature: 'projects', guide: 'projects' },
  { id: 'agent_group', icon: '✨', feature: 'agents', guide: 'agents' },
  { id: 'join', icon: '🔗', feature: 'rooms', guide: 'rooms' },
  { id: 'invite', icon: '✉️', feature: 'rooms', guide: 'rooms' },
  { id: 'summary', icon: '📋', feature: 'rooms', guide: 'rooms' },
  { id: 'plaza', icon: '🧭', feature: 'plaza', guide: 'agents' },
  { id: 'contacts', icon: '👋', feature: 'contacts', guide: 'contacts' },
  { id: 'app', icon: '🛠️', feature: 'content', guide: 'local-apps' },
  { id: 'english', icon: '🔤', feature: 'english', guide: 'english' },
  { id: 'recording', icon: '🎙️', feature: 'recording', guide: 'recording' },
  { id: 'recording_review', icon: '🎧', feature: 'recording', guide: 'recording' },
  { id: 'browse_memory', icon: '🧠', feature: 'memory', guide: 'diary-memory' },
  { id: 'browse_diary', icon: '📖', feature: 'diary', guide: 'diary-memory' },
  { id: 'computer_status', icon: '🖥️', feature: 'computers', guide: 'computers' },
  { id: 'share_computer', icon: '🤝', feature: 'computers', guide: 'computers' },
  { id: 'navigation', icon: '⚙️', feature: 'settings', guide: 'navigation' },
  { id: 'document', icon: '📄', feature: 'projects', guide: 'projects' },
  { id: 'meeting', icon: '🗒️', feature: 'recording', guide: 'recording' },
  { id: 'app_tracker', icon: '✅', feature: 'content', guide: 'local-apps' },
  { id: 'app_notes', icon: '🗒️', feature: 'content', guide: 'local-apps' },
  { id: 'app_dashboard', icon: '📊', feature: 'content', guide: 'local-apps' },
  { id: 'app_fix', icon: '🔧', feature: 'content', guide: 'local-apps' },
  { id: 'app_update', icon: '🎨', feature: 'content', guide: 'local-apps' },
  { id: 'app_export', icon: '📤', feature: 'content', guide: 'local-apps' },
  { id: 'agent_share', icon: '🌐', feature: 'agents', guide: 'agents' },
  { id: 'daily_task', icon: '🌅', feature: 'rooms', guide: 'schedules' },
] as const

export const stewardInspirationIds = stewardInspirationCatalog.map(card => card.id)
export type StewardInspirationId = typeof stewardInspirationCatalog[number]['id']

export function stewardInspirationCards(t: (key: string) => string) {
  return stewardInspirationCatalog.map(card => ({
    ...card,
    title: t(`inspiration_${card.id}_title`),
    description: t(`inspiration_${card.id}_description`),
    prompt: `${t(`inspiration_${card.id}_prompt`)}\n\n${t('inspiration_guide_hint')} shennian guide ${card.guide}${t('inspiration_guide_fallback')}`,
  }))
}
