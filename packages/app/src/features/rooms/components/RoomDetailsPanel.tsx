// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { useTheme } from '../../../hooks/useTheme'
import type { RoomSettingsPage } from '../RoomSettingsScreen'
import type { RoomDetailView, RoomMemberView } from '../types'
import { RoomAdminPanel } from './RoomAdminPanel'
import { RoomInfoPanel } from './RoomInfoPanel'
import { RoomMembersPanel } from './RoomMembersPanel'
import { RoomInvitePanel } from './RoomInvitePanel'

export function RoomDetailsPanel({
  roomId,
  room,
  members,
  currentUserId,
  page = 'overview',
  onPageChange,
  onRoomUpdated,
  onMembersUpdated,
}: {
  roomId: string
  room: RoomDetailView
  members: RoomMemberView[]
  currentUserId?: string | null
  page?: RoomSettingsPage
  onPageChange?: (page: RoomSettingsPage) => void
  onRoomUpdated: (room: RoomDetailView) => void
  onMembersUpdated: (members: RoomMemberView[]) => void
}) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ownMembership = members.find(
    (member) => member.principalType === 'human' && member.ownerUserId === currentUserId,
  )
  const isOwner = ownMembership?.role === 'owner'
  const [removingMembers, setRemovingMembers] = useState(false)
  const canManageMembers = Boolean(isOwner && room.status === 'active')
  if (page === 'manage' && isOwner)
    return (
      <DesktopSubpage
        title={t('spaces_group_management')}
        onBack={() => onPageChange?.('overview')}
      >
        <RoomAdminPanel
          roomId={roomId}
          room={room}
          onRoomUpdated={onRoomUpdated}
          onDissolved={() => router.replace('/(main)/spaces')}
        />
      </DesktopSubpage>
    )
  if (page === 'members')
    return (
      <DesktopSubpage
        title={t('spaces_all_members')}
        onBack={() => onPageChange?.('overview')}
        trailing={
          canManageMembers ? (
            <Pressable
              testID="room-members-manage-toggle"
              accessibilityRole="button"
              onPress={() => setRemovingMembers((current) => !current)}
              style={styles.headerAction}
            >
              <Text style={{ color: removingMembers ? colors.brand : colors.textSecondary }}>
                {removingMembers ? t('done') : t('spaces_manage_title')}
              </Text>
            </Pressable>
          ) : null
        }
      >
        <RoomMembersPanel
          roomId={roomId}
          members={members}
          currentUserId={currentUserId}
          canManage={canManageMembers && removingMembers}
          onMembersUpdated={onMembersUpdated}
        />
      </DesktopSubpage>
    )
  if (page === 'invite')
    return (
      <DesktopSubpage title={t('spaces_share_room')} onBack={() => onPageChange?.('overview')}>
        <RoomInvitePanel
          room={room}
          canManageInvite={Boolean(isOwner && room.status === 'active')}
          onInviteClosed={onRoomUpdated}
        />
      </DesktopSubpage>
    )
  return (
    <RoomInfoPanel
      roomId={roomId}
      room={room}
      members={members}
      currentUserId={currentUserId}
      onOpenMembers={() => onPageChange?.('members')}
      onOpenAddMembers={() => router.navigate({ pathname: '/(main)/spaces/member-add', params: { roomId } })}
      onOpenShare={() => onPageChange?.('invite')}
      onOpenManage={() => onPageChange?.('manage')}
      onRoomUpdated={onRoomUpdated}
      onMembersUpdated={onMembersUpdated}
      onLeft={() => router.replace('/(main)/spaces')}
    />
  )
}

function DesktopSubpage({
  title,
  onBack,
  trailing,
  children,
}: {
  title: string
  onBack: () => void
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <View style={styles.subpage}>
      <AppPageHeader title={title} onBack={onBack} trailing={trailing} compact />
      <View style={styles.body}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  subpage: { flex: 1 },
  body: { flex: 1 },
  headerAction: { minWidth: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
})
