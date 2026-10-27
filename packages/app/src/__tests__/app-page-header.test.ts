// @covers packages/app/src/components/AppPageHeader.tsx
// @covers packages/app/src/components/ActionIcon.tsx
// @covers packages/app/src/components/ActionIconButton.tsx
// @covers packages/app/src/features/chat/screens/ChatScreen.styles.ts
// @covers packages/app/app/(main)/index.tsx
// @covers packages/app/app/(main)/agents/index.tsx
// @covers packages/app/app/(main)/spaces/index.tsx
// @covers packages/app/src/features/profile/ProfileScreen.tsx
// @covers packages/app/src/features/machines/screens/MachinesScreen.tsx
// @covers packages/app/src/features/machines/screens/MachineDetailScreen.tsx

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
}

describe('standard page header', () => {
  it('lightens navigation glyphs without shrinking their button targets', () => {
    const header = read('../components/AppPageHeader.tsx')
    const icon = read('../components/ActionIcon.tsx')

    const button = read('../components/ActionIconButton.tsx')
    expect(button).toMatch(/icon === 'add'\s*\? 'add'/)
    expect(button).toContain('<ActionIcon name={action} size={24}')
    expect(icon).toContain('strokeWidth={1.6}')
    expect(icon.match(/r=\{1\.4\}/g)).toHaveLength(3)
    expect(icon).toContain('aria-hidden')
    expect(icon).toContain('pointerEvents="none"')
    expect(header).toContain('label={label}')
    expect(header).toContain('onPress={onPress}')
  })

  it('uses regular text for both composer configuration values, keeping the size', () => {
    const styles = read('../features/chat/screens/ChatScreen.styles.ts')
    const actions = read('../features/chat/hooks/useChatComposerActions.tsx')
    const modelText = styles.match(/modelBtnText: \{([^}]+)\}/)?.[1]

    expect(modelText).toContain('fontSize: 13')
    expect(modelText).toContain("fontWeight: '400'")
    expect(actions.match(/styles\.modelBtnText/g)).toHaveLength(2)
  })

  it('shares the quieter glyphs with room headers and both composers', () => {
    for (const file of [
      '../features/rooms/components/RoomDetailsButton.tsx',
      '../features/rooms/RoomWorkspaceScreen.tsx',
      '../features/rooms/components/RoomComposer.tsx',
      '../features/chat/hooks/useChatComposerActions.tsx',
    ]) {
      expect(read(file), file).toContain('<ActionIconButton')
    }
  })

  it('is reused by the primary root, machine, and settings pages', () => {
    const standardPages = [
      '../../app/(main)/index.tsx',
      '../../app/(main)/agents/index.tsx',
      '../../app/(main)/spaces/index.tsx',
      '../features/profile/ProfileScreen.tsx',
      '../features/machines/screens/MachinesScreen.tsx',
      '../features/machines/screens/MachineDetailScreen.tsx',
    ]

    for (const page of standardPages) {
      expect(read(page), page).toContain('<AppPageHeader')
    }
  })

  it('appends one concise disconnected state to all four root tab titles', () => {
    const header = read('../components/AppPageHeader.tsx')
    const rootPages = [
      '../../app/(main)/index.tsx',
      '../../app/(main)/agents/index.tsx',
      '../../app/(main)/spaces/index.tsx',
      '../features/profile/ProfileScreen.tsx',
    ]

    expect(header).not.toContain('useAppConnectivityStatus')
    expect(read('../components/ConnectedAppPageHeader.tsx')).toContain('useAppConnectivityStatus()')
    expect(header).toContain("showsConnectivityStatus && connectivityStatus === 'disconnected'")
    expect(header).toContain("t('app_header_disconnected', { title })")
    for (const page of rootPages) {
      expect(read(page), page).toContain('showsConnectivityStatus')
      expect(read(page), page).toContain('components/ConnectedAppPageHeader')
    }
  })

  it('reuses the same back button in every specialized page header', () => {
    const specializedHeaders = [
      '../features/chat/components/ChatHeader.tsx',
      '../features/chat/screens/ChatAttachmentPreviewScreen.tsx',
      '../features/projects/screens/ProjectScreen.tsx',
      '../features/rooms/RoomConversationScreen.tsx',
      '../features/rooms/RoomWorkspaceScreen.tsx',
      '../components/chat/FileDrawer.tsx',
      '../../app/(main)/scan.tsx',
      '../features/rooms/NativeRoomInviteScreen.tsx',
    ]

    for (const page of specializedHeaders) {
      expect(read(page), page).toContain('<HeaderBackButton')
    }
  })
})
