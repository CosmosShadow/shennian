// @covers src/features/chat/hooks/useChatSessionActions.ts
// @covers src/features/projects/screens/ProjectScreen.tsx
// @covers src/features/desktop-shell/DesktopMainLayout.tsx
// @covers src/features/desktop-shell/DesktopShellController.tsx
// @covers src/features/chat/screens/ChatScreen.tsx
// @covers src/storage/db.native.ts

import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('native session deletion intent', () => {
  it('sends auto from every manual single-session deletion surface', () => {
    const sources = [
      read('../features/chat/hooks/useChatSessionActions.ts'),
      read('../features/projects/screens/ProjectScreen.tsx'),
    ]
    for (const source of sources) {
      expect(source).toMatch(/accountRuntime\.deleteSession\([^)]*,\s*['"]auto['"]\)/s)
    }
    const desktopLayout = read('../features/desktop-shell/DesktopMainLayout.tsx')
    const desktopController = read('../features/desktop-shell/DesktopShellController.tsx')
    expect(desktopLayout).toContain('shell.deleteSession(id)')
    expect(desktopController).toMatch(
      /desktopAccountActions\.deleteSession\([^)]*,\s*['"]auto['"]\)/s,
    )
  })

  it('keeps Desktop chat free of renderer-owned replacement cleanup', () => {
    const screen = read('../features/chat/screens/ChatScreen.tsx')
    const nativeParticipation = read('../features/rooms/useRoomAgentParticipationActions.ts')

    expect(screen).not.toMatch(/accountRuntime\.deleteSession\([^)]*,\s*['"]none['"]\)/s)
    expect(nativeParticipation).toMatch(/accountRuntime\.deleteSession\([^)]*,\s*['"]none['"]\)/s)
  })

  it('persists the cleanup policy with an offline mobile deletion tombstone', () => {
    const database = read('../storage/db.native.ts')
    expect(database).toContain("nativeCleanupPolicy TEXT NOT NULL DEFAULT 'none'")
    expect(database).toContain('SELECT sessionId, deletedAt, state, nativeCleanupPolicy')
    expect(database).toContain("deletion.nativeCleanupPolicy ?? 'none'")
  })

  it('shows one plain destructive action without Provider choices', () => {
    const modal = read('../features/chat/components/DeleteSessionModal.tsx')
    const listItem = read('../components/SessionItem.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(modal).toContain("t('confirm_delete_session_action')")
    expect(listItem).toContain("t('confirm_delete_session_action')")
    expect(zh).toContain('删除后，此对话将从神念中永久移除，且无法恢复。')
    expect(en).toContain('This conversation will be permanently removed from Shennian')
    for (const source of [modal, listItem]) {
      expect(source).not.toMatch(/Codex|Gemini|OpenCode|Cursor|归档|archive/i)
    }
  })

  it('keeps Cursor in the supported Agent product model', () => {
    const theme = read('../../../../open-source/packages/shared/src/lib/agentTheme.ts')
    const list = read('../../../../open-source/packages/shared/src/lib/session-list.ts')
    expect(theme).toContain("cursor: 'Cursor'")
    expect(list).toContain("'cursor'")
  })
})
