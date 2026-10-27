// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import type { RoomDetailView, RoomMemberView } from './types'
import { RoomInfoPanel } from './components/RoomInfoPanel'
import { RoomAdminPanel } from './components/RoomAdminPanel'
import { RoomMembersPanel } from './components/RoomMembersPanel'
import { RoomInvitePanel } from './components/RoomInvitePanel'
import {
  isRoomAccountForbidden,
  isRoomAccountNotFound,
  roomAccountClient,
} from './roomAccountClient'

export type RoomSettingsPage = 'overview' | 'manage' | 'members' | 'invite'

export function RoomSettingsScreen({
  roomId,
  page,
  manageMembers = false,
}: {
  roomId: string
  page: RoomSettingsPage
  manageMembers?: boolean
}) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const user = useAuthStore((state) => state.user)
  const [room, setRoom] = useState<RoomDetailView | null>(null)
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [failed, setFailed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [removingMembers, setRemovingMembers] = useState(manageMembers)

  useEffect(() => setRemovingMembers(manageMembers), [manageMembers])

  const load = useCallback(async () => {
    setFailed(false)
    setUnavailable(false)
    try {
      const [detail, memberData] = await Promise.all([
        roomAccountClient.getRoom(roomId),
        roomAccountClient.listMembers(roomId),
      ])
      setRoom(detail.room)
      setMembers(memberData)
    } catch (error) {
      if (isRoomAccountForbidden(error) || isRoomAccountNotFound(error)) {
        setUnavailable(true)
      } else {
        setFailed(true)
      }
    }
  }, [roomId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useEffect(() => {
    if (room?.conversationKind !== 'published_ai') return
    router.replace({ pathname: '/(main)/published-conversations/[conversationId]',
      params: { conversationId: roomId } })
  }, [room?.conversationKind, roomId, router])

  const title =
    page === 'manage'
      ? t('mobile_manage_conversation')
      : page === 'members'
        ? t(removingMembers ? 'mobile_member_management' : 'mobile_members')
        : page === 'invite'
          ? t('mobile_invite_conversation')
          : t('mobile_conversation_details')
  const ownHuman = members.find(
    (member) => member.principalType === 'human' && member.ownerUserId === user?.id,
  )
  const isOwner = ownHuman?.role === 'owner'
  const active = room?.status === 'active'
  const openMembers = () =>
    router.navigate({
      pathname: '/(main)/spaces/members',
      params: { roomId },
    })
  const openShare = () =>
    router.navigate({
      pathname: '/(main)/spaces/invite',
      params: { roomId },
    })
  const openAddMembers = () =>
    router.navigate({ pathname: '/(main)/spaces/member-add', params: { roomId } })

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader
        title={title}
        onBack={() => router.back()}
        backTestID="room-settings-back"
        trailing={
          page === 'members' && ownHuman && active ? (
            removingMembers ? (
              <Pressable
                testID="room-members-manage-toggle"
                accessibilityRole="button"
                accessibilityLabel={t('done')}
                onPress={() => setRemovingMembers(false)}
                style={styles.headerAction}
              >
                <Text style={{ color: colors.brand }}>{t('done')}</Text>
              </Pressable>
            ) : (
              <HeaderIconButton
                icon="add"
                label={t('mobile_add_members')}
                testID="room-members-add-action"
                onPress={openAddMembers}
              />
            )
          ) : null
        }
      />
      {room?.conversationKind === 'published_ai' ? <ActivityIndicator color={colors.brand} /> : !room ? (
        <View
          testID={unavailable ? 'room-settings-unavailable' : undefined}
          style={[styles.center, styles.loadState]}
        >
          {unavailable ? (
            <>
              <Ionicons name="lock-closed-outline" size={38} color={colors.textTertiary} />
              <Text style={[styles.loadTitle, { color: colors.text }]}>
                {t('spaces_unavailable_title')}
              </Text>
              <Text style={[styles.loadBody, { color: colors.textSecondary }]}>
                {t('spaces_unavailable_body')}
              </Text>
              <Pressable onPress={() => router.replace('/(main)/spaces')} style={styles.loadAction}>
                <Text style={{ color: colors.brand }}>{t('back')}</Text>
              </Pressable>
            </>
          ) : failed ? (
            <>
              <Ionicons name="cloud-offline-outline" size={38} color={colors.textTertiary} />
              <Text style={[styles.loadTitle, { color: colors.text }]}>
                {t('spaces_load_failed')}
              </Text>
              <Pressable onPress={() => void load()} style={styles.loadAction}>
                <Text style={{ color: colors.brand }}>{t('retry')}</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.brand} />
          )}
        </View>
      ) : page === 'manage' && !isOwner ? (
        <View testID="room-management-owner-only" style={styles.center}>
          <Text style={[styles.permissionTitle, { color: colors.text }]}>
            {t('spaces_owner_only_management')}
          </Text>
          <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
            {t('spaces_owner_only_management_help')}
          </Text>
        </View>
      ) : page === 'manage' ? (
        <RoomAdminPanel
          roomId={roomId}
          room={room}
          onRoomUpdated={setRoom}
          onDissolved={() => router.replace('/(main)/spaces')}
          onOpenManageMembers={() => router.navigate({ pathname: '/(main)/spaces/members', params: { roomId, manage: '1' } })}
        />
      ) : page === 'members' ? (
        <RoomMembersPanel
          roomId={roomId}
          members={members}
          currentUserId={user?.id}
          canManage={isOwner && removingMembers}
          canToggleManage={isOwner && active}
          onToggleManage={() => setRemovingMembers(true)}
          onMembersUpdated={setMembers}
        />
      ) : page === 'invite' ? (
        <RoomInvitePanel
          room={room}
          canManageInvite={Boolean(isOwner && active)}
          onInviteClosed={setRoom}
        />

      ) : (
        <RoomInfoPanel
          room={room}
          roomId={roomId}
          members={members}
          currentUserId={user?.id}
          onOpenMembers={openMembers}
          onOpenAddMembers={openAddMembers}
          onOpenShare={openShare}
          onOpenManage={() =>
            router.navigate({ pathname: '/(main)/spaces/manage', params: { roomId } })
          }
          onRoomUpdated={setRoom}
          onMembersUpdated={setMembers}
          onLeft={() => router.replace('/(main)/spaces')}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadState: { paddingHorizontal: 32 },
  loadTitle: { fontSize: 20, lineHeight: 25, fontWeight: '600', textAlign: 'center', marginTop: 16 },
  loadBody: { maxWidth: 300, fontSize: 15, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  loadAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 12 },
  headerAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  permissionBody: { fontSize: 13, lineHeight: 19, marginTop: 6 },
})
