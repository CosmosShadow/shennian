// @arch docs/features/network-rooms/ui.md#八首版验收
// @test ../../__tests__/room-invite-web.test.ts

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { HeaderBackButton } from '../../components/AppPageHeader'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { roomInvitationClient } from './roomInvitationClient'
import type { RoomInvitation } from './roomInvitationClient.types'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useGoBack } from '../../hooks/useGoBack'

export function NativeRoomInviteScreen({
  roomId: expectedRoomId,
  inviteToken,
}: {
  roomId?: string
  inviteToken?: string
} = {}) {
  const params = useLocalSearchParams<{ token?: string }>()
  const token = inviteToken ?? params.token ?? ''
  const router = useRouter()
  const goBack = useGoBack('/(main)/spaces')
  const { t } = useTranslation()
  const { colors } = useTheme()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [invite, setInvite] = useState<RoomInvitation | null>(null)
  const [handle, setHandle] = useState('')
  const [failed, setFailed] = useState(false)
  const [joining, setJoining] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace({
        pathname: '/(auth)/login',
        params: {
          redirect: expectedRoomId
            ? `/spaces/${encodeURIComponent(expectedRoomId)}?invite=${encodeURIComponent(token)}`
            : '/',
        },
      })
      return
    }
    void roomInvitationClient.exchange({ roomId: expectedRoomId, token })
      .then((result) => {
        if (result.entryState === 'joined') {
          router.replace({
            pathname: '/(main)/room-workspace',
            params: { roomId: result.roomId ?? result.invite?.room.id ?? expectedRoomId ?? '' },
          })
          return
        }
        if (result.entryState === 'pending_approval') {
          setPendingApproval(true)
          return
        }
        if (!result.invite || !result.joinHandle) {
          setFailed(true)
          return
        }
        setInvite(result.invite)
        setHandle(result.joinHandle)
      })
      .catch(() => setFailed(true))
  }, [expectedRoomId, isAuthenticated, router, token])

  const join = async () => {
    if (!handle) return
    Keyboard.dismiss()
    setJoining(true)
    try {
      const result = await roomInvitationClient.join({
        joinHandle: handle,
        ...(invite?.room.joinPolicy === 'approval' ? { message: message.trim() } : {}),
      })
      if (result.outcome === 'joined')
        router.replace({ pathname: '/(main)/room-workspace', params: { roomId: result.roomId } })
      else setPendingApproval(true)
    } catch {
      setFailed(true)
      setJoining(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <HeaderBackButton onPress={goBack} />
        <Text style={[styles.title, { color: colors.text }]}>{t('spaces_join_room')}</Text>
        <View style={styles.side} />
      </View>
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={
          Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
        >
          {failed ? (
            <>
              <Text style={[styles.room, { color: colors.error }]}>
                {t('room_invite_unavailable_title')}
              </Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                {t('room_invite_unavailable_body')}
              </Text>
            </>
          ) : pendingApproval ? (
            <>
              <Text style={[styles.room, { color: colors.text }]}>
                {t('room_invite_pending_title')}
              </Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                {t('room_invite_pending_body')}
              </Text>
            </>
          ) : !invite ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <Text style={[styles.room, { color: colors.text }]}>{invite.room.name}</Text>
              {invite.room.joinPolicy === 'approval' ? (
                <View style={styles.messageField}>
                  <Text style={[styles.messageLabel, { color: colors.text }]}>
                    {t('room_invite_message_label')}
                  </Text>
                  <TextInput
                    testID="native-room-join-message"
                    multiline
                    maxLength={500}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={t('room_invite_message_placeholder')}
                    placeholderTextColor={colors.textTertiary}
                    style={[
                      styles.messageInput,
                      {
                        color: colors.text,
                        borderColor: colors.border,
                        backgroundColor: colors.surface,
                      },
                    ]}
                  />
                  <Text style={[styles.messageCount, { color: colors.textTertiary }]}>
                    {message.length}/500
                  </Text>
                </View>
              ) : null}
              <Pressable
                disabled={
                  joining ||
                  invite.room.joinPolicy === 'closed' ||
                  (invite.room.joinPolicy === 'approval' && !message.trim())
                }
                style={[
                  styles.join,
                  {
                    backgroundColor: colors.brand,
                    opacity:
                      invite.room.joinPolicy === 'closed' ||
                      (invite.room.joinPolicy === 'approval' && !message.trim())
                        ? 0.4
                        : 1,
                  },
                ]}
                onPress={() => void join()}
              >
                {joining ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.joinText}>
                    {invite.room.joinPolicy === 'approval'
                      ? t('room_invite_apply')
                      : t('room_invite_join')}
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default NativeRoomInviteScreen

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  keyboardArea: { flex: 1 },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  room: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  description: { fontSize: 14, textAlign: 'center' },
  messageField: { width: '100%', maxWidth: 440, marginTop: 6 },
  messageLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 8 },
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
  join: {
    minWidth: 180,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  joinText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
