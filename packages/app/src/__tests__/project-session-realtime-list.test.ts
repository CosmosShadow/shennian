// @arch docs/architecture/data-sync.md#一、SyncEngine详细设计
// @covers src/features/projects/screens/ProjectScreen.tsx
// @covers src/features/session-list/components/MobileHomeSessionItem.tsx
// @covers src/features/projects/components/MobileProjectListItem.tsx

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('project session realtime list', () => {
  it('keeps project names readable without removing status signals', () => {
    const row = fs.readFileSync(
      path.resolve(__dirname, '../features/projects/components/MobileProjectListItem.tsx'),
      'utf8',
    )
    expect(row).toContain('title: {\n    ...mobileTypography.listTitle')
    expect(row).toContain('getPinnedSurfaceColor(colors, isDark)')
    expect(row).toContain('<UnreadCountBadge count={unreadCount}')
    expect(row).toMatch(/isRunning\s*\? colors.brand/)
  })

  it('emphasizes conversation titles over readable previews without removing unread or running signals', () => {
    const row = fs.readFileSync(
      path.resolve(__dirname, '../features/session-list/components/MobileHomeSessionItem.tsx'),
      'utf8',
    )
    expect(row).toContain('sessionTitle: {\n    ...mobileTypography.listTitle')
    expect(row).toContain('sessionRow2: {\n    marginTop: 4')
    expect(row).toContain('previewText: {\n    ...mobileTypography.secondary')
    expect(row).toContain('draftLabel: {\n    ...mobileTypography.secondary')
    expect(row).toContain('<UnreadCountBadge count={unreadCount}')
    expect(row).toMatch(/isRunning\s*\? colors.brand/)
    expect(row).toContain('isRunning && !summary.isDraft ? colors.brandMuted : mutedColor')
  })

  it('lets the first rename dialog action through while the native keyboard is open', () => {
    const screen = fs.readFileSync(
      path.resolve(__dirname, '../features/projects/screens/ProjectScreen.tsx'),
      'utf8',
    )
    const nativeList = screen.slice(
      screen.lastIndexOf('<FlatList'),
      screen.indexOf('<ProjectSessionListItem'),
    )

    // The row's native Modal remains inside this list's React responder tree.
    // The default "never" captures its first button tap just to blur the input.
    // Real single-tap coverage: tests/e2e/mobile/flows/ios/project-session-rename.yaml
    expect(nativeList).toContain('keyboardShouldPersistTaps="handled"')
  })

  it('reserves list header and empty slots for explicit coordination states, not background loading notices', () => {
    const screen = fs.readFileSync(
      path.resolve(__dirname, '../features/projects/screens/ProjectScreen.tsx'),
      'utf8',
    )

    expect(screen).not.toContain('ProjectSessionPageStateNotice')
    expect(screen).toContain('ListHeaderComponent={coordinationPendingRows}')
    expect(screen).toContain('ListEmptyComponent={coordinationEmpty}')
    // Dataset behavior is covered by project-coordination.test.ts: running,
    // queued and attention filters must preserve the original task identities.
    // Internal variable names do not define whether a placeholder is rendered.
    // Removing presentation must not make revoked cached conversations accessible.
    expect(screen).toContain("projectSessionSurfaceState === 'forbidden' ? <View style={{ flex: 1 }} /> :")
    expect(screen).toContain("projectSessionSurfaceState === 'forbidden' ? (")
    expect(screen).toContain("accessibilityLabel={t('start_new_chat')}")
    expect(screen).toContain('onEndReached={handleProjectEndReached}')
  })

  it('keeps root tabs on the project list, not in a conversation, with stateful tab navigation', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8')
    const screen = read('../features/projects/screens/ProjectScreen.tsx')
    const tabs = read('../components/MobileRootTabBar.tsx')
    expect(screen).not.toContain('MobileRootTabBar')
    expect(screen).not.toContain('if (isDesktop')
    expect(screen).toContain('const listBottomInset = Math.max(20, insets.bottom + 12)')
    expect(screen).toContain('testID="project-back-unread"')
    expect(screen).toContain('onPress={goBack}')
    // The live TabRouter behavior and retained route keys are exercised by
    // mobile-root-tab-navigation.test.ts and mobile-root-tab-bar.test.ts.
    expect(tabs).toContain('mobileRootTabAction(navigation.getState(), tabKey)')
    expect(tabs).toContain('navigation.dispatch(action)')
    expect(read('../features/chat/components/ChatHeader.tsx')).not.toContain('MobileRootTabBar')
  })

  it('keeps automatic refresh out of mobile and desktop loading UI', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8')
    const screen = read('../features/projects/screens/ProjectScreen.tsx')
    const desktop = read('../features/desktop-projects/DesktopProjectWorkspace.tsx')
    const notice = read('../features/projects/components/ProjectSessionPageStateNotice.tsx')

    expect(screen).not.toContain('ListFooterComponent=')
    expect(screen).not.toContain('[projectIdentity, sessionsLoading]')
    expect(screen).toContain('[projectIdentity]')
    expect(desktop).not.toContain('ActivityIndicator')
    expect(notice).not.toContain('ActivityIndicator')
    expect(notice).not.toContain('progressbar')
    expect(notice).toContain("t('project_sessions_pending')")
    // Explicit launch/save operations still provide their own progress feedback.
    expect(screen).toContain('launchState.launching ? (')
    expect(screen).toContain('savingDefault ? (')
  })

  it('shows realtime tasks directly without a new-task banner', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../features/projects/screens/ProjectScreen.tsx'),
      'utf8',
    )

    expect(source).toContain('setPreserveVisiblePosition(!nearTop)')
    expect(source).toContain('maintainVisibleContentPosition={')
    expect(source).toContain('preserveVisiblePosition ? { minIndexForVisible: 0 } : undefined')
    expect(source).not.toContain("t('project_new_tasks')")
    expect(source).not.toContain('pendingNewTaskCount')
    expect(source).not.toContain('newTasksBanner')
  })
})
