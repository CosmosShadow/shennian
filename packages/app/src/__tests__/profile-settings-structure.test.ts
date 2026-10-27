import { readI18nSource } from './i18n-source-test-helper'
/**
 * @covers packages/app/src/features/profile/GeneralSettingsScreen.tsx
 * @covers packages/app/src/features/profile/components/ProfileContactGroup.tsx
 * @covers packages/app/src/features/profile/ProfileScreen.tsx
 * @covers packages/app/src/features/profile/components/ProfileAccountCard.tsx
 * @covers packages/app/src/features/profile/components/ProfileIdentityCard.tsx
 * @covers packages/app/src/features/profile/styles.ts
 * @covers packages/app/app/(main)/personal-profile.tsx
 * @covers packages/app/src/features/contacts/PersonalIdentityQr.tsx
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode, type ReactElement } from 'react'
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'ProfileIcon' }))
vi.mock('../features/profile/profileUtils', () => ({ maskPhone: () => 'masked phone' }))
import { styles as nativeStyles } from '../features/profile/styles'
import { ProfileAccountCard } from '../features/profile/components/ProfileAccountCard'
function accountProps(): Parameters<typeof ProfileAccountCard>[0] {
  return {
    accountOpen: true, accountDeleting: false, confirmingDeleteAccount: false, confirmingLogout: false,
    colors: { bg: '#fff', error: '#f00', groupedSeparator: '#ddd', surfaceHover: '#eee', text: '#111', textSecondary: '#555', textTertiary: '#888' },
    iconColor: '#555', ds: { settingsGroup: { backgroundColor: '#fff' }, rowLabel: { color: '#111' }, rowValue: { color: '#555' }, logoutText: { color: '#111' }, deleteAccountText: { color: '#f00' } },
    t: (key) => key, onToggleOpen: vi.fn(), onRequestLogout: vi.fn(), onRequestDeleteAccount: vi.fn(),
    onConfirmDeleteAccount: vi.fn(), onConfirmLogout: vi.fn(), setConfirmingDeleteAccount: vi.fn(), setConfirmingLogout: vi.fn(),
  }
}

function rendered(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.reduce<Array<ReactElement<Record<string, unknown>>>>((all, child) => all.concat(rendered(child)), [])
  if (!isValidElement(node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...rendered(element.props.children as ReactNode)]
}

function readSource(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf-8')
}

describe('profile settings information architecture', () => {
  it('keeps profile editing in one place and saves the complete contact card', () => {
    const settings = readSource('../features/profile/ProfileScreen.tsx')
    const personalProfile = readSource('../../app/(main)/personal-profile.tsx')
    const qr = readSource('../features/contacts/PersonalIdentityQr.tsx')
    const accountPage = settings.slice(settings.indexOf("if (mode === 'account')"), settings.indexOf("if (mode === 'devices')"))

    expect(accountPage).not.toContain('<ProfileIdentityCard')
    expect(personalProfile).not.toContain('<RoomIdentityAvatar')
    expect(personalProfile).toContain('<ProfileAvatarEditor')
    expect(personalProfile).toContain('styles.introductionInput')
    expect(personalProfile).toContain('<KeyboardAvoidingView')
    expect(qr).toContain("t('mobile_identity_qr_hint', { name })")
    expect(qr).toContain("t('mobile_identity_qr_brand')")
    expect(qr).toContain('ref.current?.toDataURL')
    expect(qr).toContain('<SvgText')
    expect(qr).toContain('matrix.data.map')
  })

  it('does not consume the first nickname modal action to dismiss the keyboard', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const scrollView = profileScreen.match(/<ScrollView\b[\s\S]*?>/)?.[0]

    // Native regression flow verifies actual single taps with a focused input:
    // tests/e2e/mobile/flows/ios/profile-nickname.yaml
    expect(scrollView).toContain('keyboardShouldPersistTaps="handled"')
  })

  it('localizes the machine summary without leaving Chinese text in English settings', () => {
    const profileScreen = readSource('../features/mobile-navigation/FeaturesScreen.tsx')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(profileScreen).not.toContain('feature-computers')
    expect(profileScreen).toContain("entry.key !== 'computers'")
    expect(profileScreen).not.toContain('${totalCount} 台')
    expect(en).toContain("machines_online_summary_one: '{{online}} online · 1 machine'")
    expect(en).toContain("machines_online_summary: '{{online}} online · {{total}} machines'")
    expect(en).toContain("machines_total_one: '1 machine'")
    expect(en).toContain("machines_total: '{{total}} machines'")
  })

  it('groups logged-in devices under My Machines and removes the standalone device card', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).not.toContain('testID="settings-features"')
    expect(profileScreen).toContain('showDot={settingsBadges.machines}')
    expect(profileScreen).toContain('<ProfileDevicesCard')
    expect(profileScreen).toContain('embedded')
    expect(profileScreen).not.toContain('<ProfileDevicesCard\n          colors={colors}')
  })

  it('provides a direct computer upgrade destination from settings regardless of configured tabs', () => {
    const profile = readSource('../features/profile/ProfileScreen.tsx')
    const row = profile.slice(profile.indexOf('testID="settings-machines"'), profile.indexOf('<ProfileContactGroup>'))
    expect(row).toContain("pathname: '/(main)/machines', params: { __mobileEntry: 'push' }")
    expect(row).toContain('accessibilityRole="button"')
    expect(row).toContain("t('mobile_my_computers')")
    expect(row).toContain('showDot={settingsBadges.machines}')
    expect(row).toContain('{settingsBadges.machines ? (')
    expect(row).toContain("t('machine_cli_update_available_short')")
    // Outside the optional all-features fallback: custom tabs must not hide the destination.
    expect(profile.indexOf('testID="settings-machines"')).toBeGreaterThan(profile.indexOf('testID="settings-general"'))
    expect(profile).toContain('showDot={settingsBadges.machines}')
  })

  it('removes retired external connector entries and keeps general settings', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(profileScreen).not.toContain("t('settings_external_channels')")
    expect(profileScreen).toContain("t('settings_general')")
    expect(profileScreen).not.toContain("t('wecom_settings_title')")
    expect(profileScreen).not.toContain("t('feishu_settings_title')")
    expect(profileScreen).not.toContain("t('settings_personal_wechat')")
    expect(profileScreen).not.toContain("t('profile_docs')")
    expect(readSource('../features/profile/GeneralSettingsScreen.tsx')).toContain("t('theme')")
    expect(readSource('../features/profile/GeneralSettingsScreen.tsx')).toContain("t('language')")
    expect(profileScreen).not.toContain("t('push_preview')")
    expect(profileScreen).not.toContain('profile-push-preview-toggle')
    expect(profileScreen).not.toContain('pushPreviewEnabled')
    expect(profileScreen).toContain('profileAccountClient.getProfile()')
    expect(profileScreen).not.toContain('isDesktopControlSurfaceEnabled')
    expect(profileScreen).not.toContain("t('home_view_mode')")
    expect(zh).not.toContain('settings_external_channels')
    expect(zh).toContain("settings_general: '界面设置'")
    expect(zh).toContain("settings_personal_wechat: '使用微信'")
    expect(en).not.toContain('settings_external_channels')
    expect(en).toContain("settings_general: 'Interface settings'")
    expect(en).toContain("settings_personal_wechat: 'Personal WeChat'")
  })

  it('keeps interface preferences separate from help and version', () => {
    const profile = readSource('../features/profile/ProfileScreen.tsx')
    const general = readSource('../features/profile/GeneralSettingsScreen.tsx')
    const contact = readSource('../features/profile/components/ProfileContactGroup.tsx')
    const route = readSource('../../app/(main)/general-settings.tsx')
    expect(profile).toContain("router.navigate('/(main)/general-settings')")
    expect(profile).not.toContain('<ChatFontSizeSettingRow')
    expect(route).toContain('GeneralSettingsScreen')
    expect(general).toContain('onBack={() => router.back()}')
    expect(general).not.toContain('MobileRootTabBar')
    expect(general.indexOf('<ChatFontSizeSettingRow')).toBeLessThan(
      general.indexOf('testID="settings-theme"'),
    )
    expect(general.indexOf('testID="settings-theme"')).toBeLessThan(
      general.indexOf('testID="settings-language"'),
    )
    expect(general).toContain("AsyncStorage.setItem('lang', next)")
    expect(general).toContain('onPress={cycleTheme}')
    const deviceGroup = profile.slice(
      profile.indexOf('testID="settings-version"'),
      profile.indexOf('{accountCard}', profile.indexOf('testID="settings-version"')),
    )
    expect(deviceGroup).toContain('testID="settings-version"')
    expect(deviceGroup).toContain('onPress={handleToggleVersion}')
    expect(contact).toContain("Platform.OS === 'ios'")
  })

  it('does not expose a Personal WeChat settings entry', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).not.toContain('openPersonalWeChat')
    expect(profileScreen).not.toContain("router.navigate('/(main)/wechat-rpa')")
    expect(profileScreen).not.toContain('settingsBadges.wechat')
    expect(profileScreen).not.toContain("router.navigate('/(main)/local-control')")
  })

  it('awaits account-scoped local privacy cleanup for logout and account deletion', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).toContain("import { clearAccountLocalData } from '../../config/sync'")
    expect(profileScreen.match(/await logout\(\)/g)).toHaveLength(2)
    expect(
      profileScreen.match(/await clearAccountLocalData\(accountId\)\.catch\(\(\) => \{\}\)/g),
    ).toHaveLength(2)
    expect(profileScreen.match(/await clearProfileDevices\(accountId\)/g)).toHaveLength(2)
    expect(profileScreen).not.toContain('void logout()')
    for (const accountDeleting of [false, true]) {
      const nodes = rendered(ProfileAccountCard({ ...accountProps(), accountDeleting }))
      const modal = nodes.find(n => n.type === 'Modal')!
      expect(modal.props.visible).toBe(accountDeleting)
      expect(modal.props.presentationStyle).toBe('fullScreen')
      expect(modal.props.onRequestClose).toBeTypeOf('function')
      expect((modal.props.onRequestClose as () => void)()).toBeUndefined()
      expect(nodes.some(n => n.props.testID === 'account-deletion-progress')).toBe(true)
      expect(nodes.some(n => n.props.children === 'account_delete_progress')).toBe(true)
    }
  })

  it('keeps upgrade dots in destination rows without duplicating them on the Desktop account', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const sidebar = readSource('../features/desktop-shell/DesktopSidebar.tsx')
    const mobileTabBar = readSource('../components/MobileRootTabBar.tsx')

    expect(profileScreen).toContain('useSettingsUpgradeBadges')
    expect(profileScreen).toContain('settingsBadges.ota')
    expect(profileScreen).toContain('RowLabelWithDot')
    expect(sidebar).not.toContain('settingsBadges.any')
    expect(mobileTabBar).toContain('settingsBadges.any')
  })

  it('removes managed WeCom from the settings surface', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    expect(profileScreen).not.toContain('canUseManagedWeCom')
    expect(profileScreen).not.toContain("router.navigate('/(main)/wecom')")
  })

  it('removes plans, organizations, docs, and home-view controls', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).not.toContain('BILLING_FEATURE_MODE')
    expect(profileScreen).not.toContain("router.navigate('/(main)/billing')")
    expect(profileScreen).not.toContain("router.navigate('/(main)/organizations')")
    expect(profileScreen).not.toContain('profile-open-docs')
    expect(profileScreen).not.toContain("t('home_view_mode')")
  })

  it('shows identity immediately and promotes account management only on Desktop', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const accountCard = readSource('../features/profile/components/ProfileAccountCard.tsx')
    const identityCard = readSource('../features/profile/components/ProfileIdentityCard.tsx')
    const profileStyles = readSource('../features/profile/styles.ts')

    expect(profileScreen).not.toContain('userId={user?.id}')
    expect(profileScreen).toContain('onSaveNickname={handleSaveNickname}')
    expect(profileScreen).toContain('profileAccountClient.updateProfile(nicknameDraft)')
    expect(profileScreen).not.toContain('finger-print-outline" size={18}')
    expect(profileScreen.indexOf('<ProfileIdentityCard')).toBeLessThan(
      profileScreen.lastIndexOf('{accountCard}'),
    )
    expect(profileScreen).not.toContain('settingsPresentation.accountPlacement')
    expect(readSource('../features/profile/ProfileScreen.web.tsx')).toContain(
      '../desktop-settings/DesktopProfileScreen',
    )
    expect(readSource('../features/desktop-settings/DesktopProfileScreen.tsx')).toContain(
      '<DesktopProfileAccount',
    )
    expect(identityCard).toContain('<ProfileAvatarEditor')
    expect(identityCard).toContain("t('profile_nickname')")
    expect(identityCard).toContain('profile-save-nickname')
    expect(identityCard).toContain('visible={nicknameEditing}')
    expect(identityCard).toContain('animationType="none"')
    expect(identityCard).toContain('presentationStyle="overFullScreen"')
    expect(identityCard).toContain('testID="profile-nickname-modal"')
    expect(identityCard).toContain('testID="profile-nickname-input"')
    expect(identityCard).toContain('accessibilityViewIsModal')
    expect(identityCard).not.toContain('backgroundColor: colors.brand')
    expect(identityCard).not.toContain('pencil-outline')
    expect(identityCard).toContain("from '@expo/vector-icons/Ionicons'")
    expect(profileStyles).toContain('nicknameModalInput: {\n    height: 46')
    expect(profileStyles).toContain(
      "profileAvatarPressable: {\n    position: 'relative',\n    width: 56,\n    height: 56,\n    borderRadius: avatarBorderRadius(56),\n    overflow: 'hidden'",
    )
    expect(profileStyles).toContain(
      'profileAvatarImage: {\n    width: 56,\n    height: 56,\n    borderRadius: avatarBorderRadius(56)',
    )
    expect(profileStyles).toContain(
      "profileIdentityName: {\n    flex: 1,\n    minWidth: 0,\n    minHeight: 48,\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: 8",
    )
    expect(profileStyles).toContain(
      'profileIdentityNickname: {\n    flexShrink: 1,\n    fontSize: 18,\n    lineHeight: 23',
    )
    expect(profileStyles).toContain(
      "justifyContent: 'flex-start',\n    paddingHorizontal: 24,\n    paddingTop: 120",
    )
    expect(identityCard.indexOf('style={styles.profileIdentityName}')).toBeLessThan(
      identityCard.indexOf('<Modal'),
    )
    expect(identityCard).not.toContain('styles.card')
    expect(identityCard).toContain('chevron-forward')
    expect(identityCard).toContain("introduction?.trim() || t('mobile_introduction_empty')")
    expect(identityCard.indexOf('<ProfileAvatarEditor')).toBeLessThan(
      identityCard.indexOf('profileIdentityName'),
    )
    expect(accountCard).toContain("t('mobile_account_security')")
    expect(accountCard).not.toContain("t('settings_user_id')")
    expect(accountCard).not.toContain("t('settings_phone')")
    expect(accountCard).toContain('maskPhone(phone)')
    expect(accountCard).not.toContain('profile-account-phone')
    expect(profileScreen).toContain('phone={user?.phone}')
    expect(accountCard).not.toContain('userId')
    expect(accountCard).toContain('profile-account-toggle')
    expect(profileScreen).toContain('const [accountOpen, setAccountOpen] = useState(false)')
    expect(accountCard).toContain("accessibilityLabel={t('mobile_account_security')}")
  })

  it('uses fixed profile operations and does not retry account deletion through a status endpoint', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).toContain('profileAccountClient.revokeDevice(deviceId)')
    expect(profileScreen).toContain('profileAccountClient.deleteAccount(operationId)')
    expect(profileScreen).not.toContain('/auth/devices/')
    expect(profileScreen).not.toContain('/auth/account')
    expect(profileScreen).not.toContain('account-deletion/status')
  })

  it('removes AI phone voice settings from the settings surface', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    expect(existsSync(resolve(__dirname, '../features/voice-chief/preferences.ts'))).toBe(false)
    expect(profileScreen).not.toContain('testID="profile-voice-chief-voice"')
    expect(profileScreen).not.toContain("t('voice_chief_settings_voice')")
    expect(profileScreen).not.toContain("t('voice_chief_voice_clear_female')")
    expect(profileScreen).not.toContain('updateVoiceChiefVoice')
    expect(profileScreen).not.toContain('voiceChiefPickerOpen')
    expect(profileScreen).not.toContain('getVoiceChiefPreferences')
  })

  it('matches the settings title to the other mobile root headers', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const pageHeader = readSource('../components/AppPageHeader.tsx')
    expect(profileScreen).toContain("title={t('settings')}")
    expect(profileScreen).toContain('<AppPageHeader')
    expect(pageHeader).toContain('height: 48')
    expect(pageHeader).toContain('...mobileTypography.navigationTitle')
    expect(pageHeader).toContain('side: { width: 48, height: 48')
  })

  it('keeps Desktop layout out of the native settings page', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const profileStyles = readSource('../features/profile/styles.ts')

    expect(profileStyles).toContain('webScrollContent: { paddingTop: 12 }')
    expect(profileScreen).not.toContain('styles.webScrollContent')
    expect(profileScreen).not.toContain('useDesktopUpdateState')
    expect(profileScreen).toContain('useAppUpdateState({ autoCheck: true, compatibilitySnapshot })')
  })

  it('keeps light-mode grouping while using the standard dark page canvas', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).toContain('container: { backgroundColor: colors.bg }')
    expect(profileScreen).toContain('settingsGroup: { backgroundColor: colors.groupedSurface }')
    expect(profileScreen).toContain('{ backgroundColor: isDark ? colors.bg : colors.surfaceHover }')
    expect(profileScreen).not.toContain('isDark ? colors.surface : colors.bg')
  })

  it('separates the desktop account row with a quiet hairline', () => {
    const sidebar = readSource('../features/desktop-shell/DesktopSidebar.tsx')
    expect(sidebar).toContain('borderTopWidth: StyleSheet.hairlineWidth')
  })

  it('uses inset native styles and preserves account actions', () => {
    const profile = readSource('../features/profile/ProfileScreen.tsx')
    const main = profile.slice(profile.lastIndexOf('<ProfileIdentityCard'), profile.lastIndexOf('{accountCard}'))
    expect(main.match(/<View style=\{\[styles\.settingsGroup, ds\.settingsGroup\]\}>/g)).toHaveLength(3)
    expect(main).not.toContain("t('mobile_all_features')")
    expect(main).toContain("t('settings_general')")
    expect(main).toContain("t('app_version')")
    expect(main).not.toContain("/(main)/personal-modules")
    expect(nativeStyles.identityGroup).toMatchObject({ marginHorizontal: 16, paddingVertical: 16 })
    expect(nativeStyles.settingsGroup).toMatchObject({ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden' })
    expect(nativeStyles.section.gap).toBe(4)
    expect(nativeStyles.rootSection).toEqual({ gap: 12, paddingTop: 12 })
    expect(nativeStyles.row.minHeight).toBeGreaterThanOrEqual(56)
    expect(nativeStyles.settingsGroup).not.toHaveProperty('maxWidth')
    const toggle = vi.fn(), logout = vi.fn(), remove = vi.fn()
    const props = {
      accountOpen: false, accountDeleting: false, confirmingDeleteAccount: false, confirmingLogout: false,
      colors: { bg: '#fff', error: '#f00', groupedSeparator: '#ddd', surfaceHover: '#eee', text: '#111', textSecondary: '#555', textTertiary: '#888' },
      iconColor: '#555', ds: { settingsGroup: { backgroundColor: '#fff' }, rowLabel: { color: '#111' }, rowValue: { color: '#555' }, logoutText: { color: '#111' }, deleteAccountText: { color: '#f00' } },
      t: (key: string) => key, onToggleOpen: toggle, onRequestLogout: logout, onRequestDeleteAccount: remove,
      onConfirmDeleteAccount: vi.fn(), onConfirmLogout: vi.fn(), setConfirmingDeleteAccount: vi.fn(), setConfirmingLogout: vi.fn(),
    }
    const closed = rendered(ProfileAccountCard(props))
    const control = closed.find(n => n.props.testID === 'profile-account-toggle')!
    expect(control.props.accessibilityState).toEqual({ expanded: false })
    ;(control.props.onPress as () => void)()
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(closed.find(n => n.props.name === 'person-circle-outline')?.props).toMatchObject({ size: 21, color: '#555' })
    const expanded = rendered(ProfileAccountCard({ ...props, accountOpen: true }))
    expect(expanded.some(n => n.props.onPress === logout)).toBe(true)
    expect(expanded.some(n => n.props.onPress === remove)).toBe(true)
  })

  it('moves the native scan action into the top-right header', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).toContain('testID="profile-scan-action"')
    expect(profileScreen).toContain('icon="scan-outline"')
    expect(profileScreen).not.toContain('name="qr-code-outline"')
  })

  it('shows one current version and a concise update status without technical build details', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(profileScreen).toContain('{appUpdate.rowValueLabel}')
    expect(profileScreen).toContain('{appUpdate.message}')
    expect(profileScreen).toContain("t('app_update_check')")
    expect(profileScreen).not.toContain("t('app_update_current_ota'")
    expect(profileScreen).not.toContain("t('app_update_native_shell'")
    expect(profileScreen).not.toContain('appUpdate.nativeBuildVersion')
    expect(profileScreen).not.toContain('formatRuntimeVersionDetails')
    expect(profileScreen).not.toContain('versionDetailLines')
    expect(profileScreen.match(/name="chevron-forward"/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('centers the expanded account danger actions', () => {
    const props = accountProps()
    const nodes = rendered(ProfileAccountCard(props))
    for (const action of [props.onRequestLogout, props.onRequestDeleteAccount]) {
      const button = nodes.find(n => n.props.onPress === action)!
      expect(button).toBeDefined()
      const styles = Object.assign({}, ...(button.props.style as object[]))
      expect(styles).toMatchObject({ justifyContent: 'center', minHeight: 44, paddingVertical: 10 })
      ;(button.props.onPress as () => void)()
      expect(action).toHaveBeenCalledTimes(1)
    }
    expect(nativeStyles.accountDangerActions.paddingTop).toBe(22)
    expect(nativeStyles.accountActionText.textAlign).toBe('center')
    expect(nodes.some(n => Array.isArray(n.props.style) && n.props.style[0] === nativeStyles.accountDangerActions)).toBe(true)
    expect(nodes.some(n => Array.isArray(n.props.style) && n.props.style.some((style: any) => style?.backgroundColor === '#eee'))).toBe(true)
    expect(nodes.some(n => Array.isArray(n.props.style) && n.props.style[0] === nativeStyles.rowValue)).toBe(true)
  })

  it('shows a login-device count and visually nests expanded device details', () => {
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')
    const devicesCard = readSource('../features/profile/components/ProfileDevicesCard.tsx')
    const profileStyles = readSource('../features/profile/styles.ts')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')

    expect(profileScreen).toContain('void loadDevices()')
    expect(profileScreen).toContain('devicesLoaded={devicesLoaded}')
    expect(devicesCard).toContain("t('devices_count', { count: devices.length })")
    expect(devicesCard).toContain('devicesLoading && !devicesLoaded')
    expect(devicesCard).toContain('backgroundColor: colors.surfaceHover')
    expect(profileStyles).toContain('marginLeft: 48')
    expect(zh).toContain("devices_title: '登录设备'")
    expect(zh).toContain("devices_count: '{{count}} 个'")
    expect(zh).toContain("device_name_ios: 'iOS 客户端'")
    expect(zh).toContain("device_name_desktop_browser: '桌面浏览器'")
  })

  it('keeps conversation colors independent from the mobile tab selection color', () => {
    const theme = readSource('../hooks/useTheme.ts')
    const chatCss = readSource('../components/chat/webview/chatCss.ts')
    const mobileTabBar = readSource('../components/MobileRootTabBar.tsx')

    expect(theme).toContain("brand: '#4f46e5'")
    expect(theme).toContain("brand: '#818cf8'")
    expect(chatCss).toContain('--brand:#4f46e5')
    expect(chatCss).toContain('--brand:#818cf8')
    expect(mobileTabBar).toContain('const selectedColor = colors.navigationSelected')
    expect(mobileTabBar).not.toContain('MOBILE_SELECTED_COLOR_')
    expect(mobileTabBar).toContain('selected ? selectedColor : colors.textSecondary')
  })
})
