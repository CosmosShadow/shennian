// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { getWebAppUrl } from '../../../config/server'
import type { RoomDetailView } from '../types'
import { RoomShareContent } from './RoomShareContent'
import { roomAccountClient, type RoomInviteLink } from '../roomAccountClient'

export function RoomInvitePanel({
  room,
  canManageInvite = false,
  onInviteClosed,
}: {
  room: RoomDetailView
  canManageInvite?: boolean
  onInviteClosed?: (room: RoomDetailView) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [invite, setInvite] = useState<RoomInviteLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState(false)
  const [closing, setClosing] = useState(false)

  const requestVersion = useRef(0)
  const invitationsClosed = room.joinPolicy === 'closed'
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setInvite(null)
    if (room.joinPolicy === 'closed') {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await roomAccountClient.getInviteLink(room.id)
      if (version === requestVersion.current) setInvite(result)
    } catch {
      // The shared content renders a retryable error without exposing a stale URL.
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [room.id, room.joinPolicy])

  useEffect(() => {
    void load()
    return () => { requestVersion.current += 1 }
  }, [load])

  const reset = () =>
    Alert.alert(t('spaces_invite_reset'), t('spaces_invite_reset_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('spaces_invite_reset'),
        style: 'destructive',
        onPress: () => {
          setResetting(true)
          void roomAccountClient.resetInviteLink(room.id)
            .then((nextInvite) => {
              setInvite(nextInvite)
            })
            .catch(() => Alert.alert(t('spaces_manage_action_failed')))
            .finally(() => setResetting(false))
        },
      },
    ])

  const closeInvitation = () =>
    Alert.alert(t('spaces_invitation_close'), t('spaces_invitation_close_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('spaces_invitation_close'),
        style: 'destructive',
        onPress: () => {
          setClosing(true)
          void roomAccountClient.updateRoom(room.id, { joinPolicy: 'closed' })
            .then((updatedRoom) => onInviteClosed?.({ ...room, ...updatedRoom }))
            .catch(() => Alert.alert(t('spaces_manage_action_failed')))
            .finally(() => setClosing(false))
        },
      },
    ])

  const roomUrl = `${getWebAppUrl().replace(/\/+$/, '')}/spaces/${encodeURIComponent(room.id)}`
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {room.joinPolicy !== 'closed' ? <Text style={[styles.identityHint, { color: colors.textSecondary }]}>
        {t('mobile_invite_ai_identity_hint')}
      </Text> : null}
      <RoomShareContent
        roomName={room.name}
        roomUrl={roomUrl}
        joinPolicy={room.joinPolicy}
        inviteUrl={invite?.url ?? ''}
        loading={loading}
        onRetry={() => void load()}
      />
      {canManageInvite && !invitationsClosed && invite && !loading ? (
        <View style={styles.ownerActions}>
          <Pressable
            testID="room-reset-invite"
            accessibilityRole="button"
            accessibilityState={{ disabled: resetting || closing }}
            disabled={resetting || closing}
            onPress={reset}
            style={styles.textAction}
          >
            {resetting ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={[styles.actionLabel, { color: colors.error }]}>
                {t('spaces_invite_reset')}
              </Text>
            )}
          </Pressable>
          <Pressable
            testID="room-close-invitation"
            accessibilityRole="button"
            accessibilityState={{ disabled: resetting || closing }}
            disabled={resetting || closing}
            onPress={closeInvitation}
            style={styles.textAction}
          >
            {closing ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={[styles.actionLabel, { color: colors.error }]}>
                {t('spaces_invitation_close')}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  identityHint: { fontSize: 13, lineHeight: 19 },
  ownerActions: { marginTop: 16, alignItems: 'center' },
  textAction: {
    minWidth: 132,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
})
