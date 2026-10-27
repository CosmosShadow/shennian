// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/inspiration-sections.test.ts
import { stewardInspirationCards, type StewardInspirationId } from './stewardInspiration'

/** Ordered anchors, not filters: every card occurs exactly once in the continuous document. */
export const inspirationSections = [
  {
    id: 'getting_started',
    cards: [
      'computer',
      'group',
      'agent',
      'folder_shortcut',
      'agent_group',
      'join',
      'invite',
      'plaza',
      'contacts',
      'computer_status',
      'share_computer',
      'navigation',
      'agent_share',
    ],
  },
  {
    id: 'work',
    cards: [
      'ai_schedule',
      'notification',
      'schedule',
      'recurring',
      'manage_task',
      'project',
      'project_chat',
      'files',
      'summary',
      'document',
      'daily_task',
    ],
  },
  {
    id: 'apps',
    cards: [
      'app',
      'app_tracker',
      'app_notes',
      'app_dashboard',
      'app_fix',
      'app_update',
      'app_export',
    ],
  },
  {
    id: 'learning',
    cards: [
      'homework',
      'review',
      'memory',
      'english',
      'recording',
      'recording_review',
      'browse_memory',
      'browse_diary',
      'meeting',
    ],
  },
] as const satisfies readonly { id: string; cards: readonly StewardInspirationId[] }[]

export function inspirationSectionCards(t: (key: string) => string) {
  const cards = stewardInspirationCards(t)
  return inspirationSections.map((section) => ({
    id: section.id,
    title: t(`inspiration_section_${section.id}`),
    cards: section.cards.map((id) => cards.find((card) => card.id === id)!),
  }))
}

export function inspirationSectionTarget(sectionY: number, stickyHeight: number): number {
  return Math.max(0, sectionY - stickyHeight)
}

/** Real measured layout, including translated/dynamic text. Last section wins at the bottom. */
export function inspirationSectionAtScroll(
  anchors: readonly number[],
  offset: number,
  stickyHeight: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  if (!anchors.length) return 0
  if (
    viewportHeight > 0 &&
    contentHeight > viewportHeight + 2 &&
    offset >= contentHeight - viewportHeight - 2
  )
    return anchors.length - 1
  let active = 0
  anchors.forEach((y, index) => {
    if (Number.isFinite(y) && offset + stickyHeight + 2 >= y) active = index
  })
  return active
}
