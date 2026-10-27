// @covers packages/app/src/features/desktop-shell/DesktopWorkspaceLayout.tsx
// @covers packages/app/src/features/rooms/RoomConversationScreen.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('Desktop Room header', () => {
  it('keeps the sidebar visible and does not retain a focus-mode entry', () => {
    const shell = read('../features/desktop-shell/DesktopWorkspaceLayout.tsx')
    const conversation = read('../features/rooms/RoomConversationScreen.tsx')
    const composer = read('../features/rooms/components/RoomComposer.tsx')

    expect(shell).not.toContain('isDesktopFocusRequested')
    expect(shell).toContain('const showWorkspaceNavigation = !settingsOpen')
    expect(conversation).not.toContain('room-focus-mode-toggle')
    expect(conversation).not.toContain('useDesktopFocusMode')
    expect(conversation).toContain('<RoomDetailsButton')
    const detailsButton = read('../features/rooms/components/RoomDetailsButton.tsx')
    expect(detailsButton).toContain('<ActionIcon')
    expect(detailsButton).toContain('icon="more"')
    expect(detailsButton).toContain('testID="room-details-toggle"')
    expect(composer).toContain('testID="room-composer-more-btn"')
    expect(composer).toContain('<ComposerVoiceControl')
    expect(conversation).not.toContain('name="at-sign"')
    expect(conversation).toContain('shouldOpenMentionPicker(draft, value)')
  })
})
