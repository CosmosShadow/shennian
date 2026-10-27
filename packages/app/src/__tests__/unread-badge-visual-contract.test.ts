// @covers src/features/unread/UnreadCountBadge.tsx
// @covers src/components/MobileRootTabBar.tsx
// @covers src/features/projects/components/MobileProjectListItem.tsx
// @covers src/features/session-list/components/MobileHomeSessionItem.tsx

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MOBILE_TABS } from '../components/mobileFeatureRegistry'

const appRoot = path.resolve(import.meta.dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8')

describe('unread badge visual contract', () => {
  it('keeps unread destinations on fixed roots instead of a configurable Features tab', () => {
    expect(DEFAULT_MOBILE_TABS).toEqual(['shennian', 'contacts', 'projects', 'settings'])
  })

  it('uses the Room sequence as the sole unread source for mirrored Agent replies', () => {
    const roomList = read('features/rooms/components/RoomListPanel.tsx')
    const roomWorkspace = read('features/rooms/RoomWorkspaceScreen.tsx')
    const badgeSync = read('lib/push-badge.ts')
    const pushNavigation = read('features/notifications/notificationNavigation.ts')

    expect(roomList).toContain('unreadCount={(entry.row.unreadCount ?? 0) > 0 ? 1 : 0}')
    expect(roomList).not.toContain('roomAgentUnreadCounts')
    expect(roomWorkspace).not.toContain('useSessionUnreadCounts')
    expect(roomWorkspace).not.toContain('<UnreadCountBadge')
    expect(badgeSync).not.toContain('roomAgentSessionIds')
    expect(pushNavigation).toContain("{ name: 'room-workspace', params: { roomId: data.roomId } }")
    expect(pushNavigation.indexOf('if (data.roomId)')).toBeLessThan(
      pushNavigation.indexOf('if (!data.sessionId)'),
    )
  })

  it('uses blue titles and an open folder to express active work without blue dots', () => {
    const projectItem = read('features/projects/components/MobileProjectListItem.tsx')
    const mobileSession = read('features/session-list/components/MobileHomeSessionItem.tsx')

    expect(projectItem).toContain("name={isRunning ? 'folder-open-outline' : 'folder-outline'}")
    expect(projectItem).toContain('? colors.brand')
    expect(projectItem).toContain('? colors.textSecondary')
    expect(projectItem).toContain(': colors.text')
    expect(mobileSession).toContain('const isRunning = summary.useActiveColor')
    expect(mobileSession).toContain('? colors.brand')
    expect(mobileSession).not.toContain('`${colors.brand}cc`')
  })

  it('removes blue activity dots while retaining blue reply text', () => {
    const project = read('features/projects/components/MobileProjectListItem.tsx')
    const mobileSession = read('features/session-list/components/MobileHomeSessionItem.tsx')
    const desktopSession = read('components/SessionItem.tsx')
    expect(project).not.toContain('project-working-dot')
    expect(mobileSession).not.toContain('ActivityPulseDot')
    expect(desktopSession).not.toContain('ActivityPulseDot')
    expect(mobileSession).toContain('summary.useActiveColor')
    expect(desktopSession).toContain('summary.useActiveColor')
  })

  it('renders a larger Apple-style count with a 99+ cap', () => {
    const badge = read('features/unread/UnreadCountBadge.tsx')
    expect(badge).toContain("count > 99 ? '99+' : String(count)")
    expect(badge).toContain('minWidth: 18')
    expect(badge).toContain("color: '#fff'")
  })
})
