// @covers packages/app/src/features/rooms/RoomAccessGate.tsx
// @covers packages/app/src/features/rooms/NativeRoomInviteScreen.tsx
// @covers packages/app/app/(auth)/_layout.tsx
// @covers packages/app/app/_layout.tsx
// @covers packages/app/app/(main)/_layout.tsx
// @covers packages/app/app/+html.tsx
// @covers packages/app/src/features/auth/utils/redirect.ts

import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeAuthRedirect } from '../features/auth/utils/redirect'
import { roomAuthRedirectPathname, roomIdFromWebPathname } from '../features/rooms/roomWebDeepLink'

describe('Room invitation web continuation', () => {
  it('allows login to return only to a token-free stable Room route', () => {
    expect(sanitizeAuthRedirect('/spaces/join/continue')).toBe('/(main)')
    expect(sanitizeAuthRedirect('/spaces/room_01HZZ8ABC')).toBe('/spaces/room_01HZZ8ABC')
    expect(sanitizeAuthRedirect('/spaces/join/private-token')).toBe('/(main)')
    expect(sanitizeAuthRedirect('/spaces/room_01HZZ8ABC?token=secret')).toBe('/(main)')
    expect(sanitizeAuthRedirect('//evil.example/spaces/join/continue')).toBe('/(main)')
    expect(sanitizeAuthRedirect(undefined, '/landing')).toBe('/landing')
  })

  it('preserves a direct Room page when the authenticated layout sends the user to login', () => {
    const source = readFileSync(resolve(__dirname, '../../app/(main)/_layout.tsx'), 'utf8')

    expect(source).toContain("pathname: '/(auth)/login'")
    expect(source).toContain('roomAuthRedirectPathname(pathname, browserPathname)')
    expect(roomAuthRedirectPathname('/', '/spaces/room_01HZZ8ABC')).toBe('/spaces/room_01HZZ8ABC')
    expect(roomAuthRedirectPathname('/profile', '/chat/session_1')).toBe('/profile')
    expect(source).not.toContain('if (!isAuthenticated) return <Redirect href="/(auth)/login"')
  })

  it('recovers a concrete Room ID when static Web hydration falls back to the home route', () => {
    const source = readFileSync(resolve(__dirname, '../../app/(main)/index.web.tsx'), 'utf8')

    expect(roomIdFromWebPathname('/spaces/room_01HZZ8ABC')).toBe('room_01HZZ8ABC')
    expect(roomIdFromWebPathname('/spaces/room_01HZZ8ABC/')).toBe('room_01HZZ8ABC')
    expect(roomIdFromWebPathname('/spaces/join/private-token')).toBeNull()
    expect(source).toContain("pathname: '/spaces/[roomId]'")
    expect(source).toContain('params: { roomId }')
  })

  it('preserves the sanitized invite destination when auth state finishes first', () => {
    const source = readFileSync(resolve(__dirname, '../../app/(auth)/_layout.tsx'), 'utf8')

    expect(source).toContain('useLocalSearchParams')
    expect(source).toContain('sanitizeAuthRedirect(params.redirect, defaultRedirect)')
    expect(source).not.toContain('if (isAuthenticated) return <Redirect href="/(main)"')
  })

  it('reads only HttpOnly browser state and declares no-referrer', () => {
    const source = readFileSync(resolve(__dirname, '../features/rooms/RoomAccessGate.tsx'), 'utf8')
    expect(source).toContain("'/room-invites/bootstrap'")
    expect(source).toContain("credentials: 'include'")
    expect(source).toContain('window.location.assign(result.scopedPath)')
    expect(source).toContain('<meta name="referrer" content="no-referrer" />')
    expect(source).not.toContain('inviteToken')
    expect(source).not.toContain('useLocalSearchParams')
    expect(source).not.toContain("t('room_invite_link_secured')")
    expect(source).not.toContain("t('room_invite_link_secured_body')")
  })

  it('keeps every Web route out of account-level hydration and the active control shell', () => {
    const root = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8')
    const main = readFileSync(resolve(__dirname, '../../app/(main)/_layout.tsx'), 'utf8')
    const singleRoomBranch = root.split('if (isSingleRoomWeb) {')[1]?.split('if (isWeb) {')[0] ?? ''
    const lightweightWebBranch =
      root.split('if (isWeb) {').at(-1)?.split('let mounted = true')[0] ?? ''

    expect(singleRoomBranch).toContain('setReady(true)')
    expect(singleRoomBranch).not.toContain('loadFromStorage()')
    expect(lightweightWebBranch).toContain('loadFromStorage()')
    // Desktop restore is already validated by main; do not start the native
    // profile/device validation and renderer login sequence afterwards.
    expect(lightweightWebBranch).not.toContain('validateStoredSession()')
    expect(lightweightWebBranch).not.toContain('hydrateLaunchStorage')
    expect(lightweightWebBranch).not.toContain('hydrateChatDraftStorage')
    expect(lightweightWebBranch).not.toContain('hydrateProjectPrefs')
    expect(main).not.toContain('RetiredWebControlPlane')
    expect(main).not.toContain('web_control_retired_title')
  })

  it('uses scoped phone identity and never loads a full account token into the Room gate', () => {
    const source = readFileSync(resolve(__dirname, '../features/rooms/RoomAccessGate.tsx'), 'utf8')
    const phoneHook = readFileSync(
      resolve(__dirname, '../features/auth/hooks/usePhoneLogin.ts'),
      'utf8',
    )

    expect(source).toContain('verifyScopedRoom: true')
    expect(source).toContain('deferScopedInviteJoin: true')
    expect(source).toContain('scopedRoomId: unavailable ? roomId : undefined')
    expect(source).toContain("credentials: 'include'")
    expect(source).toContain("result.outcome === 'join_closed'")
    expect(source).not.toContain('useAuthStore')
    expect(source).not.toContain('authApi')
    expect(phoneHook).toContain("'/room-invites/scoped/verify-phone'")
    expect(phoneHook).toContain(
      '`/room-browser/${encodeURIComponent(scopedRoomId)}/scoped/verify-phone`',
    )
    expect(source).not.toContain('rawToken')
  })

  it('requires a short introduction on every approval join surface', () => {
    const web = readFileSync(resolve(__dirname, '../features/rooms/RoomAccessGate.tsx'), 'utf8')
    const native = readFileSync(
      resolve(__dirname, '../features/rooms/NativeRoomInviteScreen.tsx'),
      'utf8',
    )
    const errors = readFileSync(
      resolve(__dirname, '../features/auth/utils/verifyCodeError.ts'),
      'utf8',
    )

    for (const source of [web, native]) {
      expect(source).toContain("t('room_invite_message_label')")
      expect(source).toContain("t('room_invite_message_placeholder')")
      expect(source).toContain('maxLength={500}')
    }
    expect(web).toContain('joinMessage.trim()')
    expect(native).toContain('message.trim()')
    expect(web).toContain("'/room-invites/scoped/join'")
    expect(web).toContain("result.outcome === 'needs_application'")
    expect(native).toContain('message: message.trim()')
    expect(errors).toContain("case 'join_message_required':")
  })

  it('keeps the native approval action reachable while the software keyboard is open', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/rooms/NativeRoomInviteScreen.tsx'),
      'utf8',
    )

    expect(source).toContain('<KeyboardAvoidingView')
    expect(source).toContain("Platform.OS === 'ios' ? 'padding'")
    expect(source).toContain('<ScrollView')
    expect(source).toContain(
      "keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}",
    )
    expect(source).toContain('keyboardShouldPersistTaps="handled"')
    expect(source).toContain('Keyboard.dismiss()')
    expect(source).toContain('body: { flexGrow: 1')
  })

  it('uses a short-lived Room-bound mobile approval without putting it in a URL', () => {
    const source = readFileSync(resolve(__dirname, '../features/rooms/RoomAccessGate.tsx'), 'utf8')

    expect(source).toContain('react-native-qrcode-svg')
    expect(source).toContain('`/${encodeURIComponent(roomId)}/qr/create`')
    expect(source).toContain('`/${encodeURIComponent(roomId)}/qr/status`')
    expect(source).toContain('JSON.stringify({ token: approval.approvalToken })')
    expect(source).not.toContain('/qr/status/${')
    expect(source).toContain('const [showPhone, setShowPhone] = useState(true)')
    expect(source).toContain("const showQrApproval = Platform.OS === 'web' && !showPhone")
    expect(source).toContain("t('room_access_phone_tab')")
    expect(source).toContain("t('room_access_qr_tab')")
    expect(source).not.toContain('width >= 720')
    expect(source).not.toContain("t('room_access_qr_refresh')")
    expect(source).not.toContain("t('room_access_confirm_body')")
  })

  it('offers an explicit native Room action and direct platform downloads at the web gate', () => {
    const source = readFileSync(resolve(__dirname, '../features/rooms/RoomAccessGate.tsx'), 'utf8')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')

    expect(source).not.toContain('MobileAppDownloadDialog')
    expect(source).toContain("t('room_access_open_in_app')")
    expect(source).toContain('shennian:///spaces/${encodeURIComponent(roomId)}')
    expect(source).toContain("t('room_access_download_ios')")
    expect(source).toContain("t('room_access_download_android')")
    expect(source).toContain('getMobileAppDownloadUrl')
    expect(source).toContain("t('room_access_official_site')")
    expect(source).not.toContain('install.md')
    expect(source.indexOf("t('room_access_open_in_app')")).toBeLessThan(
      source.indexOf("t('room_access_download_android')"),
    )
    expect(source.indexOf("!loading && !loadError && !completion && roomId")).toBeGreaterThan(
      source.indexOf("needsApplication"),
    )
    expect(source).toContain("t('room_access_confirm_room_title', { name:")
    expect(zh).toContain("room_access_confirm_room_title: '登录并进入「{{name}}」'")
    expect(zh).not.toContain('确认身份后进入这个群聊')
  })

  it('never requests cross-group identity and keeps web logout directly accessible', () => {
    const gate = readFileSync(resolve(__dirname, '../features/rooms/RoomAccessGate.tsx'), 'utf8')
    const phone = readFileSync(
      resolve(__dirname, '../features/auth/hooks/usePhoneLogin.ts'),
      'utf8',
    )
    const logout = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomBrowserLogoutButton.tsx'),
      'utf8',
    )
    const conversation = readFileSync(
      resolve(__dirname, '../features/rooms/ScopedRoomConversationScreen.tsx'),
      'utf8',
    )
    expect(phone).toContain('rememberBrowser: false')
    expect(gate).not.toContain("t('room_browser_legacy_hint')")
    expect(gate).toContain("t('room_browser_qr_scoped_hint')")
    expect(gate).toContain('value.room.id !== roomId')
    expect(gate).not.toContain('testID="room-join-remembered"')
    expect(gate).toContain("'/room-invites/scoped/join'")
    expect(logout).toContain("'/logout'")
    expect(logout).toContain('name="log-out-outline"')
    expect(logout).toContain('size={20}')
    expect(logout).not.toContain('useAuthStore')
    expect(logout).not.toContain('ellipsis-horizontal')
    expect(conversation).toContain('testID="room-more-button"')
    expect(conversation).toContain('icon="more"')
    expect(conversation).not.toContain('name="share-outline" size={20}')
    expect(gate).not.toContain('SyncEngine')
  })

  it('does not globally request third-party fonts before the invite page policy applies', () => {
    const rootHtml = readFileSync(resolve(__dirname, '../../app/+html.tsx'), 'utf8')
    expect(rootHtml).not.toContain('fonts.googleapis.com')
    expect(rootHtml).not.toContain('fonts.gstatic.com')
  })

  it('renders native invite failures with localized copy instead of a missing key', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/rooms/NativeRoomInviteScreen.tsx'),
      'utf8',
    )

    expect(source).toContain("t('room_invite_unavailable_title')")
    expect(source).toContain("t('room_invite_unavailable_body')")
    expect(source).not.toContain("t('room_invite_unavailable')")
  })

  it('opens an existing member directly and keeps the new-member join screen minimal', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/rooms/NativeRoomInviteScreen.tsx'),
      'utf8',
    )

    expect(source).toContain('roomInvitationClient.exchange({ roomId: expectedRoomId, token })')
    expect(source).toContain('roomInvitationClient.join(')
    expect(source).not.toContain('authApi')
    expect(source).toContain("result.entryState === 'joined'")
    expect(source).toContain("result.entryState === 'pending_approval'")
    expect(source).toContain("t('room_invite_pending_title')")
    expect(source).toContain("t('room_invite_pending_body')")
    expect(source).not.toContain('chatbubbles-outline')
    expect(source).not.toContain('invite.room.description ?')
    expect(source).not.toContain("t('spaces_join_directly')")
    expect(source).not.toContain("t('spaces_join_requires_approval')")
  })
})
