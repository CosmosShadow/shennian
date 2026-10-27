// @arch docs/design/foundations.md#移动端存量界面第一轮收敛
// @covers src/theme/mobileTypography.ts
// @covers src/features/profile/styles.ts
// @covers src/features/rooms/components/RoomInfoPanel.tsx
// @covers src/features/rooms/components/RoomMyAgentsPanel.tsx
// @covers src/features/rooms/components/RoomCreateModal.tsx
// @covers src/features/rooms/components/RoomAgentParticipation.tsx
// @covers src/features/rooms/components/RoomAgentWorkSettingsSheet.tsx
// @covers src/features/machines/styles.ts
// @covers src/components/chat/FileDrawer.styles.ts
// @covers src/components/SessionItem.tsx
// @covers src/components/DirBrowser.tsx
// @covers app/(main)/agents/[agentId]/index.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mobileTypography } from '../theme/mobileTypography'

const platform = vi.hoisted(() => ({ OS: 'ios' }))
vi.mock('react-native', () => ({
  Platform: {
    get OS() { return platform.OS },
    select: (values: Record<string, unknown>) => values[platform.OS] ?? values.default,
  },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}))

describe('mobile text hierarchy without a layout redesign', () => {
  it('defines readable title, body, preview and metadata roles without disabling system scaling', () => {
    expect(mobileTypography.navigationTitle).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '600' })
    expect(mobileTypography.body).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '400' })
    expect(mobileTypography.listTitle).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '600' })
    expect(mobileTypography.compactAction).toEqual({ fontSize: 15, lineHeight: 20, fontWeight: '600' })
    expect(mobileTypography.secondary).toEqual({ fontSize: 15, lineHeight: 20, fontWeight: '400' })
    expect(mobileTypography.metadata).toEqual({ fontSize: 13, lineHeight: 18, fontWeight: '400' })
    for (const style of Object.values(mobileTypography)) {
      expect(style.lineHeight).toBeGreaterThan(style.fontSize)
      expect(style).not.toHaveProperty('fontFamily')
      expect(style).not.toHaveProperty('allowFontScaling')
      expect(style).not.toHaveProperty('maxFontSizeMultiplier')
    }
  })

  it.each(['ios', 'android', 'web'])('resolves settings styles for %s, keeping desktop density', async (os) => {
    platform.OS = os
    vi.resetModules()
    const { styles } = await import('../features/profile/styles')
    if (os === 'web') {
      expect(styles.rowLabel.fontSize).toBe(16)
      expect(styles.rowValue.fontSize).toBe(15)
      expect(styles.rowValue).not.toHaveProperty('maxWidth')
    } else {
      expect(styles.rowLabel).toMatchObject(mobileTypography.body)
      expect(styles.rowValue).toMatchObject(mobileTypography.body)
      expect(styles.rowValue.flexShrink).toBe(1)
      expect(styles.rowValue.maxWidth).toBe('55%')
      expect(styles.rowSummary).toMatchObject(mobileTypography.secondary)
      expect(styles.deviceTime).toMatchObject(mobileTypography.metadata)
      expect(styles.revokeText).toMatchObject(mobileTypography.compactAction)
      expect(styles.revokeBtn.minHeight).toBe(os === 'android' ? 48 : 44)
      expect(styles.currentText).toMatchObject(mobileTypography.metadata)
      expect(styles.versionButtonText).toMatchObject(mobileTypography.compactAction)
      expect(styles.versionButton.minHeight).toBe(os === 'android' ? 48 : 44)
      expect(styles.accountActionText).toMatchObject(mobileTypography.compactAction)
      expect(styles.accountCancelText).toMatchObject(mobileTypography.compactAction)
      expect(styles.accountDangerText).toMatchObject(mobileTypography.compactAction)
    }
    expect(styles.row.minHeight).toBe(56)
    expect(styles.row).not.toHaveProperty('height')
    expect(styles.settingsGroup.borderRadius).toBe(16)
  })

  it.each(['ios', 'android', 'web'])('keeps repeated project creation actions below machine identity on %s', async (os) => {
    platform.OS = os
    vi.resetModules()
    const { machineStyles } = await import('../features/machines/styles')
    if (os === 'web') {
      expect(machineStyles.cardName.fontSize).toBe(15)
      expect(machineStyles.launchBtnText.fontSize).toBe(13)
    } else {
      expect(machineStyles.cardName).toMatchObject(mobileTypography.listTitle)
      expect(machineStyles.launchBtnText).toMatchObject(mobileTypography.compactAction)
      expect(machineStyles.controlValue).toMatchObject(mobileTypography.secondary)
      expect(machineStyles.launchBtnText.fontSize).toBeLessThan(machineStyles.cardName.fontSize)
      expect(machineStyles.machineName.flexGrow).toBe(1)
      expect(machineStyles.machineNamePressable.flex).toBe(1)
    }
  })

  it.each(['ios', 'android', 'web'])('keeps the room creation dialog aligned with each platform on %s', async (os) => {
    platform.OS = os
    vi.resetModules()
    const source = readFileSync(resolve(__dirname, '../features/rooms/components/RoomCreateModal.tsx'), 'utf8')
    expect(source).toContain('mobileTypography.navigationTitle')
    expect(source).toContain('mobileTypography.body')
    expect(source.match(/mobileTypography\.compactAction/g)).toHaveLength(2)
  })

  it.each(['ios', 'android', 'web'])('keeps file navigation readable without changing desktop density on %s', async (os) => {
    platform.OS = os
    vi.resetModules()
    const { styles } = await import('../components/chat/FileDrawer.styles')
    if (os === 'web') {
      expect(styles.headerTitle.fontSize).toBe(13)
      expect(styles.entryName.fontSize).toBe(13)
      expect(styles.entryNameDir.fontWeight).toBe('600')
    } else {
      expect(styles.headerTitle).toMatchObject(mobileTypography.navigationTitle)
      expect(styles.pathText).toMatchObject(mobileTypography.metadata)
      expect(styles.entryName).toMatchObject(mobileTypography.secondary)
      expect(styles.entryNameDir.fontWeight).toBe('400')
      expect(styles.navText).toMatchObject(mobileTypography.secondary)
    }
  })

  it('distinguishes a room setting value from counts and participation, allowing long values to wrap', () => {
    const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')
    const info = read('features/rooms/components/RoomInfoPanel.tsx')
    const agents = read('features/rooms/components/RoomMyAgentsPanel.tsx')
    const status = read('features/rooms/components/RoomAgentStatusLabel.tsx')
    expect(info).toContain("valueRole = 'body'")
    expect(info.match(/valueRole="secondary"/g)).toHaveLength(2)
    expect(info).toContain("label={t('spaces_browser_session')}")
    expect(info).not.toContain("'spaces_browser_session_inactive'")
    expect(info).toContain('mobileTypography[valueRole]')
    expect(status).toContain('mobileTypography.secondary')
    expect(agents).toContain('onPress={onOpenSettings}')
    const participation = read('features/rooms/components/RoomAgentParticipation.tsx')
    expect(participation).toContain('mobileTypography.sectionTitle')
    expect(participation).toContain('mobileTypography.body')
    expect(participation).toContain('mobileTypography.secondary')
    const workSettings = read('features/rooms/components/RoomAgentWorkSettingsSheet.tsx')
    expect(workSettings).toContain('mobileTypography.listTitle')
    expect(workSettings).toContain('mobileTypography.body')
    const roomList = read('features/rooms/components/RoomListPanel.tsx')
    expect(roomList).toContain("minHeight: Platform.OS === 'web' ? 42 : Platform.OS === 'android' ? 48 : 44")
    expect(roomList).toContain('mobileTypography.compactAction')
    const roomAdmin = read('features/rooms/components/RoomAdminPanel.tsx')
    expect(roomAdmin).toContain('mobileTypography.body')
    expect(roomAdmin).toContain('mobileTypography.secondary')
    const memberProfile = read('features/rooms/components/RoomMemberProfileSheet.tsx')
    expect(memberProfile).toContain('mobileTypography.listTitle')
    expect(memberProfile).toContain('mobileTypography.metadata')
    const mentionPicker = read('features/rooms/components/RoomMentionPicker.tsx')
    expect(mentionPicker).toContain('mobileTypography.navigationTitle')
    expect(mentionPicker).toContain('mobileTypography.listTitle')
    const memberGrid = read('features/rooms/components/RoomMemberGrid.tsx')
    expect(memberGrid).toContain('mobileTypography.sectionTitle')
    expect(memberGrid).toContain('mobileTypography.metadata')
    const attachment = read('features/rooms/components/RoomMessageAttachment.tsx')
    expect(attachment).toContain('mobileTypography.secondary')
    expect(attachment).toContain('mobileTypography.metadata')
    const addAgent = read('features/rooms/screens/RoomAgentAddScreen.tsx')
    expect(addAgent).toContain('mobileTypography.secondary')
    const devices = read('features/profile/components/ProfileDevicesCard.tsx')
    expect(devices).toContain('styles.rowValue, styles.rowSummary, ds.rowValue')
    const profile = read('features/profile/ProfileScreen.tsx')
    expect(profile).toMatch(/styles\.rowValue,\s*styles\.rowSummary,\s*ds\.rowValue/)
    const account = read('features/profile/components/ProfileAccountCard.tsx')
    expect(account).toContain('styles.rowValue, styles.rowSummary, ds.rowValue')
  })

  it('does not use disabled-level gray for readable native session metadata and empty directory states', () => {
    const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')
    const sessions = read('components/SessionItem.tsx')
    expect(sessions).toContain("Platform.OS === 'web' ? colors.textTertiary : colors.textMuted")
    const browser = read('components/DirBrowser.tsx')
    expect(browser).toContain('styles.empty, { color: colors.textSecondary }')
    const account = read('features/profile/components/ProfileAccountCard.tsx')
    expect(account).toContain('accountDeleteWarning, { color: colors.textSecondary }')
    expect(account).toContain('accountDeletionDetail, { color: colors.textSecondary }')
    const agentDetail = read('../app/(main)/agents/[agentId]/index.tsx')
    expect(agentDetail).toContain('globalName: { ...mobileTypography.listTitle }')
    expect(agentDetail).toContain('styles.globalRowTitle, { color: colors.text }')
    const projectRoot = read('../app/(main)/index.tsx')
    expect(projectRoot).toContain('emptyText: { color: colors.textSecondary }')
    expect(projectRoot).toContain('...mobileTypography.compactAction')
    const agentRoot = read('../app/(main)/agents/index.tsx')
    expect(agentRoot).toContain("emptyText: { ...mobileTypography.secondary")
    expect(agentRoot).toContain('emptyAction: { ...mobileTypography.compactAction }')
    const scan = read('../app/(main)/scan.tsx')
    expect(scan).toContain('...mobileTypography.navigationTitle')
    expect(scan).toContain('{ backgroundColor: colors.brand }')
    expect(scan).not.toContain("backgroundColor: '#4f46e5'")
  })
})
