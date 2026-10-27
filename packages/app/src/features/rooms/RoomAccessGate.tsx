// @arch docs/features/network-rooms/core-data-and-security-decisions.md#七邀请-token-进入浏览器后的安全处理
// @test ../../__tests__/room-invite-web.test.ts

import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Head from 'expo-router/head'
import { useTranslation } from 'react-i18next'
import { api } from '../../config/api'
import { getServerUrl } from '../../config/server'
import { useTheme } from '../../hooks/useTheme'
import { useAuthPublicConfig } from '../auth/hooks/useAuthPublicConfig'
import { usePhoneLogin } from '../auth/hooks/usePhoneLogin'
import { offerScopedNicknameSetup, type ScopedNicknameSetup } from '../auth/offerNicknameSetup'
import { PhoneLoginPanel } from '../auth/components/PhoneLoginPanel'
import { TencentCaptchaModal } from '../../components/auth/TencentCaptchaModal'
import { ApiError } from '@shennian/shared/api'
import { scopedRoomApi } from './scopedRoomApi'
import { getMobileAppDownloadUrl } from '../../platform/mobileAppDownload'

let QRCode: any = null
if (Platform.OS === 'web') QRCode = require('react-native-qrcode-svg').default

type InviteBootstrap = {
  status: 'ready'
  room: {
    id: string
    name: string
    description: string
    visibility: 'private' | 'public_read'
    joinPolicy: 'open' | 'approval' | 'closed'
  }
  expiresAt: string
}

type Completion = { kind: 'pending' }
type BrowserApproval = {
  approvalToken: string
  payload: string
  expiresAt: string
  roomName: string
}

export function RoomAccessGate({ roomId }: { roomId: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const authConfig = useAuthPublicConfig()
  const [loadError, setLoadError] = useState(false)
  const [invite, setInvite] = useState<InviteBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [approval, setApproval] = useState<BrowserApproval | null>(null)
  const [approvalError, setApprovalError] = useState('')
  const [showPhone, setShowPhone] = useState(true)
  const [joinMessage, setJoinMessage] = useState('')
  const [needsApplication, setNeedsApplication] = useState(false)
  const [joinClosed, setJoinClosed] = useState(false)
  const [submittingApplication, setSubmittingApplication] = useState(false)
  const showQrApproval = Platform.OS === 'web' && !showPhone
  const phoneLogin = usePhoneLogin({
    captchaAppId: authConfig.tencentCaptchaAppId ?? '',
    verifyScopedRoom: true,
    scopedInviteRoomId: roomId,
    scopedRoomId: unavailable ? roomId : undefined,
    deferScopedInviteJoin: true,
    onScopedResult: (result) => {
      if (result.outcome === 'needs_application') {
        setNeedsApplication(true)
        return true
      }
      if (result.outcome === 'join_closed') {
        setJoinClosed(true)
        return true
      }
      if (result.outcome !== 'pending_approval') return false
      setCompletion({ kind: 'pending' })
      return true
    },
  })

  const submitApplication = useCallback(async () => {
    if (!joinMessage.trim()) {
      phoneLogin.setError(t('room_invite_message_required'))
      return
    }
    setSubmittingApplication(true)
    phoneLogin.clearError()
    try {
      const result = await api<{ outcome: 'joined' | 'pending_approval'; scopedPath?: string }>(
        '/room-invites/scoped/join',
        {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ roomId, message: joinMessage.trim() }),
        },
      )
      if (result.outcome === 'pending_approval') {
        setCompletion({ kind: 'pending' })
        return
      }
      if (result.scopedPath && Platform.OS === 'web') window.location.assign(result.scopedPath)
    } catch {
      phoneLogin.setError(t('room_invite_join_failed'))
    } finally {
      setSubmittingApplication(false)
    }
  }, [joinMessage, phoneLogin.clearError, phoneLogin.setError, roomId, t])

  const load = useCallback(async () => {
    setLoading(true)
    setUnavailable(false)
    setLoadError(false)
    try {
      const value = await api<InviteBootstrap>('/room-invites/bootstrap', {
        credentials: 'include',
      })
      if (value.room.id !== roomId) {
        setInvite(null)
        setUnavailable(true)
      } else setInvite(value)
    } catch (error) {
      setInvite(null)
      if (error instanceof ApiError && [404, 410].includes(error.status)) setUnavailable(true)
      else setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    void load()
  }, [load])

  const createApproval = useCallback(async () => {
    setApprovalError('')
    setApproval(null)
    try {
      const value = await scopedRoomApi<BrowserApproval>(
        roomId,
        `/${encodeURIComponent(roomId)}/qr/create`,
        { method: 'POST' },
      )
      setApproval(value)
    } catch {
      setApprovalError(t('room_access_qr_error'))
    }
  }, [roomId, t])

  useEffect(() => {
    if (!unavailable || !roomId) return
    void createApproval()
  }, [createApproval, roomId, unavailable])

  useEffect(() => {
    if (!approval || !showQrApproval) return
    let cancelled = false
    let inFlight = false
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const result = await scopedRoomApi<{
          status: 'pending' | 'expired' | 'authorized'
          scopedPath?: string
          nicknameSetup?: ScopedNicknameSetup
        }>(roomId, `/${encodeURIComponent(roomId)}/qr/status`, {
          method: 'POST',
          body: JSON.stringify({ token: approval.approvalToken }),
        })
        if (cancelled) return
        if (result.status === 'authorized' && result.scopedPath) {
          window.clearInterval(timer)
          await offerScopedNicknameSetup(result.nicknameSetup)
          if (cancelled) return
          window.location.assign(result.scopedPath)
          return
        }
        if (result.status === 'expired') {
          setApproval(null)
          setApprovalError(t('room_access_qr_expired'))
        }
      } catch (error) {
        if (!cancelled) {
          setApprovalError(
            t(
              isRoomBrowserSessionLimit(error)
                ? 'room_browser_session_limit_reached'
                : 'room_access_qr_error',
            ),
          )
        }
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(() => void poll(), 1800)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [approval, roomId, showQrApproval, t])

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <TencentCaptchaModal
        visible={phoneLogin.captchaVisible}
        appId={authConfig.tencentCaptchaAppId ?? ''}
        onClose={() => phoneLogin.setCaptchaVisible(false)}
        onVerified={phoneLogin.handleCaptchaVerified}
      />
      <Head>
        <title>
          {t('room_invite_title')} · {t('app_name')}
        </title>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Head>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.brandRow}>
          <Text style={[styles.brand, { color: colors.brand }]}>{t('app_name')}</Text>
        </View>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brand} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {t('room_invite_loading')}
            </Text>
          </View>
        ) : loadError ? (
          <View>
            <Text accessibilityRole="alert" style={[styles.subtitle, { color: colors.error }]}>
              {t('room_browser_load_failed')}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => void load()}
            >
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          </View>
        ) : completion ? (
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('room_invite_pending_title')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('room_invite_pending_body')}
            </Text>
          </View>
        ) : unavailable || !invite ? (
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              {approval?.roomName
                ? t('room_access_confirm_room_title', { name: approval.roomName })
                : t('room_access_confirm_title')}
            </Text>
            {Platform.OS === 'web' ? (
              <View
                accessibilityRole="tablist"
                style={[styles.methodTabs, { backgroundColor: colors.surfaceHover }]}
              >
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: showPhone }}
                  onPress={() => setShowPhone(true)}
                  style={[styles.methodTab, showPhone && { backgroundColor: colors.bg }]}
                >
                  <Text
                    style={[
                      styles.methodTabLabel,
                      { color: showPhone ? colors.text : colors.textSecondary },
                    ]}
                  >
                    {t('room_access_phone_tab')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: !showPhone }}
                  onPress={() => setShowPhone(false)}
                  style={[styles.methodTab, !showPhone && { backgroundColor: colors.bg }]}
                >
                  <Text
                    style={[
                      styles.methodTabLabel,
                      { color: !showPhone ? colors.text : colors.textSecondary },
                    ]}
                  >
                    {t('room_access_qr_tab')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {roomId && showQrApproval ? (
              <View style={styles.qrSection}>
                <Text style={[styles.loginHint, { color: colors.textSecondary }]}>
                  {t('room_browser_qr_scoped_hint')}
                </Text>
                <View style={[styles.qrFrame, { borderColor: colors.border }]}>
                  {approval && QRCode ? (
                    <QRCode value={approval.payload} size={196} />
                  ) : (
                    <ActivityIndicator color={colors.brand} />
                  )}
                </View>
                {approvalError ? (
                  <Text style={[styles.errorText, { color: colors.error }]}>{approvalError}</Text>
                ) : null}
              </View>
            ) : roomId ? (
              <View style={styles.scopedLogin}>
                <PhoneLoginPanel
                  phone={phoneLogin.phone}
                  setPhone={phoneLogin.setPhone}
                  code={phoneLogin.code}
                  setCode={phoneLogin.setCode}
                  countdown={phoneLogin.countdown}
                  sendingCode={phoneLogin.sendingCode}
                  loading={phoneLogin.loading}
                  onSendCode={phoneLogin.handleSendCode}
                  onLogin={phoneLogin.handleLogin}
                  colors={colors}
                />
                {phoneLogin.error ? (
                  <Text style={[styles.errorText, { color: colors.error }]}>
                    {phoneLogin.error}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              {needsApplication
                ? t('room_invite_apply_room_title', { name: invite.room.name })
                : t('room_access_confirm_room_title', { name: invite.room.name })}
            </Text>
            {invite.room.description ? (
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {invite.room.description}
              </Text>
            ) : null}
            {joinClosed ? (
              <Text style={[styles.errorText, { color: colors.error }]}>
                {t('room_invite_closed')}
              </Text>
            ) : (
              <View style={styles.scopedLogin}>
                {needsApplication ? (
                  <View style={styles.messageField}>
                    <Text style={[styles.label, { color: colors.text }]}>
                      {t('room_invite_message_label')}
                    </Text>
                    <TextInput
                      testID="room-join-message"
                      multiline
                      maxLength={500}
                      value={joinMessage}
                      onChangeText={(value) => {
                        setJoinMessage(value)
                        phoneLogin.clearError()
                      }}
                      placeholder={t('room_invite_message_placeholder')}
                      placeholderTextColor={colors.textTertiary}
                      style={[
                        styles.messageInput,
                        {
                          color: colors.text,
                          borderColor: colors.border,
                          backgroundColor: colors.bg,
                        },
                      ]}
                    />
                    <Text style={[styles.messageCount, { color: colors.textTertiary }]}>
                      {joinMessage.length}/500
                    </Text>
                    <Pressable
                      testID="room-join-apply"
                      accessibilityRole="button"
                      accessibilityState={{
                        busy: submittingApplication,
                        disabled: submittingApplication,
                      }}
                      style={[
                        styles.joinButton,
                        styles.applicationButton,
                        { backgroundColor: colors.brand },
                        submittingApplication && { opacity: 0.55 },
                      ]}
                      onPress={() => void submitApplication()}
                      disabled={submittingApplication}
                    >
                      {submittingApplication ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={{ color: '#fff', fontWeight: '600' }}>
                          {t('room_invite_apply')}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <Text style={[styles.label, { color: colors.text }]}>
                      {t('room_invite_login')}
                    </Text>
                    <PhoneLoginPanel
                      phone={phoneLogin.phone}
                      setPhone={phoneLogin.setPhone}
                      code={phoneLogin.code}
                      setCode={phoneLogin.setCode}
                      countdown={phoneLogin.countdown}
                      sendingCode={phoneLogin.sendingCode}
                      loading={phoneLogin.loading}
                      onSendCode={phoneLogin.handleSendCode}
                      onLogin={phoneLogin.handleLogin}
                      colors={colors}
                    />
                  </View>
                )}
                {phoneLogin.error ? (
                  <Text style={[styles.errorText, { color: colors.error }]}>
                    {phoneLogin.error}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        )}
        {!loading && !loadError && !completion && roomId ? (
          <View
            style={[styles.websiteLink, { borderTopColor: colors.border }]}
          >
            {Platform.OS === 'web' ? (
              <Pressable
                accessibilityRole="link"
                style={[styles.openAppButton, { backgroundColor: colors.brand }]}
                onPress={() =>
                  window.location.assign(`shennian:///spaces/${encodeURIComponent(roomId)}`)
                }
              >
                <Text style={styles.openAppLabel}>{t('room_access_open_in_app')}</Text>
              </Pressable>
            ) : null}
            <View style={styles.downloadLinks}>
              {([
                {
                  label: t('room_access_download_android'),
                  url: getMobileAppDownloadUrl('android'),
                },
                { label: t('room_access_download_ios'), url: getMobileAppDownloadUrl('ios') },
                { label: t('room_access_official_site'), url: getServerUrl() },
              ]).map(({ label, url }) => (
                <Pressable
                  key={label}
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(url)}
                  style={styles.downloadLink}
                >
                  <Text style={[styles.websiteButtonLabel, { color: colors.brand }]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

function isRoomBrowserSessionLimit(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  try {
    return (
      (JSON.parse(error.message) as { error?: string }).error ===
      'room_browser_session_limit_reached'
    )
  } catch {
    return false
  }
}

export default RoomAccessGate

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: 20, padding: 28 },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    zIndex: 20,
  },
  brand: { fontSize: 16, fontWeight: '700' },
  loginHint: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  joinButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  centered: { alignItems: 'center', paddingVertical: 40, gap: 14 },
  statusText: { fontSize: 14 },
  eyebrow: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  title: { fontSize: 28, lineHeight: 35, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  scopedLogin: { marginTop: 24 },
  methodTabs: {
    flexDirection: 'row',
    marginTop: 24,
    padding: 4,
    borderRadius: 12,
  },
  methodTab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  methodTabLabel: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  qrSection: { alignItems: 'center', marginTop: 24 },
  qrFrame: {
    width: 228,
    height: 228,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    marginTop: 20,
  },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  textButtonLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 8 },
  messageField: { marginBottom: 20 },
  messageInput: {
    minHeight: 104,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  messageCount: { marginTop: 6, textAlign: 'right', fontSize: 12, lineHeight: 17 },
  applicationButton: { marginTop: 18 },
  websiteLink: {
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 1,
    marginTop: 24,
    paddingTop: 12,
  },
  openAppButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  openAppLabel: { color: '#FFFFFF', fontSize: 15, lineHeight: 22, fontWeight: '600' },
  downloadLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  downloadLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  websiteButtonLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  errorText: { fontSize: 13, lineHeight: 19, marginTop: 14 },
})
