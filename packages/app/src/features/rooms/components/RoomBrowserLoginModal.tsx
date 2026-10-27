// @arch docs/features/network-rooms/scoped-browser-access.md
// @test src/__tests__/room-management-panel.test.ts

import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import BottomSheet from '../../../components/BottomSheet'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useRelativeTime } from '../../profile/profileUtils'
import { publishRoomSyncRequest } from '../roomEvents'
import { roomAccountClient, type RoomBrowserSession } from '../roomAccountClient'
import type { BrowserAuthorization } from '../useRoomBrowserAuthorizations'

function formatLoginTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RoomBrowserLoginModal({
  roomId,
  authorizations,
  visible,
  onClose,
  onLoggedOut,
}: {
  roomId: string
  authorizations: BrowserAuthorization[]
  visible: boolean
  onClose: () => void
  onLoggedOut: (sessionIds: string[]) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const relativeTime = useRelativeTime()
  const [sessions, setSessions] = useState<RoomBrowserSession[]>([])
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<'load' | 'revoke' | null>(null)
  const [revokingIds, setRevokingIds] = useState<Set<string>>(() => new Set())
  const [, setClock] = useState(0)
  const authorizationIds = useMemo(
    () => new Set(authorizations.map((authorization) => authorization.id)),
    [authorizations],
  )

  useEffect(() => {
    if (!visible) return
    let active = true
    setLoading(true)
    setFailure(null)
    void roomAccountClient.listBrowserSessions(roomId)
      .then((items) => {
        if (!active) return
        setSessions(items.filter((item) =>
          authorizationIds.has(item.id) &&
          item.status === 'active' &&
          Date.parse(item.expiresAt) > Date.now(),
        ))
      })
      .catch(() => {
        if (active) setFailure('load')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [authorizationIds, roomId, visible])

  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => setClock((value) => value + 1), 60_000)
    return () => clearInterval(timer)
  }, [visible])

  const revoke = async (targets: RoomBrowserSession[]) => {
    if (!targets.length || targets.some((session) => revokingIds.has(session.id))) return
    const ids = targets.map((session) => session.id)
    setRevokingIds((current) => new Set([...current, ...ids]))
    setFailure(null)
    try {
      await Promise.all(ids.map((sessionId) => roomAccountClient.revokeBrowserSession(roomId, sessionId)))
      setSessions((current) => current.filter((session) => !ids.includes(session.id)))
      onLoggedOut(ids)
      publishRoomSyncRequest('app-foreground')
      if (ids.length === sessions.length) onClose()
    } catch {
      setFailure('revoke')
      void roomAccountClient.listBrowserSessions(roomId).then((items) => {
        setSessions(items.filter((item) => item.status === 'active' && Date.parse(item.expiresAt) > Date.now()))
      }).catch(() => {})
    } finally {
      setRevokingIds((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
    }
  }

  const revokeAll = () => Alert.alert(
    t('spaces_browser_session_revoke_all'),
    t('spaces_browser_session_revoke_all_confirm', { count: sessions.length }),
    [
      { text: t('cancel'), style: 'cancel' },
      { text: t('spaces_browser_session_revoke_all'), style: 'destructive', onPress: () => void revoke(sessions) },
    ],
  )

  return (
    <BottomSheet
      isOpen={visible}
      onClose={onClose}
      title={t('spaces_browser_session')}
      avoidKeyboard={false}
    >
      <View style={styles.content}>
        <Text style={[styles.summary, Platform.OS !== 'web' && mobileTypography.secondary, { color: colors.textSecondary }]}>
          {t('spaces_browser_session_summary')}
        </Text>
        {loading ? <ActivityIndicator color={colors.brand} style={styles.loading} /> : null}
        {!loading ? sessions.map((session) => {
          const revoking = revokingIds.has(session.id)
          return (
            <View
              key={session.id}
              testID={`room-browser-session-${session.id}`}
              style={[styles.session, { borderBottomColor: colors.groupedSeparator }]}
            >
              <View style={styles.sessionCopy}>
                <Text style={[styles.client, Platform.OS !== 'web' && mobileTypography.body, { color: colors.text }]}>
                  {session.clientLabel || t('spaces_browser_session_unknown_client')}
                </Text>
                <Text style={[styles.metadata, Platform.OS !== 'web' && mobileTypography.metadata, { color: colors.textSecondary }]}>
                  {t('spaces_browser_login_started', {
                    time: formatLoginTime(session.createdAt),
                    relative: relativeTime(session.createdAt),
                  })}
                </Text>
                <Text style={[styles.metadata, Platform.OS !== 'web' && mobileTypography.metadata, { color: colors.textSecondary }]}>
                  {t('spaces_browser_session_last_active', { relative: relativeTime(session.lastSeenAt) })}
                </Text>
                <Text style={[styles.metadata, Platform.OS !== 'web' && mobileTypography.metadata, { color: colors.textSecondary }]}>
                  {t('spaces_browser_login_auto_logout', { time: formatLoginTime(session.expiresAt) })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('spaces_browser_session_revoke_client', {
                  client: session.clientLabel || t('spaces_browser_session_unknown_client'),
                })}
                disabled={revoking || revokingIds.size > 0}
                accessibilityState={{ disabled: revoking || revokingIds.size > 0, busy: revoking }}
                onPress={() => void revoke([session])}
                style={({ pressed }) => [styles.revokeButton, pressed && styles.pressed]}
              >
                {revoking ? (
                  <ActivityIndicator size="small" color={colors.errorText} />
                ) : (
                  <Text style={[styles.revokeText, Platform.OS !== 'web' && mobileTypography.compactAction, { color: colors.errorText }]}>
                    {t('spaces_browser_session_revoke')}
                  </Text>
                )}
              </Pressable>
            </View>
          )
        }) : null}
        {!loading && !sessions.length && !failure ? (
          <Text style={[styles.empty, Platform.OS !== 'web' && mobileTypography.body, { color: colors.textSecondary }]}>
            {t('spaces_browser_session_empty')}
          </Text>
        ) : null}
        {failure ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.errorText }]}>
            {t(failure === 'revoke' ? 'spaces_browser_session_revoke_failed' : 'spaces_browser_login_load_failed')}
          </Text>
        ) : null}
        {!loading && sessions.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            disabled={revokingIds.size > 0}
            accessibilityState={{ disabled: revokingIds.size > 0, busy: revokingIds.size > 0 }}
            onPress={revokeAll}
            style={({ pressed }) => [styles.revokeAll, { borderColor: colors.groupedSeparator }, pressed && styles.pressed]}
          >
            <Text style={[styles.revokeAllText, Platform.OS !== 'web' && mobileTypography.body, { color: colors.errorText }]}>
              {t('spaces_browser_session_revoke_all')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  content: { paddingVertical: 4 },
  summary: { fontSize: 15, lineHeight: 20, marginBottom: 12 },
  loading: { minHeight: 120, justifyContent: 'center' },
  session: {
    minHeight: 88,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sessionCopy: { flex: 1, gap: 2 },
  client: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  metadata: { fontSize: 13, lineHeight: 18 },
  revokeButton: { minWidth: 72, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  revokeText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  empty: { fontSize: 17, lineHeight: 22, paddingVertical: 32, textAlign: 'center' },
  error: { fontSize: 15, lineHeight: 20, paddingVertical: 12 },
  revokeAll: {
    minHeight: 52,
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeAllText: { fontSize: 17, lineHeight: 22 },
  pressed: { opacity: 0.65 },
})
